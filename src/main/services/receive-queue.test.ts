import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoredReceiveQueue, retryDelayMs, sanitizeReceiveQueue } from '@shared/receive'
import type { DriveRecord, OpenResult, TransferEvent } from '@shared/transfer'
import type { Logger } from '../logger'
import { ReceiveQueue } from './receive-queue'

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log }
const LINK = `peardrop://${'a'.repeat(64)}`

/** A fake EngineHost + backend: the sender is offline until `online = true`. */
function fakeEngine() {
  const bus = new EventEmitter()
  const state = { online: false, opens: 0, released: [] as string[], downloads: [] as string[], records: new Map<string, DriveRecord>() }
  const backend = {
    checkLink: async () => ({ isDuplicate: false as const }),
    async open(link: string): Promise<OpenResult> {
      state.opens++
      const driveId = `recv_${state.opens}`
      if (!state.online) return { success: true, isDuplicate: false, driveId, files: [], shareName: null, totalBytes: 0, hasManifest: false, peerConnected: false, truncated: null }
      state.records.set(driveId, { id: driveId, name: 'a.txt', state: 'seeking', isUpload: false, files: [{ name: 'a.txt', size: 3 }], totalBytes: 3, shareLink: link })
      return { success: true, isDuplicate: false, driveId, files: [{ name: 'a.txt', size: 3 }], shareName: 'a.txt', totalBytes: 3, hasManifest: true, peerConnected: true, truncated: null }
    },
    async release(id: string) {
      state.released.push(id)
    },
    get: (id: string) => state.records.get(id) ?? null,
    async download({ driveId }: { driveId: string }) {
      state.downloads.push(driveId)
      bus.emit('event', { type: 'files-downloaded', driveId, files: [], downloadPath: '/x', isSeeding: true, partial: false, failedCount: 0 } satisfies TransferEvent)
      return { success: true as const, partial: false, failed: [], files: [], downloadPath: '/x', driveId }
    },
    rediscover: async () => ({ success: true }),
    cancelDownload: async () => ({ success: true }),
    remove: async () => ({ success: true })
  }
  const engine = {
    on: (ev: string, fn: (...a: any[]) => void) => bus.on(ev, fn),
    publish: (e: TransferEvent) => bus.emit('event', e),
    withBackend: async <T,>(fn: (b: any) => T | Promise<T>) => fn(backend)
  }
  return { engine, state, bus }
}

describe('receive queue', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-rq-'))
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('remembers a link whose sender is offline, across a restart', async () => {
    const file = path.join(dir, 'receive-queue.json')
    const { engine, state } = fakeEngine()
    const q = new ReceiveQueue({ file, engine: engine as any, log })
    q.start()
    const res = await q.add(`  ${LINK}  `)
    expect(res.status).toBe('queued')
    await vi.advanceTimersByTimeAsync(10)
    expect(state.opens).toBe(1)
    expect(state.released).toEqual(['recv_1']) // no dangling session
    expect(q.list()[0]).toMatchObject({ phase: 'waiting', driveId: null, attempts: 1 })
    q.stop()

    // "Restart": a new queue reads the same file.
    await vi.advanceTimersByTimeAsync(50)
    const again = new ReceiveQueue({ file, engine: engine as any, log })
    expect(again.list()).toHaveLength(1)
    expect(again.list()[0].link).toBe(LINK)
  })

  it('downloads once the sender comes online, then forgets the task', async () => {
    const { engine, state } = fakeEngine()
    const q = new ReceiveQueue({ file: path.join(dir, 'q.json'), engine: engine as any, log })
    const added: TransferEvent[] = []
    engine.on('event', (e: TransferEvent) => added.push(e))
    q.start()
    await q.add(LINK)
    await vi.advanceTimersByTimeAsync(10)
    expect(q.list()).toHaveLength(1)

    state.online = true
    await vi.advanceTimersByTimeAsync(retryDelayMs(1) + 10)
    expect(state.downloads).toEqual(['recv_2'])
    expect(added.some((e) => e.type === 'drive-added')).toBe(true)
    expect(q.list()).toHaveLength(0)
    q.stop()
  })

  it('does not queue the same link twice', async () => {
    const { engine } = fakeEngine()
    const q = new ReceiveQueue({ file: path.join(dir, 'q.json'), engine: engine as any, log })
    await q.add(LINK)
    expect((await q.add(LINK.toUpperCase().replace('PEARDROP', 'peardrop'))).status).toBe('pending')
    expect((await q.add('nope')).status).toBe('invalid')
  })
})

describe('receive queue file', () => {
  it('sanitizes garbage and resets in-flight phases on restore', () => {
    expect(sanitizeReceiveQueue({ tasks: [{ id: 'a', link: LINK, phase: 'searching' }] }).tasks[0].phase).toBe('searching')
    const q = restoredReceiveQueue({
      tasks: [
        { id: 'a', link: LINK, phase: 'searching' },
        { id: 'b', link: LINK }, // duplicate link
        { id: 'c', link: 'peardrop://short' },
        { id: 'd', link: `peardrop://${'b'.repeat(64)}`, driveId: 'recv_1', phase: 'waiting' },
        null
      ]
    })
    expect(q.tasks.map((t) => [t.id, t.phase])).toEqual([
      ['a', 'waiting'],
      ['d', 'downloading']
    ])
  })
  it('backs off to five minutes', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([15000, 30000, 60000, 120000, 300000, 300000])
  })
})
