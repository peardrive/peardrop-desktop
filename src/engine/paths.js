/**
 * MODULE: engine/paths.js
 * PURPOSE: Single source of truth for PearDrop's on-disk layout (~/.peardrop)
 * EXPORTS:
 * resolvePeardropPaths(opts) - Build the full path map for a data root/profile
 * DEFAULT_PATHS - Paths for the default root (CLI + engine singleton)
 * LEGACY_ROOT - Pre-0.29 data root (~/peardrop), used by the one-time migration
 * LAYOUT (root = $PEARDROP_HOME or ~/.peardrop, profile adds /profiles/<name>):
 * downloads/         - received files land here (shared files stay where they are)
 * drives/            - per-drive Corestore folders
 * drives-state.json  - engine's drive manifest (single source of truth)
 * preferences.json   - user settings (theme, network, debug)
 * library.json       - UI library data (favorites, aliases)
 * receive-queue.json - pasted links still waiting for their sender (desktop app)
 * window-state.json  - last window bounds
 * logs/              - daily rotated logs, 14-day retention
 * EXTERNAL CALLS: os, path
 * KEY STATE: none (pure)
 */

const os = require('os')
const path = require('path')

const LEGACY_ROOT = path.join(os.homedir(), 'peardrop')

const createSafeFolderName = str => {
  return String(str).replace(/[^a-z0-9_-]/gi, '');
}

/**
 * @param {{ home?: string, profile?: string|null }} [opts]
 *   home    - data root override (defaults to $PEARDROP_HOME or ~/.peardrop)
 *   profile - optional named profile; isolates all state under root/profiles/<name>
 */
function resolvePeardropPaths(opts = {}) {
  const baseRoot = opts.home ||
    process.env.PEARDROP_HOME ||
    path.join(os.homedir(), '.peardrop')

  const profile = opts.profile ? createSafeFolderName(opts.profile) : ''

  const root = profile ? path.join(baseRoot, 'profiles', profile) : baseRoot

  return {
    root,
    profile: profile || null,
    downloadsDir: path.join(root, 'downloads'),
    drivesDir: path.join(root, 'drives'),
    stateFile: path.join(root, 'drives-state.json'),
    preferencesFile: path.join(root, 'preferences.json'),
    libraryFile: path.join(root, 'library.json'),
    receiveQueueFile: path.join(root, 'receive-queue.json'),
    windowStateFile: path.join(root, 'window-state.json'),
    logsDir: path.join(root, 'logs')
  }
}

const DEFAULT_PATHS = resolvePeardropPaths({ 
  profile: process.env.PEARDROP_PROFILE || null 
})

module.exports = { resolvePeardropPaths, DEFAULT_PATHS, LEGACY_ROOT }
