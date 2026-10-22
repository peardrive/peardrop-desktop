/**
 * Every IPC handler, grouped by concern. Handlers stay thin: they validate
 * input, delegate to a service/store/EngineHost and return contract shapes.
 */
import fs from 'node:fs/promises'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import QRCode from 'qrcode'
import type { AppInfo } from '@shared/app-info'
import type { WindowState } from '@shared/ipc'
import { applyWindowChrome, resolveWindowFrame } from '../window'
import type { ShareResult } from '@shared/transfer'
import type { PeardropPaths } from '@engine/paths'
import { identity, iconDataUrl } from '../app-identity'
import { ShareCancelledError } from '@engine/backend'
import type { EngineHost } from '@engine/engine-host'
import type { Logger, LogManager } from '../logger'
import type { RuntimeConfig } from '../runtime'
import { pathsExist, statPaths } from '../services/file-stats'
import type { NetworkMonitor } from '../services/network-monitor'
import type { ReceiveQueue } from '../services/receive-queue'
import { buildShareInput, EmptyShareError } from '../services/share-input'
import { thumbnailFor } from '../services/thumbnails'
import type { LibraryStore } from '../stores/library-store'
import type { PreferencesStore } from '../stores/preferences-store'
import { handle } from './typed-ipc'

export interface IpcDeps {
  engine: EngineHost
  preferences: PreferencesStore
  library: LibraryStore
  receiveQueue: ReceiveQueue
  network: NetworkMonitor
  logs: LogManager
  log: Logger
  paths: PeardropPaths
  runtime: RuntimeConfig
  getWindow: () => BrowserWindow | null
}

export function windowState(win: BrowserWindow | null): WindowState {
  if (!win || win.isDestroyed()) return { maximized: false, fullScreen: false, focused: false }
  return { maximized: win.isMaximized(), fullScreen: win.isFullScreen(), focused: win.isFocused() }
}

