/**
 * Link preview over a local DHT: details with the sender online, 'offline'
 * without one, 'cancelled' on abort, and nothing left on disk either way.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import Hyperswarm from 'hyperswarm'
import { afterAll, expect, test } from 'vitest'
import { HyperdriveManager } from '@engine/hyperdrive/manager'
import { previewShare } from '@engine/hyperdrive/preview'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-preview-'))
let testnet: { bootstrap: Array<{ host: string; port: number }>; destroy: () => Promise<void> }
const managers: HyperdriveManager[] = []
const swarm = () => new Hyperswarm({ bootstrap: testnet.bootstrap })
const leftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('peardrop-preview-'))

afterAll(async () => {
  await Promise.all(managers.map((m) => m.stopAll({ persistState: false, force: true }).catch(() => undefined)))
  await testnet?.destroy()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('setup', async () => {
  testnet = await createTestnet(5)
}, 60_000)

test('sender online: name, files and sizes, nothing persisted', async () => {
  const src = path.join(tmp, 'src')
  fs.mkdirSync(src, { recursive: true })
  fs.writeFileSync(path.join(src, 'a.mkv'), Buffer.alloc(30_000, 1))
  fs.writeFileSync(path.join(src, 'b.txt'), 'hello')

  const sender = new HyperdriveManager({
    drivesDir: path.join(tmp, 's', 'drives'),
    manifestPath: path.join(tmp, 's', 'state.json'),
    swarmOptions: { bootstrap: testnet.bootstrap }
  })
  managers.push(sender)
  await sender.init()
  const share = await sender.createDrive(
    [
      { name: 'a.mkv', path: path.join(src, 'a.mkv') },
      { name: 'b.txt', path: path.join(src, 'b.txt') }
    ],
    { name: 'Holiday', totalBytes: 30_005 }
  )

  const before = leftovers().length
  const out = await previewShare({ link: share.shareLink, createSwarm: swarm, signal: new AbortController().signal })
  expect(out.status).toBe('found')
  if (out.status !== 'found') return
  expect(out.contents.shareName).toBe('Holiday')
  expect(out.contents.totalBytes).toBe(30_005)
  expect(out.contents.files.map((f) => [f.displayName, f.size]).sort()).toEqual([
    ['a.mkv', 30_000],
    ['b.txt', 5]
  ])
  expect(leftovers().length).toBe(before)
}, 120_000)

test('no sender: offline after the timeout', async () => {
  const link = `peardrop://${'ab'.repeat(32)}`
  const t0 = Date.now()
  const out = await previewShare({ link, createSwarm: swarm, signal: new AbortController().signal, timeoutMs: 3000 })
  expect(out.status).toBe('offline')
  expect(Date.now() - t0).toBeLessThan(15_000)
}, 30_000)

test('cancel ends a search at once', async () => {
  const link = `peardrop://${'cd'.repeat(32)}`
  const ctl = new AbortController()
  const pending = previewShare({ link, createSwarm: swarm, signal: ctl.signal, timeoutMs: 60_000 })
  setTimeout(() => ctl.abort(), 300)
  const t0 = Date.now()
  expect((await pending).status).toBe('cancelled')
  expect(Date.now() - t0).toBeLessThan(10_000)
}, 30_000)

test('garbage link is invalid without touching the network', async () => {
  const out = await previewShare({ link: 'peardrop://nope', createSwarm: () => { throw new Error('no') }, signal: new AbortController().signal })
  expect(out.status).toBe('invalid')
})
