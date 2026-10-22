import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePeardropPaths } from '@engine/paths'
import { describe, expect, it } from 'vitest'
import { migrateLegacyData } from './migration'
import type { Logger } from './logger'

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log }

describe('migrateLegacyData', () => {
  it('moves drives + state from ~/peardrop and rewrites storage paths', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-mig-'))
    const legacy = path.join(base, 'peardrop')
    fs.mkdirSync(path.join(legacy, 'drives', 'drive_1'), { recursive: true })
    fs.writeFileSync(path.join(legacy, 'drives', 'drive_1', 'blob'), 'data')
    const dl = path.join(legacy, 'downloads', 'a.txt')
    fs.writeFileSync(
      path.join(legacy, 'drives-state.json'),
      JSON.stringify({ drives: { drive_1: { driveId: 'drive_1', storagePath: path.join(legacy, 'drives', 'drive_1'), files: [{ path: dl }] } }, stats: {} })
    )
    const paths = resolvePeardropPaths({ home: path.join(base, '.peardrop') })
    const out = migrateLegacyData(paths, legacy, log)
    expect(out).toMatchObject({ migrated: true, drives: 1 })
    const state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'))
    expect(state.drives.drive_1.storagePath).toBe(path.join(paths.drivesDir, 'drive_1'))
    expect(state.drives.drive_1.files[0].path).toBe(dl) // downloads stay where they are
    expect(fs.readFileSync(path.join(paths.drivesDir, 'drive_1', 'blob'), 'utf8')).toBe('data')
    expect(fs.existsSync(path.join(legacy, 'drives-state.json.migrated'))).toBe(true)
    // idempotent
    expect(migrateLegacyData(paths, legacy, log).migrated).toBe(false)
    fs.rmSync(base, { recursive: true, force: true })
  })

  it('never runs for a named profile', () => {
    const paths = resolvePeardropPaths({ home: '/nowhere', profile: 'dev' })
    expect(migrateLegacyData(paths, '/also-nowhere', log)).toMatchObject({ migrated: false, reason: 'profile in use' })
  })
})
