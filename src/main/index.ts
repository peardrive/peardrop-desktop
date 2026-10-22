/**
 * Electron main process entry.
 *
 * Only the process-level setup lives here, because it must happen before
 * Electron is ready and before anything else runs:
 *   1. Runtime config and data paths (profile and environment aware).
 *   2. App identity, including a per-profile Chromium data folder.
 *   3. Single-instance lock (per profile, so dev peers can run side by side).
 *   4. Logger, so startup failures reach disk.
 *
 * Everything after that (stores, engine, window, tray, quit) is
 * `PearDropApp` in ./peardrop-app.ts.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { resolvePeardropPaths, type PeardropPaths } from '../engine/paths'
import { identity } from './app-identity'
import { LogManager } from './logger'
import { PearDropApp } from './peardrop-app'
import { readRuntimeConfig, type RuntimeConfig } from './runtime'

/**
 * Name the app and give each profile its own Chromium data folder.
 * Must run before the single-instance lock and before the app is ready.
 */
function configureAppIdentity(runtime: RuntimeConfig): void {
  app.setName(identity.productName)

  // Each profile gets its own userData folder, and with it its own
  // single-instance lock, so `npm run dev` and `npm run dev:peer` coexist.
  if (runtime.profile) {
    app.setPath('userData', path.join(app.getPath('appData'), `${identity.productName}-${runtime.profile}`))
  }

  // Windows groups taskbar buttons and attributes notifications by this id.
  // It matches the id the installer stamps on the Start menu shortcut.
  if (process.platform === 'win32') {
    app.setAppUserModelId(identity.appId)
  }
}

/**
 * Create the log folder and the logger, and write a session header.
 */
function createLogs(paths: PeardropPaths, runtime: RuntimeConfig): LogManager {
  fs.mkdirSync(paths.root, { recursive: true })

  const manager = new LogManager({ dir: paths.logsDir, retentionDays: 14 })
  manager.init({
    app: identity.productName,
    version: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    electron: process.versions.electron,
    profile: paths.profile ?? 'default',
    bootstrap: runtime.envBootstrap ?? 'preferences/public'
  })

  // The engine and the Holepunch libraries log through console.*
  manager.mirrorConsole()
  return manager
}

const runtime = readRuntimeConfig()
const paths = resolvePeardropPaths({ home: runtime.home, profile: runtime.profile })

configureAppIdentity(runtime)

if (!app.requestSingleInstanceLock()) {
  // Two instances would fight over the same corestore locks. This one leaves;
  // the running one receives 'second-instance' and shows its window.
  console.log(`[main] ${identity.productName} is already running for this profile.`)
  app.exit(0)
} else {
  const logs = createLogs(paths, runtime)
  new PearDropApp({ runtime, paths, logs }).start()
}
