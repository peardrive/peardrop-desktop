/**
 * TransferBackend — the seam between the app and a P2P engine.
 *
 * The main process (IPC handlers, EngineHost) talks to transfers ONLY through
 * this interface, and the renderer only sees the backend-neutral shapes from
 * @shared/transfer. To replace Hyperdrive with another engine:
 *
 *   1. implement TransferBackend (see hyperdrive/hyperdrive-backend.ts),
 *   2. register a factory in ./registry.ts,
 *   3. select it with the `backend` option of EngineHost.
 *
 * No React component, store or IPC channel has to change.
 */
import type { BootstrapNode } from '@shared/bootstrap'
import type {
  DownloadRequest,
  DownloadResult,
  DriveFile,
  DriveRecord,
  DuplicateCheckResult,
  LibrarySnapshot,
  OpenResult,
  SimpleResult,
  TransferEvent
} from '@shared/transfer'
import type { PeardropPaths } from '../../engine/paths'
import type { Logger } from '../logger'

/** A file to put into a new share — already flattened and de-duplicated. */
export interface ShareFileInput {
  name: string
  path: string
  size: number
  /** Location inside the share (flat: equals `name`). */
  relativePath: string
}

export interface CreateShareInput {
  files: ShareFileInput[]
  name: string
  clientJobId: string | null
  totalBytes: number
  /** Folder the shared files came from (for "show in folder"). */
  localPath: string | null
}

export interface CreateShareOutput {
  driveId: string
  shareLink: string
  record: DriveRecord
  files: DriveFile[]
}

/** Thrown by createShare when the user cancelled the build. */
export class ShareCancelledError extends Error {
  readonly cancelled = true
  constructor() {
    super('Share cancelled')
  }
}

export interface BackendContext {
  paths: PeardropPaths
  network: { bootstrap: BootstrapNode[] }
  log: Logger
}

export interface TransferBackend {
  /** Stable id used in preferences/registry, e.g. "hyperdrive". */
  readonly id: string
  /** Human label for Settings. */
  readonly label: string

  /** Open storage, resume persisted drives, join the network. Emits `library-loaded` when done. */
  start(): Promise<void>
  /**
   * Leave the network and close storage. `persistState: false` (quit/reload)
   * must leave persisted states untouched so drives resume next start.
   */
  stop(opts?: { persistState?: boolean }): Promise<void>
  /** Subscribe to backend events. Returns an unsubscribe function. */
  onEvent(listener: (event: TransferEvent) => void): () => void

  snapshot(): LibrarySnapshot
  get(driveId: string): DriveRecord | null
  stats(): { drives: number; active: number }

  createShare(input: CreateShareInput): Promise<CreateShareOutput>
  cancelShare(driveId: string): boolean

  checkLink(link: string): Promise<DuplicateCheckResult>
  open(link: string, opts?: { force?: boolean }): Promise<OpenResult>
  download(req: DownloadRequest): Promise<DownloadResult>
  cancelDownload(driveId: string): Promise<SimpleResult>

  pause(driveId: string): Promise<SimpleResult & { record?: DriveRecord }>
  resume(driveId: string): Promise<SimpleResult & { record?: DriveRecord }>
  remove(driveId: string, opts?: { deleteFiles?: boolean }): Promise<SimpleResult>
}

export type BackendFactory = (ctx: BackendContext) => TransferBackend
