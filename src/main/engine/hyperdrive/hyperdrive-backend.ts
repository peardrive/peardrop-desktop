/**
 * HyperdriveBackend — TransferBackend implemented on the Holepunch stack
 * (Hyperdrive + Corestore + Hyperswarm) through the existing, battle-tested
 * engine in src/engine (HyperdriveManager + downloader).
 *
 * The handler bodies below are the former src/main.js IPC handlers, moved
 * here nearly verbatim so their hard-won edge-case handling (download guard,
 * cancel/purge, resume paths, "never delete a user's original") survives the
 * refactor. What changed is only the plumbing:
 *   - results use the backend-neutral shapes from @shared/transfer,
 *   - events go through `emit()` instead of mainWindow.webContents.send,
 *   - a fresh HyperdriveManager is created per start(), with storage paths
 *     and Hyperswarm bootstrap nodes injected — that is what makes
 *     "reload engine" and custom bootstrappers possible.
 *
 * 🔒 SACRED CORE: createDrive / openDrive / swarm join+replicate live in
 * src/engine/hyperdrive-manager.js and are called, never reimplemented.
 */
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  DownloadRequest,
  DownloadResult,
  DriveFile,
  DriveRecord,
  DriveState,
  DuplicateCheckResult,
  LibrarySnapshot,
  OpenResult,
  SimpleResult,
  TransferEvent
} from '@shared/transfer'
import { downloadFromDrive } from '../../../engine/downloader'
import { EngineError } from '../../../engine/engine-errors'
import { DriveState as EngineDriveState, HyperdriveManager, type ManifestDriveEntry } from '../../../engine/hyperdrive-manager'
import type { Logger } from '../../logger'
import {
  ShareCancelledError,
  type BackendContext,
  type CreateShareInput,
  type CreateShareOutput,
  type TransferBackend
} from '../backend'

/** A run older than this is treated as dead and superseded. */
const STALE_DOWNLOAD_MS = 5 * 60 * 1000
/** A cancel must always resolve, even if the engine is stuck. */
const CANCEL_SAFETY_NET_MS = 4000

const LINK_PREFIX = 'peardrop://'

/** Manifest file names arrive as "/a.txt"; the UI wants "a.txt" and keeps the key. */
function toDriveFile(f: { name: string; size?: number; path?: string; key?: string; displayName?: string }): DriveFile {
  const key = f.key ?? (f.name?.startsWith('/') ? f.name : undefined)
  const name = f.displayName || (f.name ? path.posix.basename(f.name.replace(/\\/g, '/')) : 'file')
  return {
    name,
    size: Number(f.size) || 0,
    ...(f.path ? { path: f.path } : {}),
    ...(key ? { key } : {})
  }
}

export function toRecord(entry: ManifestDriveEntry): DriveRecord {
  return {
    id: (entry.driveId || (entry as { id?: string }).id) as string,
    name: entry.name || 'Untitled Share',
    state: (entry.state || 'active') as DriveState,
    isUpload: entry.isUpload !== false,
    files: (entry.files || []).map(toDriveFile),
    totalBytes: entry.totalBytes || 0,
    shareLink: entry.shareLink || (entry.key ? `${LINK_PREFIX}${entry.key}` : undefined),
    localPath: entry.localPath ?? null,
    createdAt: entry.createdAt
  }
}

