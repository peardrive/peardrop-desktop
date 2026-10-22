/**
 * End-to-end: share → open link → download → quit → resume, over a local DHT.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-e2e-'))
let testnet: { bootstrap: Array<{ host: string; port: number }>; destroy: () => Promise<void> }

afterAll(async () => {
  await testnet?.destroy()
  fs.rmSync(tmp, { recursive: true, force: true })
})

function manager(name: string) {
  return new HyperdriveManager({
    drivesDir: path.join(tmp, name, 'drives'),
    manifestPath: path.join(tmp, name, 'drives-state.json'),
    swarmOptions: { bootstrap: testnet.bootstrap }
  })
}

test('share, receive, download, quit and resume', async () => {
  testnet = await createTestnet(5)

  const srcDir = path.join(tmp, 'src')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'a.txt'), 'hello from a')
  fs.writeFileSync(path.join(srcDir, 'b.bin'), Buffer.alloc(300_000, 7))

  const sender = manager('sender')
  await sender.init()
  const events: string[] = []
  sender.on('drive-announced', () => events.push('announced'))

  const share = await sender.createDrive(
    [
      { name: 'a.txt', path: path.join(srcDir, 'a.txt') },
      { name: 'b.bin', path: path.join(srcDir, 'b.bin') }
    ],
    { name: 'My Folder', totalBytes: 300_012 }
  )
  expect(share.shareLink).toMatch(/^peardrop:\/\/[0-9a-f]{64}$/)
  expect(sender.getDriveEntry(share.driveId)?.state).toBe('active')

  const receiver = manager('receiver')
  await receiver.init()
  const opened = await receiver.openDrive(share.shareLink)
  expect(opened.peerConnected).toBe(true)
  expect(opened.hasManifest).toBe(true)
  expect(opened.shareName).toBe('My Folder')
  expect(opened.files.map((f) => f.displayName).sort()).toEqual(['a.txt', 'b.bin'])
  expect(receiver.getDriveEntry(opened.driveId)?.state).toBe('seeking')

  const session = receiver.activeDrives.get(opened.driveId)!
  const dest = path.join(tmp, 'downloads')
  const result = await downloadFromDrive(session.drive, {
    destDir: dest,
    totalBytes: opened.totalBytes,
    shareName: opened.shareName
  })
  expect(result.failed).toEqual([])
  expect(result.destDir).toBe(path.join(dest, 'My Folder'))
  expect(fs.readFileSync(path.join(result.destDir, 'a.txt'), 'utf8')).toBe('hello from a')
  expect(fs.statSync(path.join(result.destDir, 'b.bin')).size).toBe(300_000)

  // Quit both, the fast way.
  await Promise.all([
    sender.stopAll({ persistState: false, force: true }),
    receiver.stopAll({ persistState: false, force: true })
  ])
  expect(sender.activeDrives.size).toBe(0)
  expect(sender.getDriveEntry(share.driveId)?.state).toBe('active')

  // Restart the sender: the share resumes and announces again.
  const restarted = manager('sender')
  const announced = new Promise<void>((resolve) => restarted.once('drive-announced', () => resolve()))
  await restarted.init()
  expect(restarted.activeDrives.has(share.driveId)).toBe(true)
  await announced

  // A fresh receiver can still fetch it.
  const receiver2 = manager('receiver2')
  await receiver2.init()
  const reopened = await receiver2.openDrive(share.shareLink)
  expect(reopened.peerConnected).toBe(true)
  expect(reopened.files.length).toBe(2)

  // Pause and resume through the manager API.
  await restarted.stopDrive(share.driveId)
  expect(restarted.getDriveEntry(share.driveId)?.state).toBe('paused')
  await restarted.resumeDrive(share.driveId)
  expect(restarted.getDriveEntry(share.driveId)?.state).toBe('active')

  await Promise.all([
    restarted.stopAll({ force: true, persistState: false }),
    receiver2.stopAll({ force: true, persistState: false })
  ])
  expect(events).toContain('announced')
}, 60_000)

test('a download still seeking at quit resumes and reconnects on the next start', async () => {
  const srcDir = path.join(tmp, 'src2')
  fs.mkdirSync(srcDir, { recursive: true })
  fs.writeFileSync(path.join(srcDir, 'one.txt'), 'one')
  fs.writeFileSync(path.join(srcDir, 'two.txt'), 'two')

  const sender = manager('sender-b')
  await sender.init()
  const share = await sender.createDrive(
    [
      { name: 'one.txt', path: path.join(srcDir, 'one.txt') },
      { name: 'two.txt', path: path.join(srcDir, 'two.txt') }
    ],
    { name: 'Pair' }
  )

  // Open the link, then quit before downloading: the entry stays "seeking".
  const receiver = manager('receiver-b')
  await receiver.init()
  const opened = await receiver.openDrive(share.shareLink)
  expect(receiver.getDriveEntry(opened.driveId)?.state).toBe('seeking')
  await receiver.stopAll({ persistState: false, force: true })

  // Next start: the download resumes and reports it is ready again.
  const restarted = manager('receiver-b')
  const ready = new Promise<{ driveId: string; shareName: string }>((resolve) => {
    restarted.once('drive-ready-to-download', resolve)
  })
  await restarted.init()
  const event = await ready
  expect(event.driveId).toBe(opened.driveId)
  expect(event.shareName).toBe('Pair')

  // File entries carry the drive key as `name`, never as a local `path`.
  const entry = restarted.getDriveEntry(opened.driveId)!
  expect(entry.files.every((f) => f.path === undefined)).toBe(true)
  expect(entry.files.map((f) => f.name).sort()).toEqual(['/one.txt', '/two.txt'])

  await Promise.all([
    sender.stopAll({ persistState: false, force: true }),
    restarted.stopAll({ persistState: false, force: true })
  ])
}, 60_000)
