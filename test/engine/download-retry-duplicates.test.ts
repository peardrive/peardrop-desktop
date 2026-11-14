/**
 * Reproduces the "one download, four files" report.
 *
 * When a download is interrupted the backend keeps no record of where the
 * partial file was written, so the next attempt runs with `resumePaths: null`
 * and getUniqueFilePath invents a fresh name. Repeat that four times and the
 * folder holds four partials of four different sizes.
 *
 * This drives the real downloader over a local DHT; what it simulates is the
 * RETRY, not the network drop — a true stall takes the hard-coded 60s
 * STALL_TIMEOUT_MS to fire, which is far too slow for a test. Everything
 * after the interruption is exactly what the app does today.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-retry-'))
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

/** Every file in a folder, so duplicates are visible rather than inferred. */
function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

test('without resume paths, every attempt writes a NEW file (why the caller must supply them)', async () => {
  testnet = await createTestnet(5)

  const srcDir = path.join(tmp, 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'companion.mkv'), Buffer.alloc(200_000, 3))

  const sender = manager('sender')
  await sender.init()
  const share = await sender.createDrive([{ name: 'companion.mkv', path: path.join(srcDir, 'companion.mkv') }], {
    name: 'companion.mkv',
    totalBytes: 200_000
  })

  const receiver = manager('receiver')
  await receiver.init()
  const opened = await receiver.openDrive(share.shareLink)
  expect(opened.peerConnected).toBe(true)

  const session = receiver.activeDrives.get(opened.driveId)!
  const dest = path.join(tmp, 'downloads')

  // Four attempts, each the way the backend retries after an interruption:
  // no resumePaths, because nothing recorded where the last one wrote.
  const roots: string[] = []
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await downloadFromDrive(session.drive, {
      destDir: dest,
      totalBytes: opened.totalBytes,
      shareName: opened.shareName,
      resumePaths: null
    })
    roots.push(r.destDir)
  }

  const files = listFiles(roots[0])
  console.log('[test] after 4 retries, download folder holds:', files)

  // Four attempts, four files. This is the downloader behaving as designed:
  // with no resume path it must not clobber an unrelated file of the same
  // name. The bug was upstream — nothing recorded the path to pass back.
  expect(files.length).toBe(4)
  expect(files).toContain('companion.mkv')
}, 120_000)

test('passing the previous path back rewrites the same file', async () => {
  const srcDir = path.join(tmp, 'src2')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'companion.mkv'), Buffer.alloc(200_000, 9))

  const sender = manager('sender2')
  await sender.init()
  const share = await sender.createDrive([{ name: 'companion.mkv', path: path.join(srcDir, 'companion.mkv') }], {
    name: 'companion.mkv',
    totalBytes: 200_000
  })

  const receiver = manager('receiver2')
  await receiver.init()
  const opened = await receiver.openDrive(share.shareLink)
  const session = receiver.activeDrives.get(opened.driveId)!
  const dest = path.join(tmp, 'downloads2')

  const first = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName,
    resumePaths: null
  })

  // What the engine already supports — and what the backend fails to supply.
  const resumePaths = Object.fromEntries(first.files.map((f) => [f.key, f.path]))

  for (let attempt = 0; attempt < 3; attempt++) {
    await downloadFromDrive(session.drive, {
      destDir: dest,
      totalBytes: opened.totalBytes,
      shareName: opened.shareName,
      resumePaths
    })
  }

  const files = listFiles(first.destDir)
  console.log('[test] with resumePaths, download folder holds:', files)
  expect(files).toEqual(['companion.mkv'])
}, 120_000)

test('an interrupted attempt leaves a note that survives a restart', async () => {
  const srcDir = path.join(tmp, 'src3')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'companion.mkv'), Buffer.alloc(1_000, 1))

  const manifestPath = path.join(tmp, 'noted', 'drives-state.json')
  const first = new HyperdriveManager({
    drivesDir: path.join(tmp, 'noted', 'drives'),
    manifestPath,
    swarmOptions: { bootstrap: testnet.bootstrap }
  })
  managers.push(first)
  await first.init()
  const share = await first.createDrive([{ name: 'companion.mkv', path: path.join(srcDir, 'companion.mkv') }], {
    name: 'companion.mkv',
    totalBytes: 1_000
  })

  const partial = path.join(tmp, 'downloads3', 'companion.mkv')
  expect(await first.recordPartialPaths(share.driveId, { '/companion.mkv': partial })).toBe(true)

  // Partials are NOT files the user has — the UI list must stay clean.
  const entry = first.getDriveEntry(share.driveId)!
  expect(entry.partialPaths).toEqual({ '/companion.mkv': partial })
  expect(entry.files.some((f) => f.path === partial)).toBe(false)

  // The note has to outlive the process, or a crash mid-download still
  // duplicates on the next launch.
  await first.stopAll({ persistState: true, force: true })
  const reopened = new HyperdriveManager({
    drivesDir: path.join(tmp, 'noted', 'drives'),
    manifestPath,
    swarmOptions: { bootstrap: testnet.bootstrap }
  })
  managers.push(reopened)
  await reopened.init()
  expect(reopened.getDriveEntry(share.driveId)?.partialPaths).toEqual({ '/companion.mkv': partial })

  // Finishing clears it, so a later re-download starts clean.
  await reopened.clearPartialPaths(share.driveId)
  expect(reopened.getDriveEntry(share.driveId)?.partialPaths).toBeUndefined()
}, 120_000)
