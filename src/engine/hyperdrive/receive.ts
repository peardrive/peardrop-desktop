/**
 * Receiving: open a remote drive from a share link, find its sender, and
 * read its file list once the metadata has replicated.
 *
 * Two entry points share the same steps:
 *   - openRemoteDrive: a link the user just pasted (new drive id and folder);
 *   - resumeSeekingDrive: a download that was still looking for its sender
 *     when the app last quit (existing id and folder).
 *
 * A drive entry is only persisted once a peer has connected AND the drive
 * has data. A cancelled or never-connected open leaves nothing behind, so
 * no "Already downloaded" ghost can appear for that link later.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import type Hyperswarm from 'hyperswarm'
import type { SwarmConnection } from 'hyperswarm'
import { EngineError } from '../engine-errors'
import type { EngineContext } from './context'
import { readShareContents, type ShareContents } from './drive-manifest'
import { parseShareLink } from './share-link'
import { DriveState, type ManifestDriveEntry, type OpenDriveResult, type PendingConnection } from './types'

/** How often "still searching" is logged and reported while waiting. */
const SEARCH_STATUS_INTERVAL_MS = 30_000

/** How often a pending connection checks whether it was aborted. */
const ABORT_POLL_MS = 100

interface SenderSearch {
  swarm: Hyperswarm
  /** True once any peer has connected. */
  peerConnected: () => boolean
}

/**
 * Open a remote drive from a share link and wait (without timeout, only
 * cancellation) until it is in sync with its sender.
 */
