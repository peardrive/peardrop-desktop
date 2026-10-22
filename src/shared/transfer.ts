/**
 * Backend-neutral transfer domain types.
 *
 * Everything that crosses the IPC boundary about shares and downloads is
 * described here. Nothing in this file mentions Hyperdrive, Corestore or
 * Hyperswarm: a different transfer backend implements the same shapes and
 * the React UI keeps working unchanged.
 */

/** Lifecycle state a backend persists for a drive. */
export type DriveState = 'creating' | 'active' | 'seeking' | 'paused' | 'errored'

/** One file inside a drive. `path` is the local absolute path when known. */
export interface DriveFile {
  name: string
  size: number
  path?: string
  /** Backend-internal key of the file inside the drive (e.g. "/a.txt"). */
  key?: string
  displayName?: string
}

/** A persisted drive (a share we created, or something we downloaded). */
export interface DriveRecord {
  id: string
  name: string
  state: DriveState
  /** true = we shared it, false = we downloaded it. */
  isUpload: boolean
  files: DriveFile[]
  totalBytes: number
  shareLink?: string
  /** Download destination root, when this is a download. */
  localPath?: string | null
  createdAt?: number
}

/** A file or folder picked/dropped by the user, as stat'ed by the main process. */
export interface ShareSource {
  name: string
  path: string
  size: number
  type: 'file' | 'folder'
  /** Folders only: number of files found inside (recursively). */
  fileCount?: number
  /** Folders only: every file inside, flattened. */
  contents?: Array<{ name: string; path: string; size: number; relativePath: string }>
}

export interface ShareRequest {
  sources: ShareSource[]
  /** Display name for the share; defaults to the single file's name or "Folder". */
  name?: string
  /** Opaque token echoed back in the `share-started` event to route progress. */
  clientJobId?: string
}

export type ShareResult =
  | { success: true; driveId: string; shareLink: string; files: DriveFile[]; record: DriveRecord }
  | { success: false; cancelled?: boolean; error: string }

/** Structured engine error (category/cause are stable, message is for humans). */
export interface TransferErrorDetail {
  category: string
  cause: string
  message: string
  detail?: unknown
}

export type DuplicateCheckResult =
  | { isDuplicate: false }
  | { isDuplicate: true; driveId: string; localStatus: 'available' | 'missing'; existing: DriveRecord }

export interface OpenedDrive {
  driveId: string
  files: DriveFile[]
  shareName: string | null
  totalBytes: number
  hasManifest: boolean
  peerConnected: boolean
  truncated: { available: number; shown: number } | null
}

export type OpenResult =
  | ({ success: true; isDuplicate: false } & OpenedDrive)
  | { success: true; isDuplicate: true; driveId: string; localStatus: 'available' | 'missing'; existing: DriveRecord }
  | { success: false; error: string; errorDetail?: TransferErrorDetail }

export interface DownloadRequest {
  driveId: string
  /** Defaults to the app's downloads folder (~/.peardrop/downloads). */
  destDir?: string
  /** Subset of files to fetch; omit for everything. */
  fileNames?: string[]
}

export type DownloadResult =
  | {
      success: true
      partial: boolean
      failed: Array<{ key: string; error: string }>
      files: DriveFile[]
      downloadPath: string
      driveId: string
    }
  | {
      success: false
      error?: string
      errorDetail?: TransferErrorDetail
      cancelled?: boolean
      /** Connected, but the file list has not arrived yet — keep waiting. */
      notReady?: boolean
      /** Another download loop already owns this drive. */
      alreadyRunning?: boolean
      failed?: Array<{ key: string; error: string }>
    }

/** Snapshot of the library the UI renders on boot / reload. */
export interface LibrarySnapshot {
  drives: DriveRecord[]
  /** Drive ids whose share is announced and reachable right now. */
  announced: string[]
  /** Drives that failed to come back at boot (transient, retried next boot). */
  resumeErrors: Record<string, { error: string; at: number }>
}

export interface SimpleResult {
  success: boolean
  error?: string
}

/** Every event a backend can push to the UI. `peerId: 'self'` marks our own download. */
export type TransferEvent =
  | { type: 'peer-connected'; driveId: string; peerId: string; publicKey?: string | null; at?: number }
  | { type: 'peer-disconnected'; driveId: string; peerId: string; publicKey?: string | null; at?: number }
  | {
      type: 'transfer-progress'
      driveId: string
      peerId: string
      percent: number
      bytesTransferred: number
      totalBytes: number
      /** Bytes per second. */
      speed: number
    }
  | { type: 'transfer-complete'; driveId: string; peerId: string; totalBytes?: number; duration?: number }
  | { type: 'share-started'; driveId: string; clientJobId: string | null; name: string | null; filesTotal: number; bytesTotal: number }
  | {
      type: 'share-progress'
      driveId: string
      filesDone: number
      filesTotal: number
      bytesDone: number
      bytesTotal: number
      currentFile: string | null
    }
  | {
      type: 'files-downloaded'
      driveId: string
      files: DriveFile[]
      downloadPath: string
      isSeeding: boolean
      partial: boolean
      failedCount: number
    }
  | { type: 'download-peer-disconnected'; driveId: string }
  /** A download started by the receive queue failed; `willRetry` = the queue keeps trying. */
  | { type: 'download-failed'; driveId: string; error: string; willRetry: boolean }
  | { type: 'drive-ready-to-download'; driveId: string; shareLink: string; shareName: string | null; totalBytes: number }
  | { type: 'drive-resume-failed'; driveId: string; error: string }
  | { type: 'drive-announced'; driveId: string; at?: number }
  | { type: 'drive-announce-failed'; driveId: string; error: string }
  | { type: 'drive-added'; record: DriveRecord }
  | { type: 'drive-removed'; driveId: string }
  | { type: 'library-loaded'; snapshot: LibrarySnapshot }

export type TransferEventType = TransferEvent['type']
