/**
 * PearDropApp — the running application in the main process.
 *
 * Creates every service once, wires them to each other and to the window,
 * and owns the app lifecycle. `index.ts` does the process-level setup
 * (identity, single-instance lock, logger) and then calls `start()`.
 *
 * Boot order (see `boot()`):
 *   1. Legacy data migration.
 *   2. Stores (preferences, library).
 *   3. Engine host and the services built on it, created but not started.
 *   4. IPC handlers, tray, window.
 *   5. Engine start, after the window exists so its boot events reach the UI.
 *
 * Background mode: closing the window only hides it (preference
 * `background.closeToTray`, on by default) and PearDrop keeps running in the
 * tray / menu bar. Only Quit (tray, app menu, Cmd+Q, OS shutdown) stops the
 * engine, and it is stopped BEFORE the process exits, with persisted drive
 * states left untouched so shares resume next launch.
 */
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import type { AppCommand, IpcPushChannel, IpcPushMap } from '@shared/ipc'
import { themeScheme, type Preferences } from '@shared/preferences'
import type { StopProgress } from '@engine/backend'
import { LEGACY_ROOT, type PeardropPaths } from '@engine/paths'
import { identity } from './app-identity'
import { EngineHost } from '@engine/engine-host'
import { registerIpc, windowState } from './ipc/register'
import { push } from './ipc/typed-ipc'
import type { Logger, LogManager } from './logger'
import { migrateLegacyData } from './migration'
import { QuitWindow, type QuitProgress } from './quit-window'
import type { RuntimeConfig } from './runtime'
import { NetworkMonitor } from './services/network-monitor'
import { ReceiveQueue } from './services/receive-queue'
import { LibraryStore } from './stores/library-store'
import { PreferencesStore } from './stores/preferences-store'
import { AppTray, applyLoginItem, launchedHidden } from './tray'
import { createMainWindow, currentWindowChrome } from './window'

export interface PearDropAppOptions {
  runtime: RuntimeConfig
  paths: PeardropPaths
  logs: LogManager
}

/**
 * Window events after which the in-app window controls need the new state.
 */
const WINDOW_STATE_EVENTS = [
  'maximize',
  'unmaximize',
  'enter-full-screen',
  'leave-full-screen',
  'focus',
  'blur',
  'restore'
] as const

/**
 * Time a just-loaded renderer gets to boot and subscribe before a command is pushed.
 */
const RENDERER_BOOT_DELAY_MS = 300

/** Quit anyway if the engine has not stopped by then (a drive that hangs on close). */
const QUIT_TIMEOUT_MS = 10_000

/** The quit window's progress while the engine stops. The last 10% is "saving and closing". */
function engineStopProgress({ done, total }: StopProgress): QuitProgress {
  if (total === 0) {
    return { label: 'Stopping the network…', percent: 90 }
  }

  const noun = total === 1 ? 'share' : 'shares'
  return {
    label: `Stopping ${noun}… ${done} of ${total}`,
    percent: Math.round((done / total) * 90)
  }
}

/** Resolves true if `promise` settles within `ms`, false if the time runs out first. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  const settled = promise.then(() => true, () => true)

  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Light or dark window fill, matching the theme's canvas family.
 */
function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#08080d' : '#f4f4f5'
}

export class PearDropApp {
  private readonly runtime: RuntimeConfig
  private readonly paths: PeardropPaths
  private readonly logs: LogManager
  private readonly log: Logger

  // Filled in by boot().
  private mainWindow: BrowserWindow | null = null
  private engine: EngineHost | null = null
  private preferences: PreferencesStore | null = null
  private tray: AppTray | null = null

  /**
   * Set once a real quit starts, so closing the window is no longer turned into a hide.
   */
  private quitting = false

  /**
   * Progress of the engine shutdown that runs before the process exits.
   */
  private cleanup: 'idle' | 'running' | 'done' = 'idle'

  /** Windows is logging off or shutting down: quit silently, no quit window. */
  private sessionEnding = false

  constructor(opts: PearDropAppOptions) {
    this.runtime = opts.runtime
    this.paths = opts.paths
    this.logs = opts.logs
    this.log = opts.logs.scope('main')
  }

  /**
   * Register the app lifecycle listeners and boot once Electron is ready.
   */
  start(): void {
    // PearDrop was launched again: show this instance's window instead.
    app.on('second-instance', () => this.showWindowIfBooted())

    // macOS: clicking the Dock icon brings the (possibly hidden) window back.
    app.on('activate', () => this.showWindowIfBooted())

    app.on('window-all-closed', () => this.onAllWindowsClosed())
    app.on('before-quit', (event) => this.onBeforeQuit(event))

    app.whenReady().then(() => this.boot().catch((err) => this.handleStartupFailure(err)))
  }

  /**
   * Quit for real, bypassing close-to-tray.
   */
  quit(): void {
    this.quitting = true
    app.quit()
  }