export async function openRemoteDrive(ctx: EngineContext, shareLink: string): Promise<OpenDriveResult> {
  const key = parseShareLink(shareLink)
  if (!key) {
    throw new EngineError({
      category: 'receive.invalid-link',
      cause: 'invalid-link',
      message: 'Invalid share link'
    })
  }

  const driveId = `recv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const drivePath = path.join(ctx.drivesDir, driveId)

  console.log('[HyperdriveManager] Opening remote drive', { driveId, key: key.slice(0, 16) + '...' })

  const { drive, store } = await openDrive(drivePath, key)
  const search = searchForSender(ctx, { driveId, drive, store })

  await waitForSync(ctx, {
    driveId,
    drive,
    search,
    logCancel: true,
    cleanup: async ({ force = false } = {}) => {
      await search.swarm.destroy({ force })
      await drive.close()
      await store.close()
      await fs.rm(drivePath, { recursive: true, force: true })
      // Belt and braces: remove any entry for this id, so the next paste of
      // the same link is not mistaken for a duplicate.
      await ctx.store.remove(driveId, { deleteStorage: false })
    }
  })

  const peerConnected = search.peerConnected()

  // Only read the drive once a peer is connected: before that there is
  // nothing to read and the drive stays in seeking state.
  let contents: ShareContents = { manifest: null, files: [], shareName: null, totalBytes: 0, truncated: null }
  if (peerConnected) {
    contents = await readShareContents(drive, { driveId })
  } else {
    console.log('[HyperdriveManager] No peer connected yet - drive remains in seeking state')
  }

  ctx.activeDrives.set(driveId, {
    driveId,
    drive,
    store,
    swarm: search.swarm,
    isReceiving: true,
    manifest: contents.manifest,
    totalBytes: contents.totalBytes,
    shareName: contents.shareName,
    // Kept for history and re-sharing.
    shareLink,
    metadata: { key },
    createdAt: Date.now()
  })

  if (peerConnected && hasData(contents, drive, driveId)) {
    await ctx.store.add({
      driveId,
      key: drive.key.toString('hex'),
      discoveryKey: drive.discoveryKey.toString('hex'),
      // Stays seeking until the download completes.
      state: DriveState.SEEKING,
      shareLink,
      isUpload: false,
      files: contents.files,
      totalBytes: contents.totalBytes,
      storagePath: drivePath,
      createdAt: Date.now(),
      name: contents.shareName || 'Remote Share'
    })
  }

  console.log('[HyperdriveManager] Remote drive opened', {
    driveId,
    files: contents.files.length,
    totalBytes: contents.totalBytes,
    hasManifest: !!contents.manifest,
    peerConnected
  })

  return {
    driveId,
    files: contents.files,
    shareName: contents.shareName,
    totalBytes: contents.totalBytes,
    hasManifest: !!contents.manifest,
    peerConnected,
    truncated: contents.truncated
  }
}

/**
 * Resume a download that was still seeking its sender, reusing its drive id
 * and storage folder. Emits 'drive-ready-to-download' once the sender is
 * back and the drive has data.
 */
export async function resumeSeekingDrive(
  ctx: EngineContext,
  driveId: string,
  metadata: ManifestDriveEntry
): Promise<void> {
  const key = parseShareLink(metadata.shareLink)
  if (!key) {
    throw new Error('Invalid share link in metadata')
  }

  console.log('[HyperdriveManager] Resuming seeking drive', { driveId, key: key.slice(0, 16) + '...' })

  const { drive, store } = await openDrive(metadata.storagePath as string, key)
  const search = searchForSender(ctx, { driveId, drive, store })

  await waitForSync(ctx, {
    driveId,
    drive,
    search,
    logCancel: false,
    // A resume keeps its storage folder: only the network side goes.
    cleanup: async ({ force = false } = {}) => {
      await search.swarm.destroy({ force })
      await drive.close()
      await store.close()
    }
  })

  const peerConnected = search.peerConnected()

  // Read even without a peer: a download that synced before the restart has
  // its metadata locally.
  const contents = await readShareContents(drive, { driveId })
  const shareName = contents.shareName || fallbackShareName(contents)

  ctx.activeDrives.set(driveId, {
    driveId,
    drive,
    store,
    swarm: search.swarm,
    isReceiving: true,
    manifest: contents.manifest,
    totalBytes: contents.totalBytes,
    shareName,
    shareLink: metadata.shareLink,
    metadata: { key },
    createdAt: metadata.createdAt || Date.now()
  })

  if (peerConnected && hasData(contents, drive, driveId)) {
    await ctx.store.add({
      // The EXISTING id and storage folder, not new ones.
      driveId,
      key: drive.key.toString('hex'),
      discoveryKey: drive.discoveryKey.toString('hex'),
      state: DriveState.SEEKING,
      shareLink: metadata.shareLink,
      isUpload: false,
      files: contents.files,
      totalBytes: contents.totalBytes,
      storagePath: metadata.storagePath,
      createdAt: metadata.createdAt || Date.now(),
      name: shareName
    })

    console.log('[HyperdriveManager] Emitting drive-ready-to-download event', {
      driveId,
      shareLink: metadata.shareLink
    })
    ctx.emitEvent('drive-ready-to-download', {
      driveId,
      shareLink: metadata.shareLink as string,
      shareName,
      totalBytes: contents.totalBytes,
      files: contents.files
    })
  } else if (!peerConnected) {
    console.log('[HyperdriveManager] No peer connected, not emitting download event', { driveId })
  }

  console.log('[HyperdriveManager] Remote drive resumed', {
    driveId,
    files: contents.files.length,
    totalBytes: contents.totalBytes,
    hasManifest: !!contents.manifest,
    peerConnected
  })
}

async function openDrive(drivePath: string, key: string): Promise<{ drive: Hyperdrive; store: Corestore }> {
  const store = new Corestore(drivePath)
  await store.ready()

  const drive = new Hyperdrive(store, Buffer.from(key, 'hex'))
  await drive.ready()

  return { drive, store }
}

/**
 * Join the drive's topic to find its sender and replicate with every peer.
 *
 * Hyperswarm often holds several connections to the same share, so one
 * socket closing does not mean the sender is gone: only the LAST peer
 * leaving emits 'download-peer-disconnected'.
 */
function searchForSender(
  ctx: EngineContext,
  opts: { driveId: string; drive: Hyperdrive; store: Corestore }
): SenderSearch {
  const { driveId, drive } = opts
  const swarm = ctx.createSwarm()

  console.log('[HyperdriveManager] Joining swarm to find sender...', {
    driveId,
    discoveryKey: drive.discoveryKey.toString('hex').slice(0, 16) + '...'
  })

  let peerConnected = false
  let livePeers = 0

  swarm.on('connection', (socket: SwarmConnection) => {
    peerConnected = true
    livePeers++
    console.log('[HyperdriveManager] Connected to peer for download', { driveId, livePeers })

    opts.store.replicate(socket)

    socket.on('error', (err: Error) => {
      console.log('[HyperdriveManager] Download socket error', { driveId, error: err.message })
    })

    // 'close' can fire more than once per socket; counting it twice would
    // push livePeers below zero and hide a real disconnect.
    let counted = false
    socket.on('close', () => {
      if (counted) {
        return
      }
      counted = true
      livePeers = Math.max(0, livePeers - 1)

      if (livePeers > 0) {
        console.log('[HyperdriveManager] A download peer left, others remain', { driveId, livePeers })
        return
      }

      console.log('[HyperdriveManager] Download peer disconnected (last peer)', { driveId })
      ctx.emitEvent('download-peer-disconnected', { driveId })
    })
  })

  // findingPeers() is what makes update({ wait: true }) actually wait: until
  // discovery settles, "no peers, so up to date" is not a valid conclusion.
  // Without it, update() resolved against an empty metadata core and the
  // drive read as an EMPTY share (the 0-file "Untitled Share" ghost).
  // done() must not run before update() starts, so the flush is not awaited.
  const discoveryDone = drive.findingPeers()
  const topic = swarm.join(drive.discoveryKey)

  topic.flushed().then(() => {
    console.log('[HyperdriveManager] DHT lookup complete', { driveId, peerConnected })
  })

  swarm.flush().then(discoveryDone, discoveryDone)
  console.log('[HyperdriveManager] Swarm join issued, waiting for drive update...', { driveId, peerConnected })

  return { swarm, peerConnected: () => peerConnected }
}

/**
 * Wait until the drive is up to date with its sender. There is no timeout;
 * only cancellation (HyperdriveManager.abortConnection) stops the wait, in
 * which case `cleanup` runs and the cancellation error is rethrown.
 */
async function waitForSync(
  ctx: EngineContext,
  opts: {
    driveId: string
    drive: Hyperdrive
    search: SenderSearch
    cleanup: PendingConnection['cleanup']
    logCancel: boolean
  }
): Promise<void> {
  const { driveId } = opts

  const pending: PendingConnection = {
    driveId,
    aborted: false,
    cleanup: async (cleanupOpts) => {
      try {
        await opts.cleanup(cleanupOpts)
      } catch (err) {
        console.log('[HyperdriveManager] Cleanup error (ignored)', (err as Error).message)
      }
    }
  }
  ctx.pendingConnections.set(driveId, pending)

  let abortTimer: NodeJS.Timeout | null = null

  const aborted = new Promise<never>((_, reject) => {
    abortTimer = setInterval(() => {
      if (pending.aborted) {
        reject(new EngineError({
          category: 'receive.cancelled',
          cause: 'open-cancelled',
          message: 'Connection cancelled by user'
        }))
      }
    }, ABORT_POLL_MS)
  })

  // Not a timeout: just shows we are still trying.
  const statusTimer = setInterval(() => {
    if (pending.aborted) {
      return
    }
    const peerConnected = opts.search.peerConnected()
    console.log('[HyperdriveManager] Still searching for peers...', { driveId, peerConnected })
    ctx.emitEvent('connection-status', { driveId, status: 'searching', peerConnected })
  }, SEARCH_STATUS_INTERVAL_MS)

  const stopTimers = () => {
    if (abortTimer) clearInterval(abortTimer)
    clearInterval(statusTimer)
  }

  try {
    await Promise.race([opts.drive.update({ wait: true }), aborted])
    stopTimers()
  } catch (err) {
    stopTimers()

    if (opts.logCancel) {
      console.log('[HyperdriveManager] Connection cancelled, cleaning up', {
        driveId,
        error: (err as Error).message
      })
    }

    ctx.pendingConnections.delete(driveId)
    await pending.cleanup()
    throw err
  }

  ctx.pendingConnections.delete(driveId)
}

/**
 * A connected socket is not proof the drive synced. Every PearDrop share
 * carries a manifest, so "no manifest AND no files" means the metadata has
 * not replicated yet. Persisting that is what wrote the 0-file ghost entry.
 */
function hasData(contents: ShareContents, drive: Hyperdrive, driveId: string): boolean {
  const ready = !!contents.manifest || contents.files.length > 0

  if (!ready) {
    console.warn('[HyperdriveManager] Peer connected but drive has not synced — not persisting yet', {
      driveId,
      coreLength: drive.core?.length ?? null
    })
  }

  return ready
}

/** A share name for a drive without a manifest name. */
function fallbackShareName(contents: ShareContents): string {
  if (contents.files.length === 1) {
    return contents.files[0].displayName || contents.files[0].name
  }
  return contents.files.length > 1 ? 'Folder' : 'Remote Share'
}