const keyFromLink = (link: string) => link.trim().replace(/^peardrop:\/\//i, '').toLowerCase()

export class HyperdriveBackend implements TransferBackend {
  readonly id = 'hyperdrive'
  readonly label = 'Hyperdrive (Holepunch)'

  private readonly emitter = new EventEmitter()
  private readonly log: Logger
  private manager: HyperdriveManager
  private readonly managerListeners: Array<[string, (...args: any[]) => void]> = []

  /** Shares whose DHT topic has been announced (reachable by link holders). */
  private readonly announced = new Set<string>()

  // Download bookkeeping (formerly module state in main.js).
  private readonly cancelledDownloads = new Set<string>()
  /** driveId -> timestamp the loop started. */
  private readonly activeDownloads = new Map<string, number>()
  /** driveId -> where the download writes, recorded before the first byte. */
  private readonly downloadRoots = new Map<string, { root: string; isOwnFolder: boolean }>()
  /** driveId -> abort fn for the file currently streaming. */
  private readonly downloadAborters = new Map<string, () => void>()

  constructor(private readonly ctx: BackendContext) {
    this.log = ctx.log.child('hyperdrive')
    this.manager = this.createManager()
    this.emitter.setMaxListeners(50)
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  private createManager(): HyperdriveManager {
    const { paths, network } = this.ctx
    return new HyperdriveManager({
      drivesDir: paths.drivesDir,
      manifestPath: paths.stateFile,
      downloadsDir: paths.downloadsDir,
      swarmOptions: network.bootstrap.length ? { bootstrap: network.bootstrap } : {}
    })
  }

  async start(): Promise<void> {
    await fs.mkdir(this.ctx.paths.downloadsDir, { recursive: true })
    this.log.info('Starting', {
      drivesDir: this.ctx.paths.drivesDir,
      bootstrap: this.ctx.network.bootstrap.length ? this.ctx.network.bootstrap : 'public DHT'
    })
    // Listeners BEFORE init(): drives resume during init and their announce
    // events must not be lost.
    this.bindManagerEvents()
    await this.manager.init()
    this.emit({ type: 'library-loaded', snapshot: this.snapshot() })
    const resumeFailures = this.manager.resumeErrors.size
    this.log.info('Ready', { drives: this.manager.getAllDriveEntries().length, resumeFailures })
  }

  async stop(opts: { persistState?: boolean } = {}): Promise<void> {
    // Abort anything still connecting so stopAll does not wait on it.
    try {
      this.manager.abortAllConnections()
    } catch {
      /* best effort */
    }
    for (const abort of this.downloadAborters.values()) {
      try {
        abort()
      } catch {
        /* best effort */
      }
    }
    // persistState:false — shutdown/reload must not demote drives to PAUSED,
    // so they auto-resume and re-announce on the next start.
    await this.manager.stopAll({ delete: false, persistState: opts.persistState ?? false })
    for (const [event, fn] of this.managerListeners) this.manager.removeListener(event, fn)
    this.managerListeners.length = 0
    this.announced.clear()
    this.log.info('Stopped')
  }

  onEvent(listener: (event: TransferEvent) => void): () => void {
    this.emitter.on('event', listener)
    return () => this.emitter.off('event', listener)
  }

  private emit(event: TransferEvent): void {
    this.emitter.emit('event', event)
  }

  private bindManagerEvents(): void {
    const on = (event: string, fn: (data: any) => void) => {
      this.manager.on(event, fn)
      this.managerListeners.push([event, fn])
    }
    on('peer-connected', (d) => this.emit({ type: 'peer-connected', driveId: d.driveId, peerId: d.peerId, publicKey: d.publicKey, at: d.at }))
    on('peer-disconnected', (d) => this.emit({ type: 'peer-disconnected', driveId: d.driveId, peerId: d.peerId, publicKey: d.publicKey, at: d.at }))
    on('upload-progress', (d) =>
      this.emit({
        type: 'transfer-progress',
        driveId: d.driveId,
        peerId: d.peerId,
        percent: d.percent,
        bytesTransferred: d.bytesTransferred,
        totalBytes: d.totalBytes,
        speed: d.speed || 0
      })
    )
    on('upload-complete', (d) => this.emit({ type: 'transfer-complete', driveId: d.driveId, peerId: d.peerId, totalBytes: d.totalBytes, duration: d.duration }))
    on('share-started', (d) =>
      this.emit({ type: 'share-started', driveId: d.driveId, clientJobId: d.clientJobId ?? null, name: d.name ?? null, filesTotal: d.filesTotal, bytesTotal: d.bytesTotal })
    )
    on('share-progress', (d) =>
      this.emit({
        type: 'share-progress',
        driveId: d.driveId,
        filesDone: d.filesDone,
        filesTotal: d.filesTotal,
        bytesDone: d.bytesDone,
        bytesTotal: d.bytesTotal,
        currentFile: d.currentFile ?? null
      })
    )
    on('download-peer-disconnected', (d) => this.emit({ type: 'download-peer-disconnected', driveId: d.driveId }))
    on('drive-ready-to-download', (d) => {
      this.log.info('Resumed download reconnected', { driveId: d.driveId })
      this.emit({ type: 'drive-ready-to-download', driveId: d.driveId, shareLink: d.shareLink, shareName: d.shareName ?? null, totalBytes: d.totalBytes || 0 })
    })
    on('drive-resume-failed', (d) => this.emit({ type: 'drive-resume-failed', driveId: d.driveId, error: d.error }))
    // Announces fire during init — record them so a renderer that attaches
    // later still learns which shares are reachable.
    on('drive-announced', (d) => {
      if (d?.driveId) this.announced.add(d.driveId)
      this.emit({ type: 'drive-announced', driveId: d.driveId, at: d.at })
    })
    on('drive-announce-failed', (d) => {
      if (d?.driveId) this.announced.delete(d.driveId)
      this.emit({ type: 'drive-announce-failed', driveId: d.driveId, error: d.error })
    })
  }

  // ───────────────────────────── queries ─────────────────────────────

  snapshot(): LibrarySnapshot {
    const resumeErrors: LibrarySnapshot['resumeErrors'] = {}
    for (const [id, info] of this.manager.resumeErrors) resumeErrors[id] = { error: info.error, at: info.at }
    return {
      drives: this.manager.getAllDriveEntries().map(toRecord),
      announced: [...this.announced],
      resumeErrors
    }
  }

  get(driveId: string): DriveRecord | null {
    const entry = this.manager.getDriveEntry(driveId)
    return entry ? toRecord(entry) : null
  }

  stats() {
    return { drives: this.manager.getAllDriveEntries().length, active: this.manager.activeDrives.size }
  }

  // ───────────────────────────── sharing ─────────────────────────────

  cancelShare(driveId: string): boolean {
    return this.manager.cancelShare(driveId)
  }

  async createShare(input: CreateShareInput): Promise<CreateShareOutput> {
    let result: { driveId: string; shareLink: string; key: string }
    try {
      result = await this.manager.createDrive(input.files, {
        ttlMs: 0,
        name: input.name,
        // Opaque; echoed back in share-started so the renderer can match
        // this build to the job it already drew.
        clientJobId: input.clientJobId,
        // Denominator for share-progress; createDrive only echoes it.
        totalBytes: input.totalBytes
      })
    } catch (err) {
      if ((err as { cancelled?: boolean })?.cancelled) throw new ShareCancelledError()
      throw err
    }
    this.log.info('Share created', { driveId: result.driveId, files: input.files.length, totalBytes: input.totalBytes })

    const files = input.files.map((f) => ({ name: f.name, path: f.path, size: f.size }))
    const entry = await this.manager.addDriveEntry({
      id: result.driveId,
      key: result.key,
      shareLink: result.shareLink,
      name: input.name,
      files,
      totalBytes: input.totalBytes,
      localPath: input.localPath,
      storagePath: path.join(this.manager.drivesDir, result.driveId),
      state: EngineDriveState.ACTIVE,
      isUpload: true
    })
    const record = toRecord(entry)
    this.emit({ type: 'drive-added', record })
    return { driveId: result.driveId, shareLink: result.shareLink, record, files: record.files }
  }

  // ───────────────────────────── receiving ─────────────────────────────

  async checkLink(link: string): Promise<DuplicateCheckResult> {
    const existing = this.manager.getDriveEntryByKey(keyFromLink(link))
    if (!existing) return { isDuplicate: false }
    const localAvailable = await this.manager.checkLocalAvailability(existing.driveId)
    return {
      isDuplicate: true,
      driveId: existing.driveId,
      localStatus: localAvailable ? 'available' : 'missing',
      existing: toRecord(existing)
    }
  }

  async open(link: string, opts: { force?: boolean } = {}): Promise<OpenResult> {
    try {
      this.log.info('Opening link', { link, force: !!opts.force })
      const driveKey = keyFromLink(link)
      if (driveKey && !opts.force) {
        const dup = await this.checkLink(link)
        if (dup.isDuplicate) {
          return { success: true, isDuplicate: true, driveId: dup.driveId, localStatus: dup.localStatus, existing: dup.existing }
        }
      }
      const r = await this.manager.openDrive(link)
      return {
        success: true,
        isDuplicate: false,
        driveId: r.driveId,
        files: r.files.map(toDriveFile),
        shareName: r.shareName,
        totalBytes: r.totalBytes,
        hasManifest: r.hasManifest,
        peerConnected: r.peerConnected,
        truncated: r.truncated
      }
    } catch (error) {
      this.log.warn('Open failed', error)
      return {
        success: false,
        error: (error as Error).message,
        ...(error instanceof EngineError ? { errorDetail: error.toJSON() } : {})
      }
    }
  }

  /**
   * Delete everything a cancelled download produced. Uses the recorded root
   * rather than the error's payload: a download killed by its storage being
   * torn down throws an error carrying no file list at all.
   */
  private async purgeCancelledDownload(driveId: string, knownFiles?: Array<{ path?: string; destPath?: string }> | null) {
    const info = this.downloadRoots.get(driveId)
    this.downloadRoots.delete(driveId)
    // A just-destroyed write stream can hold the file open for a moment on
    // Windows (EBUSY/EPERM). Retry briefly instead of giving up.
    const rmWithRetry = async (target: string, recursive = false) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await fs.rm(target, { force: true, recursive })
          return true
        } catch (err) {
          if (attempt === 4) {
            this.log.warn('Could not remove', { target, error: (err as Error).message })
            return false
          }
          await new Promise((r) => setTimeout(r, 120))
        }
      }
      return false
    }

    if (info?.isOwnFolder && info.root) {
      if (await rmWithRetry(info.root, true)) this.log.info('Removed cancelled download folder', { root: info.root })
    } else {
      for (const f of knownFiles || []) {
        const target = f?.path || f?.destPath
        if (target && (await rmWithRetry(target))) this.log.info('Removed cancelled download file', { target })
      }
    }

    // Entry only — deliberately NOT stopDrive({delete:true}): tearing down
    // the live swarm session from a cancel raced the engine's own teardown.
    try {
      await this.manager.removeDriveEntry(driveId, { deleteFiles: false, deleteStorage: false })
    } catch (err) {
      this.log.warn('Cancelled-download entry removal failed', (err as Error).message)
    }
    this.emit({ type: 'drive-removed', driveId })
  }

  async cancelDownload(driveId: string): Promise<SimpleResult> {
    if (!driveId) return { success: false }
    this.cancelledDownloads.add(driveId)
    this.log.info('Download cancel requested', { driveId })

    // SAFETY NET: if the loop has not unwound shortly, tear it down here.
    setTimeout(async () => {
      if (!this.activeDownloads.has(driveId)) return
      this.log.warn('Download did not stop after cancel — forcing teardown', { driveId })
      this.activeDownloads.delete(driveId)
      this.downloadAborters.delete(driveId)
      this.cancelledDownloads.delete(driveId)
      await this.purgeCancelledDownload(driveId, null)
    }, CANCEL_SAFETY_NET_MS)

    // Kill the in-flight stream right now rather than at the next chunk.
    const abort = this.downloadAborters.get(driveId)
    if (abort) {
      this.downloadAborters.delete(driveId)
      try {
        abort()
      } catch (err) {
        this.log.warn('Abort failed', (err as Error).message)
      }
    }

    // A connect still in progress: abort it (no-op if not pending).
    try {
      this.manager.abortConnection(driveId)
    } catch {
      /* not pending */
    }

    if (!this.activeDownloads.has(driveId)) {
      // No loop running: either it finished a moment ago (an entry exists and
      // its files go too — "cancel" means "I don't want this"), or nothing was
      // ever downloaded under this id (cancel during connecting).
      const entry = this.manager.manifest?.drives?.[driveId]
      if (!entry) {
        this.log.info('Cancel during connecting phase — no entry to clean up', { driveId })
        this.cancelledDownloads.delete(driveId)
        this.emit({ type: 'drive-removed', driveId })
        return { success: true }
      }
      try {
        const removed = await this.manager.removeDriveEntry(driveId, { deleteFiles: true, deleteStorage: false })
        this.log.info('Cancelled an already-finished download', { driveId, removed })
      } catch (err) {
        this.log.warn('Post-completion cancel cleanup failed', (err as Error).message)
      } finally {
        this.cancelledDownloads.delete(driveId)
        this.emit({ type: 'drive-removed', driveId })
      }
    }
    return { success: true }
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    const { driveId, fileNames } = req
    // AUTHORITATIVE GUARD: one download loop per drive. Several call sites
    // can start one (fresh paste, ready-to-download, Resume); two loops would
    // write the same files and fight over the same card.
    const startedAt = this.activeDownloads.get(driveId)
    if (startedAt && Date.now() - startedAt < STALE_DOWNLOAD_MS) {
      this.log.warn('Download already running — ignoring duplicate start', { driveId, runningForMs: Date.now() - startedAt })
      return { success: false, alreadyRunning: true, error: 'Download already in progress' }
    }
    if (startedAt) {
      this.log.warn('Previous download looks dead, superseding it', { driveId, ageMs: Date.now() - startedAt })
      const staleAbort = this.downloadAborters.get(driveId)
      if (staleAbort) {
        try {
          staleAbort()
        } catch {
          /* already gone */
        }
      }
      this.downloadAborters.delete(driveId)
    }

    this.log.info('Download starting', { driveId })
    this.cancelledDownloads.delete(driveId)
    this.activeDownloads.set(driveId, Date.now())
    const downloadPath = req.destDir || this.ctx.paths.downloadsDir

    try {
      const session = this.manager.activeDrives.get(driveId)
      if (!session) {
        // A download whose session is gone (app restarted, sender vanished):
        // reconnect first. The engine emits drive-ready-to-download once the
        // sender is back, and the UI re-enters download() from there.
        const entry = this.manager.getDriveEntry(driveId)
        if (entry && entry.isUpload === false) {
          this.activeDownloads.delete(driveId)
          this.reconnect(driveId)
          return { success: false, notReady: true, error: 'Reconnecting to the sender…' }
        }
        throw new EngineError({ category: 'receive.no-session', cause: 'session-not-found', message: 'Session not found' })
      }

      // Never run the loop against a drive that has not synced: no manifest
      // AND no bytes means "not ready", not "empty share" (the 0-file ghost).
      const hasManifest = !!session.manifest
      const knownBytes = session.totalBytes || 0
      if (!hasManifest && knownBytes === 0) {
        this.log.warn('Refusing to download: drive has not synced yet', { driveId })
        this.activeDownloads.delete(driveId)
        return { success: false, notReady: true, error: 'Still connecting to the sender — no file list received yet' }
      }

      // Resume into the same files a previous attempt used.
      const priorEntry = this.manager.manifest?.drives?.[driveId]
      const resumePaths: Record<string, string> = {}
      for (const f of priorEntry?.files || []) {
        if (!f || !f.path) continue
        if (f.key) resumePaths[f.key] = f.path
        else {
          const base = f.name || String(f.path).split(/[/\\]/).pop()
          if (base) resumePaths['/' + base.replace(/^\//, '')] = f.path
        }
      }
      let resumeRoot: string | null = null
      const firstPriorPath = (priorEntry?.files || []).find((f) => f && f.path)?.path
      if (firstPriorPath) {
        const dir = path.dirname(firstPriorPath)
        if (path.resolve(dir) !== path.resolve(downloadPath)) resumeRoot = dir
      }

      const result = await downloadFromDrive(session.drive, {
        destDir: downloadPath,
        resumePaths: Object.keys(resumePaths).length ? resumePaths : null,
        resumeRoot,
        totalBytes: session.totalBytes || 0,
        shareName: session.shareName,
        fileNames,
        onProgress: (data) => {
          if (this.cancelledDownloads.has(driveId)) return
          this.emit({
            type: 'transfer-progress',
            driveId,
            peerId: 'self',
            percent: data.percent,
            bytesTransferred: data.bytesTransferred ?? 0,
            totalBytes: data.totalBytes ?? session.totalBytes ?? 0,
            speed: data.speed ?? 0
          })
        },
        onComplete: (data) => this.emit({ type: 'transfer-complete', driveId, peerId: 'self', totalBytes: data.totalBytes, duration: data.duration }),
        onError: (data) => this.log.warn('File error', data),
        isCancelled: () => this.cancelledDownloads.has(driveId),
        onRoot: (root, isOwnFolder) => this.downloadRoots.set(driveId, { root, isOwnFolder }),
        registerAborter: (fn) => this.downloadAborters.set(driveId, fn)
      })

      const failedCount = (result.failed || []).length
      const gotCount = (result.files || []).length

      // Zero files retrieved is never a success, however many failed.
      if (gotCount === 0) {
        this.log.warn('Download failed: no files retrieved', { driveId, failed: failedCount })
        this.clearDownloadState(driveId)
        return {
          success: false,
          error: failedCount > 0 ? 'The sender went offline before any files transferred' : 'No files received — the sender had nothing to send yet',
          failed: result.failed
        }
      }

      // Cancelled during the last file: the loop finished normally, but the
      // user asked for this to go away.
      if (this.cancelledDownloads.has(driveId)) {
        this.activeDownloads.delete(driveId)
        this.downloadAborters.delete(driveId)
        this.cancelledDownloads.delete(driveId)
        this.log.info('Download finished but was cancelled — discarding', { driveId })
        await this.purgeCancelledDownload(driveId, result.files)
        return { success: false, cancelled: true, error: 'Download cancelled' }
      }

      const entry = await this.manager.addDriveEntry({
        id: driveId,
        key: session.metadata?.key,
        shareLink: session.shareLink || `${LINK_PREFIX}${session.metadata?.key || 'unknown'}`,
        name: session.shareName,
        files: result.files,
        totalBytes: result.totalBytes,
        localPath: downloadPath,
        storagePath: path.join(this.manager.drivesDir, driveId),
        state: EngineDriveState.ACTIVE,
        isUpload: false
      })
      session.isSeeding = true
      session.driveEntryId = entry.driveId
      this.log.info('Download complete, now seeding', { driveId, files: gotCount, failed: failedCount })

      const record = toRecord(entry)
      this.emit({
        type: 'files-downloaded',
        driveId,
        files: record.files,
        downloadPath,
        isSeeding: true,
        partial: failedCount > 0,
        failedCount
      })
      this.emit({ type: 'drive-added', record })
      this.clearDownloadState(driveId)
      return { success: true, partial: failedCount > 0, failed: result.failed, files: record.files, downloadPath, driveId }
    } catch (error) {
      this.activeDownloads.delete(driveId)
      this.downloadAborters.delete(driveId)
      // If the user asked to cancel, ANY failure from here is the cancellation.
      if ((error as { cancelled?: boolean })?.cancelled || this.cancelledDownloads.has(driveId)) {
        this.cancelledDownloads.delete(driveId)
        this.log.info('Download cancelled by user', { driveId })
        await this.purgeCancelledDownload(driveId, (error as { partialFiles?: Array<{ path?: string }> })?.partialFiles)
        return { success: false, cancelled: true, error: 'Download cancelled' }
      }
      this.log.error('Download failed', error)
      return {
        success: false,
        error: (error as Error).message,
        ...(error instanceof EngineError ? { errorDetail: error.toJSON() } : {})
      }
    }
  }

  /** Drives with a reconnect in progress (resumeDrive is slow and not re-entrant). */
  private readonly reconnecting = new Set<string>()

  private reconnect(driveId: string) {
    if (this.reconnecting.has(driveId) || this.manager.pendingConnections.has(driveId)) return
    this.reconnecting.add(driveId)
    this.log.info('No live session — reconnecting before download', { driveId })
    this.manager
      .resumeDrive(driveId)
      .catch((err: Error) => {
        this.log.warn('Reconnect failed', { driveId, error: err.message })
        this.emit({ type: 'drive-resume-failed', driveId, error: err.message })
      })
      .finally(() => this.reconnecting.delete(driveId))
  }

  private clearDownloadState(driveId: string) {
    this.activeDownloads.delete(driveId)
    this.downloadAborters.delete(driveId)
    this.downloadRoots.delete(driveId)
  }

  // ───────────────────────────── library ─────────────────────────────

  async pause(driveId: string) {
    if (!driveId) return { success: false, error: 'Missing drive id' }
    this.log.info('Pausing drive', { driveId })
    // No longer announced: it has left the swarm.
    this.announced.delete(driveId)
    if (this.manager.activeDrives.get(driveId)) await this.manager.stopDrive(driveId, { delete: false })
    const entry = await this.manager.pauseDriveEntry(driveId)
    if (!entry) return { success: false, error: 'Drive not found' }
    return { success: true, record: toRecord(entry) }
  }

  async resume(driveId: string) {
    if (!driveId) return { success: false, error: 'Missing drive id' }
    this.log.info('Resuming drive', { driveId })
    try {
      const entry = await this.manager.resumeDrive(driveId)
      if (!entry) return { success: false, error: 'Drive not found' }
      return { success: true, record: toRecord(entry) }
    } catch (err) {
      this.log.warn('Resume failed', { driveId, error: (err as Error).message })
      return { success: false, error: (err as Error).message }
    }
  }

  async remove(driveId: string, opts: { deleteFiles?: boolean } = {}): Promise<SimpleResult> {
    const deleteFiles = !!opts.deleteFiles
    try {
      this.log.info('Removing drive', { driveId, deleteFiles })
      this.announced.delete(driveId)

      // Capture the file list BEFORE anything can destroy the entry:
      // stopDrive({delete:true}) deletes the manifest entry itself.
      const entryBefore = this.manager.manifest?.drives?.[driveId]

      // HARD RULE: only ever delete files PearDrop downloaded. A share points
      // at the user's own file wherever it lives — removing the share removes
      // it from the list, nothing more. Enforced here, not in the dialog.
      const isUploadEntry = !!entryBefore?.isUpload
      if (deleteFiles && isUploadEntry) {
        this.log.warn('Refusing to delete files for a SHARE (upload) — list removal only', { driveId })
      }
      const reallyDeleteFiles = deleteFiles && !isUploadEntry
      const filesToDelete = reallyDeleteFiles && entryBefore ? (entryBefore.files || []).slice() : []

      if (this.manager.activeDrives.get(driveId)) await this.manager.stopDrive(driveId, { delete: true })
      const success = await this.manager.removeDriveEntry(driveId, { deleteFiles: reallyDeleteFiles, deleteStorage: true })

      const touchedDirs = new Set<string>()
      for (const file of filesToDelete) {
        if (!file?.path) continue
        try {
          await fs.rm(file.path, { force: true })
          touchedDirs.add(path.dirname(file.path))
        } catch (err) {
          this.log.warn('Could not delete file', { path: file.path, error: (err as Error).message })
        }
      }
      // Tidy a now-empty per-share folder — never recursively, never the
      // downloads root itself.
      for (const dir of touchedDirs) {
        try {
          if (path.resolve(dir) === path.resolve(this.ctx.paths.downloadsDir)) continue
          const left = await fs.readdir(dir)
          if (left.length === 0) await fs.rmdir(dir)
        } catch (err) {
          this.log.warn('Could not tidy folder', { dir, error: (err as Error).message })
        }
      }

      // Always tell the UI, even if the entry was already gone.
      this.emit({ type: 'drive-removed', driveId })
      return { success }
    } catch (error) {
      this.log.error('Failed to remove drive', error)
      return { success: false, error: (error as Error).message }
    }
  }
}

export const createHyperdriveBackend = (ctx: BackendContext) => new HyperdriveBackend(ctx)
