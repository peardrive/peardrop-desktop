/**
 * One-time move from the pre-0.29 data root (~/peardrop) to ~/.peardrop.
 *
 * What moves: the engine state (drives-state.json) and the Corestore folders
 * (drives/), with every stored `storagePath` rewritten to the new location.
 * Without this every existing share would vanish from the list.
 *
 * What stays: ~/peardrop/downloads. Downloaded files are referenced by their
 * absolute paths in the state file, so they keep opening from where they are;
 * new downloads go to ~/.peardrop/downloads. Nothing is ever deleted — the
 * old state file is renamed to *.migrated as a backup.
 *
 * Runs only for the default profile, only when the new state file does not
 * exist yet, and after the single-instance lock is held (so no other
 * PearDrop process can be holding the corestores open).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { PeardropPaths } from '../engine/paths'
import type { Logger } from './logger'

export interface MigrationOutcome {
  migrated: boolean
  reason: string
  drives?: number
}

const exists = (p: string) => {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

export function migrateLegacyData(paths: PeardropPaths, legacyRoot: string, log: Logger): MigrationOutcome {
  if (paths.profile) return { migrated: false, reason: 'profile in use' }
  const legacyState = path.join(legacyRoot, 'drives-state.json')
  if (!exists(legacyState)) return { migrated: false, reason: 'no legacy data' }
  if (exists(paths.stateFile)) return { migrated: false, reason: 'already migrated' }

  const legacyDrives = path.join(legacyRoot, 'drives')
  log.info('Migrating legacy data root', { from: legacyRoot, to: paths.root })

  let state: { drives?: Record<string, { storagePath?: string }> }
  try {
    state = JSON.parse(fs.readFileSync(legacyState, 'utf8'))
  } catch (err) {
    log.warn('Legacy state unreadable — skipping migration', { error: (err as Error).message })
    return { migrated: false, reason: 'legacy state unreadable' }
  }

  fs.mkdirSync(paths.root, { recursive: true })

  if (exists(legacyDrives)) {
    if (exists(paths.drivesDir) && fs.readdirSync(paths.drivesDir).length > 0) {
      log.warn('Target drives folder is not empty — skipping migration', { target: paths.drivesDir })
      return { migrated: false, reason: 'target not empty' }
    }
    try {
      if (exists(paths.drivesDir)) fs.rmdirSync(paths.drivesDir)
      fs.renameSync(legacyDrives, paths.drivesDir)
    } catch (err) {
      // Typically EBUSY/EPERM: something still holds a corestore open. Leave
      // everything where it is; the next launch tries again.
      log.warn('Could not move drives folder — will retry next launch', { error: (err as Error).message })
      return { migrated: false, reason: 'drives folder busy' }
    }
  }

  const rewrite = (p?: string) => {
    if (!p) return p
    const rel = path.relative(legacyDrives, p)
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? path.join(paths.drivesDir, rel) : p
  }
  for (const entry of Object.values(state.drives ?? {})) {
    if (entry && typeof entry === 'object') entry.storagePath = rewrite(entry.storagePath)
  }

  const tmp = `${paths.stateFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
  fs.renameSync(tmp, paths.stateFile)
  try {
    fs.renameSync(legacyState, `${legacyState}.migrated`)
  } catch {
    /* backup rename is best-effort */
  }

  for (const name of ['window-state.json']) {
    const from = path.join(legacyRoot, name)
    const to = path.join(paths.root, name)
    if (exists(from) && !exists(to)) {
      try {
        fs.copyFileSync(from, to)
      } catch {
        /* cosmetic */
      }
    }
  }

  try {
    fs.writeFileSync(
      path.join(legacyRoot, 'MOVED-TO-.peardrop.txt'),
      `PearDrop moved its data to ${paths.root} on ${new Date().toISOString()}.\n` +
        `Files in ${path.join(legacyRoot, 'downloads')} were left in place and still open from the app.\n`
    )
  } catch {
    /* informational only */
  }

  const drives = Object.keys(state.drives ?? {}).length
  log.info('Legacy data migrated', { drives })
  return { migrated: true, reason: 'ok', drives }
}
