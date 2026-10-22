/**
 * Electron main process entry.
 *
 * Boot order for the application:
 *   1. runtime config + paths (profile/env aware)
 *   2. single-instance lock (per profile — dev peers can run side by side)
 *   3. logger (so startup failures are on disk), then legacy data migration
 *   4. stores (preferences, library), IPC handlers, window
 *   5. engine start after the window exists, so boot events reach the UI.
 *   6. graceful quit: the engine is stopped BEFORE the process exits, with
 *      persisted drive states left untouched so shares resume next launch.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import type { AppCommand } from '@shared/ipc'
import { themeScheme, type Preferences } from '@shared/preferences'
import { LEGACY_ROOT, resolvePeardropPaths } from '../engine/paths'
import { identity } from './app-identity'
import { EngineHost } from './engine/engine-host'
import { registerIpc, windowState } from './ipc/register'
import { push } from './ipc/typed-ipc'
import { LogManager } from './logger'
import { migrateLegacyData } from './migration'
import { readRuntimeConfig } from './runtime'
import { NetworkMonitor } from './services/network-monitor'
import { ReceiveQueue } from './services/receive-queue'
import { LibraryStore } from './stores/library-store'
import { PreferencesStore } from './stores/preferences-store'
import { AppTray, applyLoginItem, launchedHidden } from './tray'
import { createMainWindow } from './window'

const runtime = readRuntimeConfig()
const paths = resolvePeardropPaths({
  home: runtime.home,
  profile: runtime.profile
})

app.setName(identity.productName)

// Each profile gets its own Chromium userData (and therefore its own
// single-instance lock), so `npm run dev` and `npm run dev:peer` coexist.
if (runtime.profile) {
  app.setPath(
    'userData', path.join(app.getPath('appData'), `${identity.productName}-${runtime.profile}`))
}
if (process.platform === 'win32') app.setAppUserModelId(identity.appId)

if (!app.requestSingleInstanceLock()) {
  // Two instances fight over the same corestore locks; the second one leaves.
  console.log(`[main] ${identity.productName} is already running for this profile — exiting`)
  app.exit(0)
}

fs.mkdirSync(paths.root, { recursive: true })
const logs = new LogManager({ dir: paths.logsDir, retentionDays: 14 })
logs.init({
  app: identity.productName,
  version: app.getVersion(),
  platform: `${process.platform} ${process.arch}`,
  electron: process.versions.electron,
  profile: paths.profile ?? 'default',
  bootstrap: runtime.envBootstrap ?? 'preferences/public'
})
logs.mirrorConsole()
const log = logs.scope('main')

let mainWindow: BrowserWindow | null = null
let engine: EngineHost | null = null
let preferences: PreferencesStore | null = null
let tray: AppTray | null = null
/** Set once a real quit starts, so the window's close is no longer turned into a hide. */
let quitting = false

function openWindow(opts: { startHidden?: boolean } = {}): BrowserWindow {
  const win = createMainWindow({
    stateFile: paths.windowStateFile,
    isDev: runtime.isDev,
    profile: paths.profile,
    log: log.child('window'),
    startHidden: opts.startHidden,
    backgroundColor: windowBackground(),
    // Only hide when there is a tray to come back from.
    hideOnClose: () => !quitting && !!tray?.available && (preferences?.get().background.closeToTray ?? true),
    onHiddenToTray: () => {
      if (!preferences || preferences.get().background.trayNoticeShown) return
      tray?.notifyStillRunning()
      void preferences.patch({ background: { trayNoticeShown: true } })
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // The in-app window controls mirror these.
  const pushState = () => push(win, 'window:state', windowState(win))
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'restore'] as const) {
    win.on(ev as 'focus', pushState)
  }
  // Windows logoff/shutdown: let the window close so the OS is not blocked.
  win.on('session-end', () => {
    quitting = true
  })
  return win
}

function showWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = openWindow()
  const win = mainWindow
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  return win
}

function runCommand(command: AppCommand) {
  const win = showWindow()
  const send = () => push(win, 'app:command', command)
  // A window created just now has not loaded the renderer yet.
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 300))
  else send()
}

