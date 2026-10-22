/**
 * PearDrop's on-disk layout: the single place that decides where every file
 * and folder lives.
 *
 * Layout under the data root (`~/.peardrop`, or `<home>/profiles/<name>`):
 *
 *   downloads/          received files (shared files stay where they are)
 *   drives/             one Corestore folder per drive
 *   drives-state.json   the engine's list of drives (source of truth)
 *   preferences.json    user settings
 *   library.json        favorites and aliases
 *   receive-queue.json  links still waiting for their sender
 *   window-state.json   last window size and position
 *   logs/               daily log files, kept for 14 days
 */
import os from 'node:os'
import path from 'node:path'

/** Absolute paths for one data root. Nothing here is created or checked on disk. */
export interface PeardropPaths {
  /** The data root every other path lives under. */
  root: string
  /** The cleaned profile name in use, or null for the default profile. */
  profile: string | null
  downloadsDir: string
  drivesDir: string
  stateFile: string
  preferencesFile: string
  libraryFile: string
  /** Pasted links waiting for their sender (desktop receive queue). */
  receiveQueueFile: string
  windowStateFile: string
  logsDir: string
}

export interface ResolvePathsOptions {
  /** Data root override. Defaults to `~/.peardrop`. */
  home?: string
  /** Optional profile name; isolates all state under `<home>/profiles/<name>`. */
  profile?: string | null
}

/** Pre-0.29 data root, used only by the one-time migration. */
export const LEGACY_ROOT = path.join(os.homedir(), 'peardrop')

/**
 * Keep only ASCII letters, digits, `_` and `-`, so a profile name is always
 * a single safe folder name (no separators, no `..`).
 */
export function createSafeFolderName(value: string): string {
  return String(value).replace(/[^a-z0-9_-]/gi, '')
}

/**
 * Build the path map for a data root and optional profile.
 * Pure: reads no environment variables and touches no files.
 */
export function resolvePeardropPaths(opts: ResolvePathsOptions = {}): PeardropPaths {
  const baseRoot = opts.home || path.join(os.homedir(), '.peardrop')
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
