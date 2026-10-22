/**
 * HyperdriveManager: owns every drive the engine has open and the persistent
 * drive list, and is the one API the Hyperdrive backend talks to.
 *
 * The work itself lives in focused modules:
 *   share.ts           create a share and start seeding it
 *   receive.ts         open a link, find the sender, read the file list
 *   resume.ts          bring drives back after a restart or a Resume click
 *   seeding.ts         join a drive's topic and serve it to peers
 *   manifest-store.ts  drives-state.json
 *
 * Every drive has its own Corestore and its own Hyperswarm, so a peer that
 * connects for one share never learns about the others.
 */
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import Hyperswarm, { type HyperswarmOptions } from 'hyperswarm'
import type { EngineContext } from './context'
import { ManifestStore, type AddDriveEntryInput, type RemoveDriveEntryOptions } from './manifest-store'
import { ProgressTracker } from './progress-tracker'
import { openRemoteDrive } from './receive'
import { resumeActiveDrives, resumeSavedDrive } from './resume'
import { createShare } from './share'
import {
  DriveState,
  type CreateDriveOptions,
  type CreateDriveResult,
  type DriveSession,
  type DrivesState,
  type ManagerEventName,
  type ManagerEvents,
  type ManifestDriveEntry,
  type OpenDriveResult,
  type PendingConnection,
  type ShareSourceFile,
  type StopDriveOptions
} from './types'

export interface HyperdriveManagerOptions {
  /** Folder holding one Corestore folder per drive. */
  drivesDir: string
  /** drives-state.json */
  manifestPath: string
  /** Passed to every new Hyperswarm (e.g. custom bootstrap nodes). */
  swarmOptions?: HyperswarmOptions
  /** Full override of swarm construction; wins over swarmOptions. */
  createSwarm?: () => Hyperswarm
}

export class HyperdriveManager extends EventEmitter implements EngineContext {
  readonly drivesDir: string
  readonly store: ManifestStore
  readonly tracker = new ProgressTracker()

  readonly activeDrives = new Map<string, DriveSession>()
  readonly pendingConnections = new Map<string, PendingConnection>()
  readonly cancelledShares = new Set<string>()

  /**
   * Resume failures from this run only. Never persisted, so a later save
   * cannot turn a transient boot failure into a permanent drive state.
   */
  readonly resumeErrors = new Map<string, { error: string; at: number }>()

  initialized = false

  private readonly swarmFactory: () => Hyperswarm

  constructor(options: HyperdriveManagerOptions) {
    super()
    this.drivesDir = options.drivesDir
    this.store = new ManifestStore(options.manifestPath, options.drivesDir)

    const swarmOptions = options.swarmOptions || {}
    this.swarmFactory = options.createSwarm || (() => new Hyperswarm(swarmOptions))
  }

  /** drives-state.json as currently loaded. */
  get manifest(): DrivesState {
    return this.store.state
  }

  createSwarm(): Hyperswarm {
    return this.swarmFactory()
  }

  emitEvent<K extends ManagerEventName>(event: K, data: ManagerEvents[K]): void {
    this.emit(event, data)
  }

  /** Load the drive list, clean up interrupted builds, resume active drives. */
  async init(): Promise<void> {
    if (this.initialized) {
      return
    }

    await fs.mkdir(this.drivesDir, { recursive: true })
    await this.store.load()
    await this.store.removeIncompleteDrives()
    await resumeActiveDrives(this, this.resumeErrors)

    this.initialized = true
    this.logBootSummary()
  }

  /** One line answering "why isn't drive X announcing?" from the top of the log. */
  private logBootSummary(): void {
    const stateCounts: Record<string, number> = {}
    for (const entry of this.store.all()) {
      stateCounts[entry.state] = (stateCounts[entry.state] || 0) + 1
    }

    const failures = this.resumeErrors.size
      ? `(${this.resumeErrors.size} resume failure(s), will retry next boot)`
      : ''

    console.log(
      `[HyperdriveManager] Initialized: ${this.activeDrives.size} announcing / ${this.store.all().length} tracked`,
      stateCounts,
      failures
    )
  }


