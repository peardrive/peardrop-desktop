import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localDay, LogManager, redact } from './logger'

const dirs: string[] = []
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-log-'))
  dirs.push(d)
  return d
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe('redact', () => {
  it('shortens share links and keys, hides the home folder', () => {
    const key = 'ab'.repeat(32)
    const line = redact(`peardrop://${key} peer=${key} at ${path.join(os.homedir(), 'x')}`)
    expect(line).not.toContain(key)
    expect(line).toContain('peardrop://abababab…')
    expect(line).not.toContain(os.homedir())
  })
})

describe('LogManager', () => {
  it('writes timestamped, scoped, redacted lines to a per-day file', () => {
    const dir = tmp()
    const logs = new LogManager({ dir })
    logs.init({ version: '1.0.0' })
    logs.scope('engine').child('hyperdrive').info('Ready', { link: `peardrop://${'cd'.repeat(32)}` })
    logs.flush()
    const file = path.join(dir, `peardrop-${localDay()}.log`)
    const text = fs.readFileSync(file, 'utf8')
    expect(text).toMatch(/=== session .* version=1\.0\.0 ===/)
    expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} [+-]\d{2}:\d{2} INFO  \[engine:hyperdrive\] Ready/)
    expect(text).not.toContain('cd'.repeat(32))
    expect(logs.tail(5)).toContain('Ready')
  })

  it('keeps 14 days and deletes older day-files', () => {
    const dir = tmp()
    const now = new Date(2026, 9, 17, 12)
    const day = (offset: number) => {
      const d = new Date(now)
      d.setDate(d.getDate() - offset)
      return localDay(d)
    }
    for (const off of [0, 13, 14, 30]) fs.writeFileSync(path.join(dir, `peardrop-${day(off)}.log`), 'x')
    fs.writeFileSync(path.join(dir, `peardrop-${day(20)}.1.log`), 'x')
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'keep')
    const removed = new LogManager({ dir, retentionDays: 14 }).prune(now)
    expect(removed.sort()).toEqual([`peardrop-${day(14)}.log`, `peardrop-${day(20)}.1.log`, `peardrop-${day(30)}.log`].sort())
    expect(fs.readdirSync(dir).sort()).toEqual([`peardrop-${day(0)}.log`, `peardrop-${day(13)}.log`, 'unrelated.txt'].sort())
  })

  it('continues in a numbered part when a day file is full', () => {
    const dir = tmp()
    const logs = new LogManager({ dir, maxFileBytes: 200 })
    logs.init()
    for (let i = 0; i < 20; i++) {
      logs.scope('t').info(`line ${i} ${'x'.repeat(40)}`)
      logs.flush()
    }
    const files = fs.readdirSync(dir)
    expect(files.length).toBeGreaterThan(1)
    expect(files).toContain(`peardrop-${localDay()}.1.log`)
    expect(logs.tail(1000)).toContain('line 19')
  })
})
