/**
 * Types shared by the Hyperdrive engine modules.
 */
import type Corestore from 'corestore'
import type Hyperdrive from 'hyperdrive'
import type Hyperswarm from 'hyperswarm'
import type { TruncationHint } from '../file-utils'
import type { DriveManifest } from './drive-manifest'

/** Lifecycle state of a drive, as stored in drives-state.json. */
export const DriveState = {
  /** Temporary while a share is being built. */
  CREATING: 'creating',
  /** Shared and reachable (the default). */
  ACTIVE: 'active',
  /** A download still looking for its sender. */
  SEEKING: 'seeking',
  /** Stopped by the user; can be resumed. */
  PAUSED: 'paused',
  /** Something went wrong and needs attention. */
  ERRORED: 'errored'
} as const

export type DriveStateValue = (typeof DriveState)[keyof typeof DriveState]

/** A file as recorded for a drive. Shares and downloads fill different fields. */
export interface DriveFileEntry {
  name: string
  size: number
  /** Absolute path on this machine (shared original or downloaded copy). */
  path?: string
  /** The file's key inside the drive, e.g. "/photos/a.jpg". */
  key?: string
  displayName?: string
  /** Location inside the share (shares only). */
  storagePath?: string
  addedAt?: number
}

/** A drive record as persisted in drives-state.json. */
export interface ManifestDriveEntry {
  driveId: string
  key?: string
  discoveryKey?: string
  state: DriveStateValue
  files: DriveFileEntry[]
  totalBytes: number
  localPath?: string | null
  storagePath?: string
  name: string
  shareLink?: string
  createdAt?: number
  isUpload?: boolean
  error?: string
  ttlMs?: number
  expiresAt?: number | null
  pausedAt?: number
  stoppedAt?: number
  lastAttempt?: number
  stats?: { uploaded: number; downloaded: number; peers: number }
}

/** drives-state.json as a whole. */
export interface DrivesState {
  drives: Record<string, ManifestDriveEntry>
  stats: {
    totalCreated: number
    totalPurged: number
    totalBytesShared: number
  }
}

/** A drive that is open right now: its storage, its swarm and what we know about it. */
export interface DriveSession {
  driveId: string
  drive: Hyperdrive
  store: Corestore
  swarm: Hyperswarm
  /** Seeds: the persisted entry. Receive sessions: just the drive key. */
  metadata: Partial<ManifestDriveEntry> & { key?: string }
  totalBytes: number
  createdAt?: number
  resumedAt?: number
  /** Receive sessions only. */
  isReceiving?: boolean
  manifest?: DriveManifest | null
  shareName?: string | null
  shareLink?: string
  /** Set once a finished download starts seeding. */
  isSeeding?: boolean
  driveEntryId?: string
  /** Seeds: listeners on the progress tracker, removed by stopDrive. */
  trackerHandlers?: {
    onTrackerProgress: (data: UploadProgressEvent) => void
    onTrackerComplete: (data: UploadCompleteEvent) => void
  }
  expirationTimer?: NodeJS.Timeout
}

/** A receive session still waiting for its sender; can be aborted. */
export interface PendingConnection {
  driveId: string
  aborted: boolean
  /** Tear down the swarm and storage. `force` skips the DHT unannounce. */
  cleanup: (opts?: { force?: boolean }) => Promise<void>
}

export interface StopDriveOptions {
  /** Remove the drive completely (storage folder and manifest entry). */
  delete?: boolean
  /** Write PAUSED to the manifest (default true). False on shutdown/reload. */
  persistState?: boolean
  /** Leave the swarm without unannouncing from the DHT. App quit only. */
  force?: boolean
}

/** A file to put into a new share. */
export interface ShareSourceFile {
  name: string
  path: string
  size?: number
  /** Location inside the share; defaults to the file name. */
  relativePath?: string
}

export interface CreateDriveOptions {
  /** Time-to-live in ms; 0 or absent shares indefinitely. */
  ttlMs?: number
  name?: string
  /** Opaque token echoed back in 'share-started'. */
  clientJobId?: string | null
  /** Denominator for 'share-progress'. */
  totalBytes?: number
}

export interface CreateDriveResult {
  driveId: string
  shareLink: string
  key: string
}

/** A file listed in a remote share. */
export interface RemoteFile {
  /** The file's key inside the drive (path traversal stripped). */
  name: string
  displayName?: string
  size: number
  path?: string
}

export interface OpenDriveResult {
  driveId: string
  files: RemoteFile[]
  shareName: string | null
  totalBytes: number
  hasManifest: boolean
  peerConnected: boolean
  truncated: TruncationHint | null
}

export interface UploadProgressEvent {
  peerId: string
  driveId: string
  bytesTransferred: number
  totalBytes: number
  percent: number
  speed: number
}

export interface UploadCompleteEvent {
  peerId: string
  driveId: string
  totalBytes: number
  duration: number
}

export interface PeerEvent {
  driveId: string
  peerId: string
  publicKey: string | null
  at: number
}

/** Every event the HyperdriveManager emits, with its payload. */
export interface ManagerEvents {
  'peer-connected': PeerEvent
  'peer-disconnected': PeerEvent
  'upload-progress': UploadProgressEvent
  'upload-complete': UploadCompleteEvent
  'share-started': {
    driveId: string
    clientJobId: string | null
    name: string | null
    filesTotal: number
    bytesTotal: number
  }
  'share-progress': {
    driveId: string
    filesDone: number
    filesTotal: number
    bytesDone: number
    bytesTotal: number
    currentFile: string
  }
  'drive-created': { driveId: string; shareLink: string; metadata: ManifestDriveEntry }
  'drive-stopped': { driveId: string; deleted: boolean }
  'drive-announced': { driveId: string; at: number }
  'drive-announce-failed': { driveId: string; error: string }
  'drive-resume-failed': { driveId: string; error: string }
  'drive-ready-to-download': {
    driveId: string
    shareLink: string
    shareName: string
    totalBytes: number
    files: RemoteFile[]
  }
  'download-peer-disconnected': { driveId: string }
  'connection-status': { driveId: string; status: 'searching'; peerConnected: boolean }
}

export type ManagerEventName = keyof ManagerEvents
