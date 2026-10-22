/**
 * Serving a drive to peers: join the drive's topic, replicate to everyone
 * who connects, announce on the DHT and track upload progress.
 * Used for new shares and for shares resumed on startup.
 */
import type Corestore from 'corestore'
import type Hyperdrive from 'hyperdrive'
import type Hyperswarm from 'hyperswarm'
import type { PeerInfo, SwarmConnection } from 'hyperswarm'
import type { EngineContext } from './context'
import { shortKey } from './share-link'
import type { DriveSession, UploadCompleteEvent, UploadProgressEvent } from './types'

export interface SeedingOptions {
  driveId: string
  drive: Hyperdrive
  store: Corestore
  totalBytes: number
  /** Resumed on startup rather than just created; only changes log lines and discovery. */
  resumed: boolean
}

export interface Seeding {
  swarm: Hyperswarm
  trackerHandlers: NonNullable<DriveSession['trackerHandlers']>
}

export function startSeeding(ctx: EngineContext, opts: SeedingOptions): Seeding {
  const { driveId, drive, store, resumed } = opts
  const swarm = ctx.createSwarm()

  if (!resumed) {
    console.log('[HyperdriveManager] Swarm created, DHT bootstrapping...', { driveId })
  }

  swarm.on('connection', (socket: SwarmConnection, peerInfo: PeerInfo) => {
    onSeederConnection(ctx, { driveId, store, socket, peerInfo, resumed })
  })

  // New shares mark discovery as in progress until the first flush; resumed
  // shares keep seeking peers without it.
  const discoveryDone = resumed ? null : drive.findingPeers()
  const topic = swarm.join(drive.discoveryKey)

  // The announce is the moment the share becomes findable. Until then no
  // peer holding the link can reach it, so the UI must not call it
  // "Active" before 'drive-announced'.
  topic.flushed().then(
    () => {
      const label = resumed ? 'Resumed drive announced on DHT' : 'Announced on DHT'
      const link = `peardrop://${shortKey(drive.key)}…`
      console.log(`[HyperdriveManager] ${label}: ${driveId} link=${link} topic=${shortKey(drive.discoveryKey)}…`)
      ctx.emitEvent('drive-announced', { driveId, at: Date.now() })
    },
    (err: Error | undefined) => {
      const label = resumed ? 'DHT announce failed on resume' : 'DHT announce failed'
      console.warn(`[HyperdriveManager] ${label}`, { driveId, error: err?.message })
      ctx.emitEvent('drive-announce-failed', { driveId, error: err?.message || 'announce failed' })
    }
  )

  if (discoveryDone) {
    swarm.flush().then(discoveryDone, discoveryDone)
  }

  ctx.tracker.trackUploads(driveId, drive, opts.totalBytes)
  const trackerHandlers = forwardUploadProgress(ctx, driveId)

  return { swarm, trackerHandlers }
}

function onSeederConnection(
  ctx: EngineContext,
  opts: {
    driveId: string
    store: Corestore
    socket: SwarmConnection
    peerInfo: PeerInfo
    resumed: boolean
  }
): void {
  const { driveId, socket, resumed } = opts
  const suffix = resumed ? ' (resumed)' : ''
  const publicKey = opts.peerInfo?.publicKey?.toString('hex') || null
  // Truncated for logs; the full key goes to the File Info panel.
  const peerId = publicKey?.slice(0, 12) || 'peer'

  console.log(`[HyperdriveManager] Peer connected${suffix}`, { driveId, peerId })
  ctx.emitEvent('peer-connected', { driveId, peerId, publicKey, at: Date.now() })

  opts.store.replicate(socket)

  socket.on('close', () => {
    console.log(`[HyperdriveManager] Peer disconnected${suffix}`, { driveId, peerId })
    ctx.emitEvent('peer-disconnected', { driveId, peerId, publicKey, at: Date.now() })
  })

  socket.on('error', (err: Error) => {
    console.log(`[HyperdriveManager] Socket error${suffix}`, { driveId, peerId, error: err.message })
  })
}

/**
 * Re-emit this drive's tracker events as manager events. The handlers are
 * returned so stopDrive can remove them: anonymous listeners would pile up
 * (and double-emit) on every create/resume.
 */
function forwardUploadProgress(ctx: EngineContext, driveId: string): Seeding['trackerHandlers'] {
  const onTrackerProgress = (data: UploadProgressEvent) => {
    if (data.driveId === driveId) {
      ctx.emitEvent('upload-progress', data)
    }
  }

  const onTrackerComplete = (data: UploadCompleteEvent) => {
    if (data.driveId === driveId) {
      ctx.emitEvent('upload-complete', data)
    }
  }

  ctx.tracker.on('progress', onTrackerProgress)
  ctx.tracker.on('complete', onTrackerComplete)

  return { onTrackerProgress, onTrackerComplete }
}