function quitApp() {
  quitting = true
  app.quit()
}

function applyNativeTheme(prefs: Preferences) {
  // Native title bar and menus follow the app theme.
  nativeTheme.themeSource = themeScheme(prefs.appearance.theme)
}

/** Light or dark window fill, matching the theme's canvas family. */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#08080d' : '#f4f4f5'
}

app.on('second-instance', () => {
  if (engine) showWindow()
})

async function boot() {
  const migration = migrateLegacyData(paths, LEGACY_ROOT, log.child('migration'))
  if (migration.migrated) log.info('Legacy data migrated', migration)

  const prefs = new PreferencesStore(paths.preferencesFile, log.child('preferences'))
  preferences = prefs
  const library = new LibraryStore(paths.libraryFile, log.child('library'))
  logs.verboseConsole = prefs.get().diagnostics.debug || runtime.isDev
  applyNativeTheme(prefs.get())
  let openAtLogin = prefs.get().background.openAtLogin
  applyLoginItem(openAtLogin, log)
  prefs.on('change', (next: Preferences) => {
    logs.verboseConsole = next.diagnostics.debug || runtime.isDev
    applyNativeTheme(next)
    if (next.background.openAtLogin !== openAtLogin) {
      openAtLogin = next.background.openAtLogin
      applyLoginItem(openAtLogin, log)
    }
    push(mainWindow, 'settings:changed', next)
  })

  const host = new EngineHost({ paths, preferences: prefs, log: logs.scope('engine'), envBootstrap: runtime.envBootstrap })
  engine = host
  host.on('event', (event) => push(mainWindow, 'transfers:event', event))
  host.on('status', (status) => push(mainWindow, 'engine:status', status))

  // Subscribes to engine events in its constructor — before the engine starts,
  // so resumed downloads announced during init are not missed.
  const receiveQueue = new ReceiveQueue({ file: paths.receiveQueueFile, engine: host, log: logs.scope('receive-queue') })
  receiveQueue.on('change', (tasks) => push(mainWindow, 'receive:changed', tasks))
  const network = new NetworkMonitor(host)
  network.on('stats', (stats) => push(mainWindow, 'network:stats', stats))

  registerIpc({ engine: host, preferences: prefs, library, receiveQueue, network, logs, log, paths, runtime, getWindow: () => mainWindow })

  tray = new AppTray({ showWindow: () => void showWindow(), runCommand, quit: quitApp, log: log.child('tray') })
  tray.create()
  // Started by the login item: stay in the tray (only if there is one to come back from).
  mainWindow = openWindow({ startHidden: launchedHidden() && tray.available })

  receiveQueue.start()
  network.start()
  log.info('Starting engine', { root: paths.root })
  try {
    await engine.start()
  } catch (err) {
    // The UI stays usable (settings, logs) and shows the engine error.
    log.error('Engine failed to start', err)
  }
}

app.whenReady().then(() =>
  boot().catch((err) => {
    log.error('Startup failed', err)
    logs.flush()
    dialog.showErrorBox(`${identity.productName} failed to start`, String((err as Error)?.message ?? err))
    app.quit()
  })
)

// macOS: clicking the Dock icon brings the (possibly hidden) window back.
app.on('activate', () => {
  if (engine) showWindow()
})

// With close-to-tray the window is hidden, not closed, so this only runs when
// background mode is off (or there is no tray): then closing means quitting.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || !tray?.available) quitApp()
})

// Electron does not await async before-quit handlers: cancel the first quit,
// stop the engine to completion, then quit for real.
let cleanupDone = false
let cleanupStarted = false
app.on('before-quit', (event) => {
  quitting = true
  if (cleanupDone) return
  event.preventDefault()
  if (cleanupStarted) return
  cleanupStarted = true
  void (async () => {
    try {
      await engine?.stop()
      log.info('Engine stopped cleanly on quit')
    } catch (err) {
      log.error('Cleanup error', err)
    } finally {
      tray?.destroy()
      logs.flush()
      cleanupDone = true
      app.quit()
    }
  })()
})
