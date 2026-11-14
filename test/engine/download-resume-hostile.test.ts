/**
 * Adversarial tests for download resume.
 *
 * These exist to BREAK the resume path, not to confirm it: a resume path is
 * the one place the downloader is allowed to skip getUniqueFilePath and write
 * over an existing file, so every way of smuggling a bad path through it
 * matters, as does every way of accidentally losing a good one.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, expect, test } from 'vitest'
import { HyperdriveManager } from '@engine/hyperdrive/manager'
import { downloadFromDrive } from '@engine/hyperdrive/downloader'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-hostile-'))
let testnet: { bootstrap: Array<{ host: string; port: number }>; destroy: () => Promise<void> }
const managers: HyperdriveManager[] = []

afterAll(async () => {
  await Promise.all(managers.map((m) => m.stopAll({ persistState: false, force: true }).catch(() => undefined)))
  await testnet?.destroy()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function manager(name: string) {
  const m = new HyperdriveManager({
    drivesDir: path.join(tmp, name, 'drives'),
    manifestPath: path.join(tmp, name, 'drives-state.json'),
    swarmOptions: { bootstrap: testnet.bootstrap }
  })
  managers.push(m)
  return m
}

/** A live sender + an opened receiver session for one file. */
async function pair(tag: string, bytes = 50_000) {
  const srcDir = path.join(tmp, 'src-' + tag)
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'movie.mkv'), Buffer.alloc(bytes, 5))

  const sender = manager('s-' + tag)
  await sender.init()
  const share = await sender.createDrive([{ name: 'movie.mkv', path: path.join(srcDir, 'movie.mkv') }], {
    name: 'movie.mkv',
    totalBytes: bytes
  })

  const receiver = manager('r-' + tag)
  await receiver.init()
  const opened = await receiver.openDrive(share.shareLink)
  return { sender, receiver, opened, session: receiver.activeDrives.get(opened.driveId)! }
}

const ls = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : [])

test('setup', async () => {
  testnet = await createTestnet(5)
  expect(testnet.bootstrap.length).toBeGreaterThan(0)
}, 60_000)

// ── 1. The thing the user reported: many interruptions, one file ──────────
test('ten interrupted attempts with notes produce exactly one file', async () => {
  const { opened, session } = await pair('many')
  const dest = path.join(tmp, 'dl-many')

  const first = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: null
  })
  const resumePaths = Object.fromEntries(first.files.map((f) => [f.key, f.path]))

  for (let i = 0; i < 10; i++) {
    await downloadFromDrive(session.drive, {
      destDir: dest,
      totalBytes: opened.totalBytes,
      shareName: opened.shareName,
      resumePaths
    })
  }
  expect(ls(first.destDir)).toEqual(['movie.mkv'])
}, 180_000)

// ── 2. A resume path must never escape the download folder ───────────────
test('a resume path outside the download folder is ignored, not obeyed', async () => {
  const { opened, session } = await pair('escape')
  const dest = path.join(tmp, 'dl-escape')
  const outside = path.join(tmp, 'VICTIM.txt')
  fs.writeFileSync(outside, 'do not overwrite me')

  const r = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: { '/movie.mkv': outside }
  })

  expect(fs.readFileSync(outside, 'utf8')).toBe('do not overwrite me')
  expect(ls(r.destDir)).toEqual(['movie.mkv'])
}, 120_000)

// ── 3. The sibling-prefix trick: "<root>-evil" starts with "<root>" ──────
test('a sibling folder whose name merely starts with the root is not inside it', async () => {
  const { opened, session } = await pair('sibling')
  const dest = path.join(tmp, 'dl-sib')
  const r0 = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: null
  })

  const sibling = r0.destDir + '-evil'
  fs.mkdirSync(sibling, { recursive: true })
  const victim = path.join(sibling, 'movie.mkv')
  fs.writeFileSync(victim, 'sibling file')

  await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: { '/movie.mkv': victim }
  })
  expect(fs.readFileSync(victim, 'utf8')).toBe('sibling file')
}, 120_000)

