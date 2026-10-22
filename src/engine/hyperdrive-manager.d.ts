/**
 * Typed view of engine/hyperdrive-manager.js (the sacred core).
 * Only the surface the Hyperdrive backend adapter touches is typed; the
 * runtime module stays plain CommonJS so the CLI can require it directly.
 */
import { EventEmitter } from 'node:events'

export declare const DriveState: {
  readonly CREATING: 'creating'
  readonly ACTIVE: 'active'
  readonly SEEKING: 'seeking'
  readonly PAUSED: 'paused'
  readonly ERRORED: 'errored'
}
export type DriveStateValue = (typeof DriveState)[keyof typeof DriveState]

/** A drive record as persisted in drives-state.json. */
export interface ManifestDriveEntry {
  driveId: string
  key?: string
  discoveryKey?: string
  state: DriveStateValue
  files: Array<{ name: string; size: number; path?: string; key?: string; displayName?: string }>
  totalBytes: number
  localPath?: string | null
  storagePath?: string
  name: string
  shareLink?: string
  createdAt?: number
  isUpload?: boolean
  error?: string
  [extra: string]: unknown
}

/** A live session for an open drive. */
export interface DriveSession {
  driveId: string
  drive: unknown
  store: unknown
  swarm: unknown
  metadata?: { key?: string; [k: string]: unknown }
  manifest?: unknown
  totalBytes?: number
  shareName?: string | null
  shareLink?: string
  isReceiving?: boolean
  isSeeding?: boolean
  driveEntryId?: string
}

export interface HyperdriveManagerOptions {
  drivesDir?: string
  manifestPath?: string
  downloadsDir?: string
  swarmOptions?: Record<string, unknown>
  createSwarm?: () => unknown
}

export interface StopDriveOptions {
  /** Remove the drive completely (storage folder and manifest entry). */
  delete?: boolean
  /** Write PAUSED to the manifest (default true). False on shutdown/reload. */
  persistState?: boolean
  /** Leave the swarm without unannouncing from the DHT. App quit only. */
  force?: boolean
}

export interface OpenDriveResult {
  driveId: string
  files: Array<{ name: string; displayName?: string; size: number }>
  shareName: string | null
  totalBytes: number
  hasManifest: boolean
  peerConnected: boolean
  truncated: { available: number; shown: number } | null
}

export class HyperdriveManager extends EventEmitter {
  constructor(options?: HyperdriveManagerOptions)
  drivesDir: string
  manifestPath: string
  downloadsDir: string
  activeDrives: Map<string, DriveSession>
  pendingConnections: Map<string, unknown>
  resumeErrors: Map<string, { error: string; at: number }>
  manifest: { drives: Record<string, ManifestDriveEntry>; stats: Record<string, number> }
  initialized: boolean
  init(): Promise<void>
  createDrive(
    files: Array<{ name: string; path: string; size?: number; relativePath?: string }>,
    options?: { ttlMs?: number; name?: string; clientJobId?: string | null; totalBytes?: number }
  ): Promise<{ driveId: string; shareLink: string; key: string }>
  cancelShare(driveId: string): boolean
  openDrive(shareLink: string): Promise<OpenDriveResult>
  stopDrive(driveId: string, options?: StopDriveOptions): Promise<void>
  stopAll(options?: StopDriveOptions): Promise<void>
  abortConnection(driveId: string, options?: { force?: boolean }): boolean
  abortAllConnections(options?: { force?: boolean }): Promise<void>
  addDriveEntry(data: Record<string, unknown>): Promise<ManifestDriveEntry>
  removeDriveEntry(id: string, opts?: { deleteFiles?: boolean; deleteStorage?: boolean }): Promise<boolean>
  pauseDriveEntry(id: string): Promise<ManifestDriveEntry | null>
  resumeDrive(id: string): Promise<ManifestDriveEntry | null>
  getDriveEntry(id: string): ManifestDriveEntry | null
  getAllDriveEntries(): ManifestDriveEntry[]
  getDriveEntryByKey(key: string): ManifestDriveEntry | null
  checkLocalAvailability(id: string): Promise<boolean>
}

export declare const manager: HyperdriveManager
