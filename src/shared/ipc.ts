/**
 * The typed IPC contract between main, preload and renderer.
 *
 * `IpcInvokeMap` lists every request/response channel. The main process
 * registers handlers against it (src/main/ipc), the preload exposes it as the
 * `PeardropApi` object below, and the renderer only ever talks to that
 * object (through src/renderer/services). Adding a channel means adding one
 * line here — TypeScript then flags every side that has not caught up.
 */
import type { AppInfo } from './app-info'
import type { EngineReloadRequest, EngineReloadResult, EngineStatus } from './engine'
import type { LibraryData } from './library'
import type { Preferences, PreferencesPatch } from './preferences'
import type {
  DownloadRequest,
  DownloadResult,
  DriveRecord,
  DuplicateCheckResult,
  LibrarySnapshot,
  OpenResult,
  ShareRequest,
  ShareResult,
  ShareSource,
  SimpleResult,
  TransferEvent
} from './transfer'

export type ThumbnailResult = { kind: 'image' | 'icon'; src: string } | { kind: 'none'; src: null }

export interface OpenPathResult extends SimpleResult {
  /** The path no longer exists on disk. */
  missing?: boolean
}

export interface LogTailResult extends SimpleResult {
  text?: string
  path?: string
}

export interface IpcInvokeMap {
  // transfers (backend-neutral)
  'transfers:snapshot': { args: []; result: LibrarySnapshot }
  'transfers:share': { args: [ShareRequest]; result: ShareResult }
  'transfers:cancel-share': { args: [driveId: string]; result: SimpleResult }
  'transfers:check-link': { args: [link: string]; result: DuplicateCheckResult }
  'transfers:open': { args: [link: string, opts?: { force?: boolean }]; result: OpenResult }
  'transfers:download': { args: [DownloadRequest]; result: DownloadResult }
  'transfers:cancel-download': { args: [driveId: string]; result: SimpleResult }
  'transfers:get': { args: [driveId: string]; result: DriveRecord | null }
  'transfers:pause': { args: [driveId: string]; result: SimpleResult & { record?: DriveRecord } }
  'transfers:resume': { args: [driveId: string]; result: SimpleResult & { record?: DriveRecord } }
  'transfers:remove': { args: [driveId: string, opts?: { deleteFiles?: boolean }]; result: SimpleResult }
  // local files
  'files:stat': { args: [paths: string[]]; result: ShareSource[] }
  'files:exists': { args: [paths: string[]]; result: Record<string, boolean> }
  'files:open': { args: [path: string]; result: OpenPathResult }
  'files:reveal': { args: [path: string]; result: SimpleResult }
  'files:open-downloads': { args: []; result: SimpleResult }
  'files:thumbnail': { args: [path: string]; result: ThumbnailResult }
  'files:pick': { args: []; result: string[] }
  // misc
  'qr:generate': { args: [text: string]; result: string }
  'app:info': { args: []; result: AppInfo }
  'settings:get': { args: []; result: Preferences }
  'settings:update': { args: [PreferencesPatch]; result: Preferences }
  'library:get': { args: []; result: LibraryData }
  'library:set-favorite': { args: [driveId: string, favorite: boolean]; result: LibraryData }
  'library:set-alias': { args: [driveId: string, alias: string | null]; result: LibraryData }
  'library:forget': { args: [driveId: string]; result: LibraryData }
  'library:import': { args: [LibraryData]; result: LibraryData }
  'engine:status': { args: []; result: EngineStatus }
  'engine:reload': { args: [EngineReloadRequest?]; result: EngineReloadResult }
  'logs:path': { args: []; result: string }
  'logs:reveal': { args: []; result: SimpleResult }
  'logs:tail': { args: [lines?: number]; result: LogTailResult }
  'logs:write': { args: [entry: RendererLogEntry]; result: void }
}

export type IpcChannel = keyof IpcInvokeMap
export type IpcArgs<C extends IpcChannel> = IpcInvokeMap[C]['args']
export type IpcResult<C extends IpcChannel> = IpcInvokeMap[C]['result']

/** Push channels (main → renderer). */
export interface IpcPushMap {
  'transfers:event': TransferEvent
  'settings:changed': Preferences
  'engine:status': EngineStatus
}
export type IpcPushChannel = keyof IpcPushMap

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export interface RendererLogEntry {
  level: LogLevel
  scope: string
  message: string
  data?: unknown
}

type Unsubscribe = () => void

/**
 * The object the preload exposes as `window.peardrop`.
 * Grouped by concern; every method maps 1:1 to a channel above.
 */
export interface PeardropApi {
  transfers: {
    snapshot(): Promise<LibrarySnapshot>
    share(req: ShareRequest): Promise<ShareResult>
    cancelShare(driveId: string): Promise<SimpleResult>
    checkLink(link: string): Promise<DuplicateCheckResult>
    open(link: string, opts?: { force?: boolean }): Promise<OpenResult>
    download(req: DownloadRequest): Promise<DownloadResult>
    cancelDownload(driveId: string): Promise<SimpleResult>
    get(driveId: string): Promise<DriveRecord | null>
    pause(driveId: string): Promise<SimpleResult & { record?: DriveRecord }>
    resume(driveId: string): Promise<SimpleResult & { record?: DriveRecord }>
    remove(driveId: string, opts?: { deleteFiles?: boolean }): Promise<SimpleResult>
    onEvent(cb: (event: TransferEvent) => void): Unsubscribe
  }
  files: {
    stat(paths: string[]): Promise<ShareSource[]>
    exists(paths: string[]): Promise<Record<string, boolean>>
    open(path: string): Promise<OpenPathResult>
    reveal(path: string): Promise<SimpleResult>
    openDownloads(): Promise<SimpleResult>
    thumbnail(path: string): Promise<ThumbnailResult>
    /** Native multi-select file/folder picker. */
    pick(): Promise<string[]>
    /** Absolute path of a dropped/picked DOM File (Electron-only). */
    pathForFile(file: File): string
  }
  qr: { generate(text: string): Promise<string> }
  app: { info(): Promise<AppInfo> }
  settings: {
    get(): Promise<Preferences>
    update(patch: PreferencesPatch): Promise<Preferences>
    onChange(cb: (prefs: Preferences) => void): Unsubscribe
  }
  library: {
    get(): Promise<LibraryData>
    setFavorite(driveId: string, favorite: boolean): Promise<LibraryData>
    setAlias(driveId: string, alias: string | null): Promise<LibraryData>
    forget(driveId: string): Promise<LibraryData>
    import(data: LibraryData): Promise<LibraryData>
  }
  engine: {
    status(): Promise<EngineStatus>
    reload(req?: EngineReloadRequest): Promise<EngineReloadResult>
    onStatus(cb: (status: EngineStatus) => void): Unsubscribe
  }
  logs: {
    path(): Promise<string>
    reveal(): Promise<SimpleResult>
    tail(lines?: number): Promise<LogTailResult>
    write(entry: RendererLogEntry): Promise<void>
  }
}
