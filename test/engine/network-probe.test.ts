/**
 * NetworkProbe against a local DHT: reachable when a bootstrap node answers,
 * not reachable when nothing listens on the port.
 */
import dgram from 'node:dgram'
import { createRequire } from 'node:module'
import { afterAll, expect, test } from 'vitest'
import { NetworkProbe } from '@engine/hyperdrive/network-probe'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, child: () => silentLog } as never
let testnet: { bootstrap: Array<{ host: string; port: number }>; destroy: () => Promise<void> } | undefined

afterAll(async () => {
  await testnet?.destroy()
})

/** A UDP port nobody answers on: bind it, note it, close it. */
async function closedPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', () => resolve()))
  const { port } = socket.address()
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return port
}

test('reachable when a bootstrap node answers', async () => {
  testnet = await createTestnet(3)
  const probe = new NetworkProbe({ bootstrap: testnet.bootstrap, log: silentLog, pingTimeoutMs: 2000 })
  probe.start()

  expect(probe.reachable).toBe(null)
  expect(await probe.check()).toBe(true)
  expect(probe.reachable).toBe(true)

  await probe.stop()
}, 20_000)

test('not reachable when no bootstrap node answers', async () => {
  const port = await closedPort()
  const probe = new NetworkProbe({
    bootstrap: [{ host: '127.0.0.1', port }],
    log: silentLog,
    pingTimeoutMs: 500
  })
  probe.start()

  expect(await probe.check()).toBe(false)
  expect(probe.reachable).toBe(false)

  await probe.stop()
}, 20_000)