  private async boot(): Promise<void> {
    const { paths, runtime, logs, log } = this

    const migration = migrateLegacyData(paths, LEGACY_ROOT, log.child('migration'))
    if (migration.migrated) log.info('Legacy data migrated', migration)

    const prefs = new PreferencesStore(paths.preferencesFile, log.child('preferences'))
    this.preferences = prefs

    const library = new LibraryStore(paths.libraryFile, log.child('library'))
    this.watchPreferences(prefs)

    // Engine (created here, started last)
    const host = new EngineHost({
      paths,
      bootstrapSetting: {
        get: () => prefs.get().network.bootstrap,
        save: async (value) => {
          await prefs.patch({ network: { bootstrap: value } })
        }
      },
      log: logs.scope('engine'),
      envBootstrap: runtime.envBootstrap
    })

    this.engine = host
    host.on('event', (event) => this.pushToRenderer('transfers:event', event))
    host.on('status', (status) => this.pushToRenderer('engine:status', status))

    // Services built on the engine. The receive queue subscribes to engine
    // events in its constructor, before the engine starts, so downloads that
    // resume during engine start are not missed.
    const receiveQueue = new ReceiveQueue({
      file: paths.receiveQueueFile,
      engine: host,
      log: logs.scope('receive-queue')
    })

    receiveQueue.on('change', (tasks) => this.pushToRenderer('receive:changed', tasks))

    const network = new NetworkMonitor(host)
    network.on('stats', (stats) => this.pushToRenderer('network:stats', stats))

    // IPC handlers must exist before the window loads, or the renderer's first calls would fail.
    registerIpc({
      engine: host,
      preferences: prefs,
      library,
      receiveQueue,
      network,
      logs,
      log,
      paths,
      runtime,
      getWindow: () => this.mainWindow
    })

    // Tray before window: the window needs to know whether there is a tray to hide into.
    const tray = new AppTray({
      showWindow: () => void this.showWindow(),
      runCommand: (command) => this.runCommand(command),
      quit: () => this.quit(),
      log: log.child('tray')
    })

    this.tray = tray
    tray.create()

    // Started by the login item: stay in the tray (only if there is one to come back from).
    this.mainWindow = this.openWindow({ startHidden: launchedHidden() && tray.available })

    receiveQueue.start()
    network.start()
    await this.startEngine(host)
  }

  /**
   * Start the engine. A failure keeps the UI usable (settings, logs) and shows the error there.
   */
  private async startEngine(host: EngineHost): Promise<void> {
    this.log.info('Starting engine', { root: this.paths.root })
    try {
      await host.start()
    } catch (err) {
      this.log.error('Engine failed to start', err)
    }
  }

  /**
   * Anything else that fails during boot: record it, tell the user, quit.
   */
  private handleStartupFailure(err: unknown): void {
    this.log.error('Startup failed', err)
    this.logs.flush()
    dialog.showErrorBox(`${identity.productName} failed to start`, String((err as Error)?.message ?? err))
    app.quit()
  }

  /**
   * Apply the preferences now and on every change, and mirror changes to the renderer.
   */
  private watchPreferences(prefs: PreferencesStore): void {
    this.applyLoggingAndTheme(prefs.get())

    let openAtLogin = prefs.get().background.openAtLogin
    applyLoginItem(openAtLogin, this.log)

    prefs.on('change', (next: Preferences) => {
      this.applyLoggingAndTheme(next)

      // Only touch the OS login item when that setting actually changed.
      if (next.background.openAtLogin !== openAtLogin) {
        openAtLogin = next.background.openAtLogin
        applyLoginItem(openAtLogin, this.log)
      }

      this.pushToRenderer('settings:changed', next)
    })
  }

  /**
   * The parts of the preferences that main applies itself.
   */
  private applyLoggingAndTheme(prefs: Preferences): void {
    // Debug lines reach the terminal in dev or when the debug setting is on.
    this.logs.verboseConsole = prefs.diagnostics.debug || this.runtime.isDev
    // Native title bar and menus follow the app theme.
    nativeTheme.themeSource = themeScheme(prefs.appearance.theme)
  }