  /** Build a share from local files and start seeding it. */
  async createDrive(files: ShareSourceFile[], options: CreateDriveOptions = {}): Promise<CreateDriveResult> {
    if (!this.initialized) {
      await this.init()
    }
    return createShare(this, files, options)
  }

  /**
   * Cancel an in-flight createDrive. The build stops at the next chunk, the
   * partial drive is deleted and createDrive rejects with `err.cancelled`.
   */
  cancelShare(driveId: string): boolean {
    if (!driveId) {
      return false
    }

    this.cancelledShares.add(driveId)
    console.log('[HyperdriveManager] Share cancel requested', { driveId })
    return true
  }


  /** Open a remote drive from a share link. Only call after init(). */
  openDrive(shareLink: string): Promise<OpenDriveResult> {
    return openRemoteDrive(this, shareLink)
  }

  /**
   * Abort a connection still waiting for its sender. Its cleanup runs in the
   * background.
   * @returns Whether a pending connection was found.
   */
  abortConnection(driveId: string, options: { force?: boolean } = {}): boolean {
    return this.abortPending(driveId, options) !== null
  }

  /**
   * Abort every pending connection and wait for all their cleanups, so the
   * process never exits halfway through deleting a folder or saving the list.
   */
  async abortAllConnections(options: { force?: boolean } = {}): Promise<void> {
    const cleanups: Promise<void>[] = []

    for (const driveId of Array.from(this.pendingConnections.keys())) {
      const cleanup = this.abortPending(driveId, options)
      if (cleanup) {
        cleanups.push(cleanup)
      }
    }

    await Promise.allSettled(cleanups)
  }

  /** @returns The cleanup in progress, or null if nothing was pending. */
  private abortPending(driveId: string, { force = false }: { force?: boolean }): Promise<void> | null {
    const pending = this.pendingConnections.get(driveId)
    if (!pending) {
      return null
    }

    console.log('[HyperdriveManager] Aborting connection', { driveId })
    pending.aborted = true
    const cleanup = pending.cleanup({ force })
    this.pendingConnections.delete(driveId)

    return cleanup
  }


  /**
   * Leave the swarm and close a drive.
   *
   * By default (user pause) the drive is persisted as PAUSED. App quit and
   * reload pass `persistState: false`, leaving the saved state alone so the
   * drive resumes and re-announces next time. `delete` removes the drive
   * completely; `force` skips the DHT unannounce (app quit only).
   */
  async stopDrive(driveId: string, options: StopDriveOptions = { delete: false }): Promise<void> {
    const session = this.activeDrives.get(driveId)
    if (!session) {
      console.warn('[HyperdriveManager] Drive not active', { driveId })
      return
    }

    console.log('[HyperdriveManager] Stopping drive', { driveId, delete: options.delete })

    if (session.expirationTimer) {
      clearTimeout(session.expirationTimer)
    }

    this.stopUploadTracking(session)

    // Steps stay in this order: stop replicating, then close the drive,
    // then the store the drive's cores live in.
    if (session.swarm) {
      await session.swarm.destroy({ force: options.force === true })
    }
    await this.closeSessionStorage(session)

    if (options.delete && session.metadata?.storagePath) {
      await this.deleteStorage(session.metadata.storagePath)
    }

    await this.persistStop(driveId, options)

    this.activeDrives.delete(driveId)
    this.emitEvent('drive-stopped', { driveId, deleted: !!options.delete })

    console.log('[HyperdriveManager] Drive fully stopped', { driveId })
  }

  /**
   * Stop every open drive at once. Drives share nothing, so this takes as
   * long as the slowest drive, not the sum of all of them.
   */
  async stopAll(options: StopDriveOptions = { delete: false }): Promise<void> {
    const driveIds = Array.from(this.activeDrives.keys())
    console.log('[HyperdriveManager] Stopping all drives', {
      count: driveIds.length,
      force: options.force === true
    })

    // allSettled: one drive failing to close must not leave the others running.
    const results = await Promise.allSettled(driveIds.map((driveId) => this.stopDrive(driveId, options)))

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    for (const result of failed) {
      console.warn('[HyperdriveManager] Drive failed to stop', result.reason?.message ?? result.reason)
    }

    console.log('[HyperdriveManager] All drives stopped', { count: driveIds.length, failed: failed.length })
  }

