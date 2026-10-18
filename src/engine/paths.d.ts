/** Typed view of engine/paths.js — see that file for the on-disk layout. */
export interface PeardropPaths {
  root: string
  profile: string | null
  downloadsDir: string
  drivesDir: string
  stateFile: string
  preferencesFile: string
  libraryFile: string
  windowStateFile: string
  logsDir: string
}
export function resolvePeardropPaths(opts?: { home?: string; profile?: string | null }): PeardropPaths
export const DEFAULT_PATHS: PeardropPaths
export const LEGACY_ROOT: string
