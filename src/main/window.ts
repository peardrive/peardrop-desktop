/**
 * Main window creation + bounds persistence (window-state.json).
 */
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { identity, resolveIconPath } from './app-identity'
import type { Logger } from './logger'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function loadState(file: string): WindowState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') return parsed
  } catch {
    /* first launch */
  }
  return null
}

/** Keep restored bounds on a connected display (monitors get unplugged). */
function isVisible(state: WindowState): boolean {
  if (typeof state.x !== 'number' || typeof state.y !== 'number') return false
  return screen.getAllDisplays().some(({ workArea: a }) =>
    state.x! < a.x + a.width && state.x! + state.width > a.x && state.y! < a.y + a.height && state.y! + state.height > a.y
  )
}

export interface CreateWindowOptions {
  stateFile: string
  isDev: boolean
  profile: string | null
  log: Logger
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const saved = loadState(opts.stateFile)
  const isMac = process.platform === 'darwin'
  const title = opts.profile ? `${identity.productName} — ${opts.profile}` : identity.productName
  const icon = resolveIconPath() ?? undefined

  const win = new BrowserWindow({
    width: saved?.width ?? 1200,
    height: saved?.height ?? 820,
    ...(saved && isVisible(saved) ? { x: saved.x, y: saved.y } : {}),
    // 900px outer width keeps the desktop two-column layout comfortable;
    // 640px leaves room for the 520px modals plus the header.
    minWidth: 900,
    minHeight: 640,
    title,
    icon,
    show: false,
    backgroundColor: '#000000',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The dev renderer is served from http://localhost, which may not load
      // file:// thumbnails. Production loads from file:// and keeps the default.
      webSecurity: !opts.isDev
    }
  })

  win.once('ready-to-show', () => {
    win.show()
    if (saved?.isMaximized) win.maximize()
  })

  let saveTimer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed()) return
    try {
      const isMaximized = win.isMaximized()
      const b = isMaximized ? win.getNormalBounds() : win.getBounds()
      fs.writeFileSync(opts.stateFile, JSON.stringify({ ...b, isMaximized }, null, 2))
    } catch (err) {
      opts.log.warn('Failed to save window state', (err as Error).message)
    }
  }
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 300)
  }
  win.on('resize', scheduleSave)
  win.on('move', scheduleSave)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)

  // Never let a dropped file navigate the window away from the app.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (opts.isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}