// ── 4. The note survives, the file does not (user deleted the partial) ───
test('a note pointing at a deleted file still writes that exact path', async () => {
  const { opened, session } = await pair('deleted')
  const dest = path.join(tmp, 'dl-del')
  const r0 = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: null
  })
  const target = r0.files[0].path
  fs.rmSync(target)

  await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: { '/movie.mkv': target }
  })
  expect(ls(r0.destDir)).toEqual(['movie.mkv'])
}, 120_000)

// ── 5. Windows: the same folder spelled with a different drive-letter case ─
test('a note differing only by path case still resumes (Windows)', async () => {
  const { opened, session } = await pair('case')
  const dest = path.join(tmp, 'dl-case')
  const r0 = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: null
  })

  // What a note recovered from disk can look like after a reinstall or a
  // path that travelled through another API.
  const flipped = r0.files[0].path.replace(/^([a-zA-Z]):/, (_m, d: string) =>
    (d === d.toUpperCase() ? d.toLowerCase() : d.toUpperCase()) + ':'
  )
  await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: { '/movie.mkv': flipped }
  })
  expect(ls(r0.destDir)).toEqual(['movie.mkv'])
}, 120_000)

// ── 6. A traversal key must be refused whether or not a note exists ──────
test('a traversal key is refused even with a resume note', async () => {
  const { opened, session } = await pair('trav')
  const dest = path.join(tmp, 'dl-trav')
  const r = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: { '../../escaped.mkv': path.join(tmp, 'escaped.mkv') }
  })
  expect(fs.existsSync(path.join(tmp, 'escaped.mkv'))).toBe(false)
  expect(ls(r.destDir)).toEqual(['movie.mkv'])
}, 120_000)

// ── 7. Store: hostile and degenerate inputs ──────────────────────────────
test('recordPartialPaths refuses what it cannot honour', async () => {
  const { sender, opened } = await pair('store')

  // Unknown drive: no entry to attach to.
  expect(await sender.recordPartialPaths('does-not-exist', { '/a': 'C:\\tmp\\a' })).toBe(false)
  // Nothing to record.
  expect(await sender.recordPartialPaths(opened.driveId, {})).toBe(false)
  // Clearing something that was never set must not throw.
  await expect(sender.clearPartialPaths('does-not-exist')).resolves.toBeUndefined()
}, 120_000)

// ── 8. Two drives must not share notes ───────────────────────────────────
test('notes are per drive and merge rather than replace', async () => {
  const a = await pair('two-a')
  const b = await pair('two-b')

  await a.receiver.recordPartialPaths(a.opened.driveId, { '/movie.mkv': 'A1' })
  await b.receiver.recordPartialPaths(b.opened.driveId, { '/movie.mkv': 'B1' })
  expect(a.receiver.getDriveEntry(a.opened.driveId)?.partialPaths).toEqual({ '/movie.mkv': 'A1' })
  expect(b.receiver.getDriveEntry(b.opened.driveId)?.partialPaths).toEqual({ '/movie.mkv': 'B1' })

  // A second interruption updates that key and keeps the others.
  await a.receiver.recordPartialPaths(a.opened.driveId, { '/movie.mkv': 'A2', '/other.bin': 'A3' })
  expect(a.receiver.getDriveEntry(a.opened.driveId)?.partialPaths).toEqual({ '/movie.mkv': 'A2', '/other.bin': 'A3' })

  // Clearing one leaves the other alone.
  await a.receiver.clearPartialPaths(a.opened.driveId)
  expect(a.receiver.getDriveEntry(a.opened.driveId)?.partialPaths).toBeUndefined()
  expect(b.receiver.getDriveEntry(b.opened.driveId)?.partialPaths).toEqual({ '/movie.mkv': 'B1' })
}, 120_000)