  private openWindow(opts: { startHidden?: boolean } = {}): BrowserWindow {
    const win = createMainWindow({
      // Last size, position and maximized state (window-state.json).
      stateFile: this.paths.windowStateFile,
      // Dev: load the renderer from the Vite dev server and open DevTools.
      isDev: this.runtime.isDev,
      // Shown in the window title, so side-by-side profiles can be told apart.
      profile: this.paths.profile,
      log: this.log.child('window'),
      // Launched at login: create the window without showing it.
      startHidden: opts.startHidden,
      // Fill behind the page until React paints, so the window never flashes white.
      backgroundColor: windowBackground(),
      hideOnClose: () => this.shouldHideOnClose(),
      onHiddenToTray: () => this.showTrayNoticeOnce()
    })

    // Forget the window once it is really closed; showWindow() makes a new one.
    win.on('closed', () => {
      if (this.mainWindow === win) this.mainWindow = null
    })

    // The window is frameless, so the app draws its own controls and needs to
    // know when it is maximized, full screen or focused.
    const pushState = () => push(win, 'window:state', windowState(win))
    for (const event of WINDOW_STATE_EVENTS) {
      // The cast only satisfies Electron's per-event overloads of `on`.
      win.on(event as 'focus', pushState)
    }

    // Windows logoff/shutdown: let the window really close so the OS is not blocked.
    win.on('session-end', () => {
      this.quitting = true
      this.sessionEnding = true
    })

    return win
  }

  /**
   * Bring the window to the front, creating it again if it was closed.
   */
  private showWindow(): BrowserWindow {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.mainWindow = this.openWindow()
    }

    const win = this.mainWindow
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    return win
  }

  /**
   * Show the window only once boot() has created the services behind it.
   */
  private showWindowIfBooted(): void {
    if (this.engine) this.showWindow()
  }

  /**
   * Whether closing the window should only hide it, so PearDrop keeps running in the background.
   */
  private shouldHideOnClose(): boolean {
    // A real quit (Quit menu, Cmd+Q, OS shutdown) must close the window.
    if (this.quitting) return false

    // The tray icon is the only way back to a hidden window.
    if (!this.tray?.available) return false

    // "Close to tray" is on unless the user turned it off in Settings.
    return this.preferences?.get().background.closeToTray ?? true
  }

  /**
   * The first time the window hides, tell the user PearDrop is still running. Shown once, ever.
   */
  private showTrayNoticeOnce(): void {
    const prefs = this.preferences
    if (!prefs || prefs.get().background.trayNoticeShown) return

    this.tray?.notifyStillRunning()
    // Not awaited: the store updates in memory at once, so the notice cannot repeat.
    void prefs.patch({ background: { trayNoticeShown: true } })
  }

  /**
   * Show the window, then ask the renderer to run a tray command (Send…, Receive…).
   */
  private runCommand(command: AppCommand): void {
    const win = this.showWindow()
    const send = () => push(win, 'app:command', command)

    if (win.webContents.isLoading()) {
      // A window created just now has not loaded the renderer yet.
      win.webContents.once('did-finish-load', () => setTimeout(send, RENDERER_BOOT_DELAY_MS))
    } else {
      send()
    }
  }

  /**
   * Send a push to the current window. Dropped when there is none.
   */
  private pushToRenderer<C extends IpcPushChannel>(channel: C, payload: IpcPushMap[C]): void {
    push(this.mainWindow, channel, payload)
  }

  /**
   * Electron does not await async 'before-quit' handlers. So the first quit is
   * cancelled, the engine is stopped to completion, and then the app quits
   * again; that second pass goes straight through.
   */
  private onBeforeQuit(event: Electron.Event): void {
    this.quitting = true
    if (this.cleanup === 'done') return

    event.preventDefault()
    // A second quit request while cleaning up (e.g. Cmd+Q twice) just waits.
    if (this.cleanup === 'running') return

    this.cleanup = 'running'
    void this.cleanUpThenQuit()
  }

  private async cleanUpThenQuit(): Promise<void> {
    const quitWindow = this.sessionEnding
      ? null
      : new QuitWindow({
        chrome: currentWindowChrome(),
        alwaysShow: this.runtime.quitWindow === 'always'
      })
    quitWindow?.scheduleShow()

    try {
      // force: skip the DHT unannounce. Announcements expire on their own, and
      // waiting for them is most of the quit time.
      const stopping = this.engine?.stop({
        force: true,
        onProgress: (progress) => quitWindow?.update(engineStopProgress(progress))
      })

      const stopped = await settlesWithin(stopping ?? Promise.resolve(), QUIT_TIMEOUT_MS)
      if (stopped) {
        this.log.info('Engine stopped cleanly on quit')
      } else {
        this.log.warn('Engine did not stop in time — quitting anyway', { timeoutMs: QUIT_TIMEOUT_MS })
      }
    } catch (err) {
      this.log.error('Cleanup error', err)
    } finally {
      quitWindow?.update({ label: 'Saving and closing…', percent: 100 })
      this.tray?.destroy()
      this.logs.flush()

      await quitWindow?.close()

      this.cleanup = 'done'
      app.quit()
    }
  }

  /**
   * With close-to-tray the window is hidden, not closed, so this only runs when
   * background mode is off or there is no tray: closing then means quitting.
   * On macOS the app stays in the menu bar when it can.
   */
  private onAllWindowsClosed(): void {
    if (process.platform !== 'darwin' || !this.tray?.available) this.quit()
  }
}
