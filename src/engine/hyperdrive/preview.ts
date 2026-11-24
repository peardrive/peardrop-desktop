/**
 * Link preview: read a share's name and file list from its link, without
 * downloading anything and without adding it to the library.
 *
 * Read-only and throwaway. Its own Corestore lives in a temp folder that is
 * deleted afterwards, nothing is persisted, and no manager event is emitted,
 * so the receive path (receive.ts) never sees a preview.
 *
 * The details are not in the link: they are the `/.peardrop.json` manifest
 * inside the drive, so a preview needs the sender (or any peer seeding the
 * share) to be online. If none answers within the timeout, it says so.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import type Hyperswarm from 'hyperswarm'
import type { SwarmConnection } from 'hyperswarm'
import { readShareContents, type ShareContents } from './drive-manifest'
import { parseShareLink } from './share-link'

/** How long to look for the sender before saying it is offline. */
export const PREVIEW_TIMEOUT_MS = 25_000

export type PreviewOutcome =
  | { status: 'found'; contents: ShareContents }
  | { status: 'offline' }
  | { status: 'invalid' }
  | { status: 'cancelled' }

class Stop extends Error {
  constructor(readonly outcome: 'offline' | 'cancelled') {
    super(outcome)
  }
}

export async function previewShare(opts: {
  link: string
  createSwarm: () => Hyperswarm
  signal: AbortSignal
  timeoutMs?: number
}): Promise<PreviewOutcome> {
  const key = parseShareLink(opts.link)
  if (!key) return { status: 'invalid' }
  if (opts.signal.aborted) return { status: 'cancelled' }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'peardrop-preview-'))
  const store = new Corestore(dir)
  const drive = new Hyperdrive(store, Buffer.from(key, 'hex'))
  let swarm: Hyperswarm | null = null
  let timer: NodeJS.Timeout | null = null
  let onAbort: (() => void) | null = null

  // Rejects when the timeout fires or the caller cancels; raced against every wait.
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Stop('offline')), opts.timeoutMs ?? PREVIEW_TIMEOUT_MS)
    onAbort = () => reject(new Stop('cancelled'))
    opts.signal.addEventListener('abort', onAbort, { once: true })
  })
  stopped.catch(() => undefined)
  const race = <T>(p: Promise<T>) => Promise.race([p, stopped])

  try {
    await race(drive.ready())

    const s = opts.createSwarm()
    swarm = s
    const connected = new Promise<void>((resolve) => {
      s.on('connection', (socket: SwarmConnection) => {
        socket.on('error', () => undefined)
        store.replicate(socket)
        resolve()
      })
    })

    // Same discovery handshake as receive.ts: without findingPeers() an
    // update can settle against an empty core and read as an empty share.
    const discoveryDone = drive.findingPeers()
    s.join(drive.discoveryKey, { server: false, client: true })
    s.flush().then(discoveryDone, discoveryDone)

    await race(connected)
    await race(drive.update({ wait: true }))
    const contents = await race(readShareContents(drive, { driveId: 'preview' }))

    // Connected but nothing replicated (e.g. the peer was another receiver
    // without data): no better than not finding the sender.
    if (!contents.manifest && contents.files.length === 0) return { status: 'offline' }
    return { status: 'found', contents }
  } catch (err) {
    if (err instanceof Stop) return { status: err.outcome }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) opts.signal.removeEventListener('abort', onAbort)
    await swarm?.destroy().catch(() => undefined)
    await drive.close().catch(() => undefined)
    await store.close().catch(() => undefined)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