export function registerIpc(d: IpcDeps): void {
  const log = d.log.child('ipc')
  const withEngine = d.engine.withBackend.bind(d.engine)

  // ── transfers ────────────────────────────────────────────────────────
  handle('transfers:snapshot', () => withEngine((b) => b.snapshot()), log)
  handle(
    'transfers:share',
    async (req): Promise<ShareResult> => {
      try {
        const input = buildShareInput(req.sources, { name: req.name, clientJobId: req.clientJobId })
        const out = await withEngine((b) => b.createShare(input))
        return { success: true, driveId: out.driveId, shareLink: out.shareLink, files: out.files, record: out.record }
      } catch (err) {
        if (err instanceof ShareCancelledError) {
          log.info('Share cancelled by user')
          return { success: false, cancelled: true, error: 'Share cancelled' }
        }
        if (!(err instanceof EmptyShareError)) log.error('Share failed', err)
        return { success: false, error: (err as Error).message }
      }
    },
    log
  )
  handle('transfers:cancel-share', (id) => withEngine((b) => ({ success: b.cancelShare(id) })), log)
  handle('transfers:check-link', (link) => withEngine((b) => b.checkLink(link)), log)
  handle('transfers:open', (link, opts) => withEngine((b) => b.open(link, opts)), log)
  handle('transfers:download', (req) => withEngine((b) => b.download(req)), log)
  handle('transfers:cancel-download', (id) => withEngine((b) => b.cancelDownload(id)), log)
  handle('transfers:get', (id) => withEngine((b) => b.get(id)), log)
  handle('transfers:pause', (id) => withEngine((b) => b.pause(id)), log)
  handle('transfers:resume', (id) => withEngine((b) => b.resume(id)), log)
  handle('transfers:remove', (id, opts) => withEngine((b) => b.remove(id, opts)), log)

  // ── receive queue ────────────────────────────────────────────────────
  handle('receive:list', () => d.receiveQueue.list())
  handle('receive:add', (link) => d.receiveQueue.add(link), log)
  handle('receive:remove', (id) => d.receiveQueue.remove(id), log)
  handle('receive:retry', (id) => d.receiveQueue.retry(id))

  // ── local files ──────────────────────────────────────────────────────
  handle('files:stat', (paths) => statPaths(paths, log), log)
  handle('files:exists', (paths) => pathsExist(paths), log)
  handle(
    'files:open',
    async (filePath) => {
      if (!filePath) return { success: false, error: 'No file path provided' }
      // Check first: Windows answers a missing path with its own dialog the
      // app cannot style or explain.
      try {
        await fs.access(filePath)
      } catch {
        return { success: false, missing: true, error: 'File no longer exists on disk' }
      }
      const err = await shell.openPath(filePath)
      return err ? { success: false, error: err } : { success: true }
    },
    log
  )
  handle('files:reveal', (filePath) => {
    if (!filePath) return { success: false, error: 'No file path provided' }
    shell.showItemInFolder(filePath)
    return { success: true }
  })
  handle('files:open-downloads', async () => {
    await fs.mkdir(d.paths.downloadsDir, { recursive: true })
    const err = await shell.openPath(d.paths.downloadsDir)
    return err ? { success: false, error: err } : { success: true }
  })
  handle('files:thumbnail', (p) => thumbnailFor(p))
  handle('files:pick', async () => {
    const win = d.getWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose files to share',
      // Windows/Linux cannot mix file and folder selection in one dialog;
      // files there, folders can still be dropped.
      properties: process.platform === 'darwin' ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths
  })

  // ── misc ─────────────────────────────────────────────────────────────
  handle('qr:generate', (text) => QRCode.toDataURL(text, { width: 320, margin: 1, color: { dark: '#000000', light: '#ffffff' } }))
  let cachedInfo: AppInfo | null = null
  handle('app:info', () => {
    cachedInfo ??= {
      identity,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      windowFrame: resolveWindowFrame(),
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      iconDataUrl: iconDataUrl(),
      isDev: d.runtime.isDev,
      profile: d.paths.profile,
      paths: { root: d.paths.root, downloads: d.paths.downloadsDir, logs: d.paths.logsDir, preferences: d.paths.preferencesFile }
    }
    return cachedInfo
  })

  // ── settings & library ───────────────────────────────────────────────
  handle('settings:get', () => d.preferences.get())
  handle('settings:update', (patch) => d.preferences.patch(patch), log)
  handle('library:get', () => d.library.get())
  handle('library:set-favorite', (id, fav) => d.library.setFavorite(id, fav))
  handle('library:set-alias', (id, alias) => d.library.setAlias(id, alias))
  handle('library:forget', (id) => d.library.forget(id))
  handle('library:import', (data) => d.library.importFrom(data))

  // ── engine ───────────────────────────────────────────────────────────
  handle('engine:status', () => d.engine.getStatus())
  handle('engine:reload', (req) => d.engine.reload(req ?? {}), log)
  handle('network:stats', () => d.network.get())

  // ── window controls (frameless window) ───────────────────────────────
  handle('window:state', () => windowState(d.getWindow()))
  handle('window:set-chrome', (chrome) => {
    const win = d.getWindow()
    if (win) applyWindowChrome(win, chrome)
  })
  handle('window:action', (action) => {
    const win = d.getWindow()
    if (!win || win.isDestroyed()) return windowState(null)
    switch (action) {
      case 'close':
        // Same path as the OS close button: hides to the tray when enabled.
        win.close()
        break
      case 'minimize':
        win.minimize()
        break
      case 'toggle-full-screen':
        win.setFullScreen(!win.isFullScreen())
        break
      case 'toggle-maximize':
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        break
    }
    return windowState(win)
  })

  // ── logs ─────────────────────────────────────────────────────────────
  handle('logs:path', () => d.logs.currentFile())
  handle('logs:reveal', async () => {
    d.logs.flush()
    const err = await shell.openPath(d.logs.dir)
    return err ? { success: false, error: err } : { success: true }
  })
  handle('logs:tail', (lines) => {
    try {
      return { success: true, text: d.logs.tail(Math.min(Math.max(lines ?? 300, 1), 5000)), path: d.logs.currentFile() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  handle('logs:write', (entry) => {
    d.logs.write(entry.level, `ui:${entry.scope}`, entry.message, entry.data)
  })
}
