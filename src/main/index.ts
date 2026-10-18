/**
 * Electron main process entry.
 *
 * Boot order matters:
 *   1. runtime config + paths (profile/env aware)
 *   2. single-instance lock (per profile — dev peers can run side by side)
 *   3. logger (so startup failures are on disk), then legacy data migration
 *   4. stores (preferences, library), IPC handlers, window
 *   5. engine start — after the window exists, so boot events reach the UI
 *   6. graceful quit: the engine is stopped BEFORE the process exits, with
 *      persisted drive states left untouched so shares resume next launch.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import { LEGACY_ROOT, resolvePeardropPaths } from '../engine/paths'
import { identity } from './app-identity'
import { EngineHost } from './engine/engine-host'
import { registerIpc } from './ipc/register'
import { push } from './ipc/typed-ipc'
import { LogManager } from './logger'
import { migrateLegacyData } from './migration'
import { readRuntimeConfig } from './runtime'
import { LibraryStore } from './stores/library-store'
import { PreferencesStore } from './stores/preferences-store'
import { createMainWindow } from './window'

const runtime = readRuntimeConfig()
const paths = resolvePeardropPaths({ home: runtime.home, profile: runtime.profile })

app.setName(identity.productName)
// Each profile gets its own Chromium userData (and therefore its own
// single-instance lock), so `npm run dev` and `npm run dev:peer` coexist.
if (runtime.profile) app.setPath('userData', path.join(app.getPath('appData'), `${identity.productName}-${runtime.profile}`))
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

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

async function boot() {
  const migration = migrateLegacyData(paths, LEGACY_ROOT, log.child('migration'))
  if (migration.migrated) log.info('Legacy data migrated', migration)

  const preferences = new PreferencesStore(paths.preferencesFile, log.child('preferences'))
  const library = new LibraryStore(paths.libraryFile, log.child('library'))
  logs.verboseConsole = preferences.get().diagnostics.debug || runtime.isDev
  preferences.on('change', (prefs) => {
    logs.verboseConsole = prefs.diagnostics.debug || runtime.isDev
    push(mainWindow, 'settings:changed', prefs)
  })

  engine = new EngineHost({ paths, preferences, log: logs.scope('engine'), envBootstrap: runtime.envBootstrap })
  engine.on('event', (event) => push(mainWindow, 'transfers:event', event))
  engine.on('status', (status) => push(mainWindow, 'engine:status', status))

  registerIpc({ engine, preferences, library, logs, log, paths, runtime, getWindow: () => mainWindow })

  mainWindow = createMainWindow({ stateFile: paths.windowStateFile, isDev: runtime.isDev, profile: paths.profile, log: log.child('window') })
  mainWindow.on('closed', () => (mainWindow = null))

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

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && engine) {
    mainWindow = createMainWindow({ stateFile: paths.windowStateFile, isDev: runtime.isDev, profile: paths.profile, log: log.child('window') })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Electron does not await async before-quit handlers: cancel the first quit,
// stop the engine to completion, then quit for real.
let cleanupDone = false
let cleanupStarted = false
app.on('before-quit', (event) => {
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
      logs.flush()
      cleanupDone = true
      app.quit()
    }
  })()
})
