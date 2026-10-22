/**
 * Main window creation + bounds persistence (window-state.json).
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, screen } from 'electron'
import type { WindowFrame } from '@shared/app-info'
import { WINDOWS_TITLEBAR_HEIGHT, type WindowChrome } from '@shared/ipc'
import { identity, resolveIconPath } from './app-identity'
import type { Logger } from './logger'

/** Bumped when default sizing changes so old, oversized bounds are not restored. */
const STATE_VERSION = 2

/** Compact by default (the Figma frame is 800×600); the layout scales up to fill big screens. */
export const DEFAULT_SIZE = { width: 900, height: 600 }
/** Smallest window: the sidebar folds to icons and the list becomes a single column. */
export const MIN_SIZE = { width: 600, height: 440 }

interface WindowState {
  v?: number
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function loadState(file: string): WindowState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null
    // Bounds saved by the old, larger layout: keep the position, use the new size.
    if (parsed.v !== STATE_VERSION) return { ...parsed, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, isMaximized: false }
    return parsed
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
  /** Window fill behind the page (matches the theme so a resize never flashes). */
  backgroundColor?: string
  /** Create without showing (launched hidden into the tray). */
  startHidden?: boolean
  /** Asked on every close: true keeps the app alive and only hides the window. */
  hideOnClose?: () => boolean
  /** Called after a close was turned into a hide. */
  onHiddenToTray?: () => void
}

/**
 * Window chrome per platform:
 *  - macOS: no title bar ('hidden' keeps the rounded shape and shadow); the
 *    native traffic lights are turned off and the app draws its own in the
 *    sidebar, whose top row is the drag area.
 *  - Windows: the real frame and the real caption buttons (snap layouts,
 *    Aero Snap, accessibility all native) via Window Controls Overlay; the
 *    title bar strip is drawn by the app and the overlay is recoloured to
 *    the active theme (`applyWindowChrome`).
 *  - Linux: the normal window-manager frame; it follows the theme's light /
 *    dark appearance (nativeTheme) since WMs do not take custom colours.
 */
/**
 * The frame style for this run: the OS's own, unless a development run asks
 * for another one (`PEARDROP_WINDOW_FRAME=mac|windows|native`, used by
 * `npm run dev:mac`) to preview a platform's window chrome. Ignored in
 * packaged builds.
 */
export function resolveWindowFrame(): WindowFrame {
  const forced = (process.env.PEARDROP_WINDOW_FRAME || '').trim().toLowerCase()
  if (!app.isPackaged && (forced === 'mac' || forced === 'windows' || forced === 'native')) {
    // A Windows title bar overlay only exists on Windows.
    if (forced !== 'windows' || process.platform === 'win32') return forced
  }
  return process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'native'
}

function chromeOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  const frame = resolveWindowFrame()
  // macOS: hidden title bar keeps the window shape; elsewhere (dev preview of
  // the Mac chrome) that is a plain frameless window.
  if (frame === 'mac') return process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : { frame: false }
  if (frame === 'windows') {
    const c = lastChrome ?? { background: '#08080d', foreground: '#f3f4f6' }
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: c.background, symbolColor: c.foreground, height: WINDOWS_TITLEBAR_HEIGHT } }
  }
  return {}
}

/** Colours last sent by the renderer, so a re-created window starts right. */
let lastChrome: WindowChrome | null = null

const HEX = /^#[0-9a-f]{6}$/i

/** Paint the window chrome in the active theme (called by the renderer on every theme change). */
export function applyWindowChrome(win: BrowserWindow, chrome: WindowChrome): void {
  if (!HEX.test(chrome.background) || !HEX.test(chrome.foreground) || win.isDestroyed()) return
  lastChrome = chrome
  win.setBackgroundColor(chrome.background)
  if (resolveWindowFrame() === 'windows') {
    try {
      win.setTitleBarOverlay({ color: chrome.background, symbolColor: chrome.foreground, height: WINDOWS_TITLEBAR_HEIGHT })
    } catch {
      /* overlay unavailable */
    }
  }
}

export function createMainWindow(opts: CreateWindowOptions): BrowserWindow {
  const saved = loadState(opts.stateFile)
  const title = opts.profile ? `${identity.productName} — ${opts.profile}` : identity.productName
  const icon = resolveIconPath() ?? undefined

  const win = new BrowserWindow({
    width: Math.max(saved?.width ?? DEFAULT_SIZE.width, MIN_SIZE.width),
    height: Math.max(saved?.height ?? DEFAULT_SIZE.height, MIN_SIZE.height),
    ...(saved && isVisible(saved) ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title,
    icon,
    show: false,
    backgroundColor: opts.backgroundColor ?? '#08080d',
    ...chromeOptions(),
    autoHideMenuBar: true,
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

  if (process.platform === 'darwin') win.setWindowButtonVisibility(false)
  if (lastChrome) applyWindowChrome(win, lastChrome)

  win.once('ready-to-show', () => {
    if (opts.startHidden) return
    win.show()
    if (saved?.isMaximized) win.maximize()
  })

  let saveTimer: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed()) return
    try {
      const isMaximized = win.isMaximized()
      const b = isMaximized ? win.getNormalBounds() : win.getBounds()
      fs.writeFileSync(opts.stateFile, JSON.stringify({ v: STATE_VERSION, ...b, isMaximized }, null, 2))
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
  win.on('close', (e) => {
    save()
    if (opts.hideOnClose?.()) {
      // Keep the renderer alive: transfers, the receive queue and the
      // network panel carry on while the window is away.
      e.preventDefault()
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide())
        win.setFullScreen(false)
      } else {
        win.hide()
      }
      opts.onHiddenToTray?.()
    }
  })

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