  /** Stop counting uploads and detach this drive's tracker listeners. */
  private stopUploadTracking(session: DriveSession): void {
    this.tracker.stopTracking(session.driveId)

    if (session.trackerHandlers) {
      this.tracker.removeListener('progress', session.trackerHandlers.onTrackerProgress)
      this.tracker.removeListener('complete', session.trackerHandlers.onTrackerComplete)
    }
  }

  private async closeSessionStorage(session: DriveSession): Promise<void> {
    try {
      await session.drive.close()
      console.log('[HyperdriveManager] Drive closed', { driveId: session.driveId })
    } catch (err) {
      console.warn('[HyperdriveManager] Error closing drive', (err as Error).message)
    }

    try {
      await session.store.close()
      console.log('[HyperdriveManager] Store closed', { driveId: session.driveId })
    } catch (err) {
      console.warn('[HyperdriveManager] Error closing store', (err as Error).message)
    }
  }

  private async deleteStorage(storagePath: string): Promise<void> {
    try {
      await fs.rm(storagePath, { recursive: true, force: true })
      console.log('[HyperdriveManager] Storage deleted', { path: storagePath })
    } catch (err) {
      console.warn('[HyperdriveManager] Failed to delete storage', (err as Error).message)
    }
  }

  /** Record a stop in the drive list: removed, paused, or (quit/reload) untouched. */
  private async persistStop(driveId: string, options: StopDriveOptions): Promise<void> {
    const entry = this.store.drives[driveId]
    if (!entry) {
      return
    }

    if (options.delete) {
      delete this.store.drives[driveId]
      this.store.stats.totalPurged++
      await this.store.save()
      return
    }

    if (options.persistState !== false) {
      entry.state = DriveState.PAUSED
      entry.stoppedAt = Date.now()
      await this.store.save()
    }
  }


  addDriveEntry(input: AddDriveEntryInput): Promise<ManifestDriveEntry> {
    return this.store.add(input)
  }

  removeDriveEntry(driveId: string, opts: RemoveDriveEntryOptions = {}): Promise<boolean> {
    return this.store.remove(driveId, opts)
  }

  pauseDriveEntry(driveId: string): Promise<ManifestDriveEntry | null> {
    return this.store.pause(driveId)
  }

  getDriveEntry(driveId: string): ManifestDriveEntry | null {
    return this.store.get(driveId)
  }

  getAllDriveEntries(): ManifestDriveEntry[] {
    return this.store.all()
  }

  getDriveEntryByKey(key: string): ManifestDriveEntry | null {
    return this.store.getByKey(key)
  }

  checkLocalAvailability(driveId: string): Promise<boolean> {
    return this.store.hasLocalFiles(driveId)
  }

  /**
   * Resume a paused or failed drive: re-open its storage, rejoin the swarm,
   * then persist the new state. Shares become ACTIVE; downloads go back to
   * SEEKING until they complete.
   */
  async resumeDrive(driveId: string): Promise<ManifestDriveEntry | null> {
    const entry = this.store.drives[driveId]
    if (!entry) {
      return null
    }

    if (this.activeDrives.has(driveId)) {
      console.log('[HyperdriveManager] Drive already active', { id: driveId })
      return entry
    }

    // A paused DOWNLOAD resumes as seeking, not as a share.
    if (entry.isUpload === false && entry.state === DriveState.PAUSED) {
      entry.state = DriveState.SEEKING
    }

    // Rejoin first; only persist the new state if it actually came back up.
    await resumeSavedDrive(this, driveId, entry)

    if (entry.state !== DriveState.SEEKING) {
      entry.state = DriveState.ACTIVE
    }
    delete entry.pausedAt
    delete entry.stoppedAt
    delete entry.error

    this.resumeErrors.delete(driveId)
    await this.store.save()

    console.log('[HyperdriveManager] Drive resumed and announcing', { id: driveId, name: entry.name })
    return entry
  }
}
