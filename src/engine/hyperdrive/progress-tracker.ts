/**
 * Upload progress for shared drives (the sender side).
 *
 * Listens to the 'upload' event of each drive's blobs core and turns it into
 * per-peer progress. Download progress is tracked in downloader.ts instead.
 *
 * Events:
 *   'peer-connected'    { peerId, driveId }
 *   'peer-disconnected' { peerId, driveId }
 *   'progress'          UploadProgressEvent
 *   'complete'          UploadCompleteEvent
 */
import { EventEmitter } from 'node:events'
import type Hyperdrive from 'hyperdrive'
import type { HypercoreLike } from 'hyperdrive'
import { formatBytes, formatSpeed } from '../file-utils'
import type { UploadCompleteEvent, UploadProgressEvent } from './types'

interface TransferState {
  driveId: string
  peerId: string
  totalBytes: number
  bytesTransferred: number
  startTime: number
  lastUpdate: number
  /** Last 10% step written to the log, so the log gets one line per step. */
  lastLoggedDecile: number
}

interface RegisteredHandler {
  core: HypercoreLike
  handler: (index: number, byteLength: number, peer?: { remotePublicKey?: Buffer }) => void
}

export interface ActiveTransfer extends TransferState {
  percent: number
  speed: number
}

function percentOf(done: number, total: number): number {
  return Math.min(100, Math.round((done / total) * 100))
}

function bytesPerSecond(bytes: number, startTime: number): number {
  const elapsedSeconds = (Date.now() - startTime) / 1000
  return elapsedSeconds > 0 ? bytes / elapsedSeconds : 0
}

export class ProgressTracker extends EventEmitter {
  /** "driveId:peerId" → transfer state. */
  private readonly transfers = new Map<string, TransferState>()

  /** driveId → peers seen downloading from that drive. */
  private readonly peersByDrive = new Map<string, Set<string>>()

  /**
   * driveId → listeners attached to that drive's core, so stopTracking can
   * detach them. Without this, hypercore could deliver an in-flight upload
   * after teardown and the handler would run against state that no longer
   * exists, crashing the main process.
   */
  private readonly handlersByDrive = new Map<string, RegisteredHandler[]>()

  /** Start tracking peers downloading from one of our drives. */
  trackUploads(driveId: string, drive: Hyperdrive, totalBytes: number): void {
    const core = drive.blobs?.core || drive.core
    if (!core) {
      console.warn('[ProgressTracker] No core found for tracking')
      return
    }

    if (!this.peersByDrive.has(driveId)) {
      this.peersByDrive.set(driveId, new Set())
    }

    const handler: RegisteredHandler['handler'] = (_index, byteLength, peer) => {
      this.onUpload(driveId, totalBytes, byteLength, peer)
    }

    core.on('upload', handler)

    const registered = this.handlersByDrive.get(driveId) || []
    registered.push({ core, handler })
    this.handlersByDrive.set(driveId, registered)

    console.log('[ProgressTracker] Tracking uploads for drive', { driveId, totalBytes })
  }

  private onUpload(
    driveId: string,
    totalBytes: number,
    byteLength: number,
    peer?: { remotePublicKey?: Buffer }
  ): void {
    const peerId = peer?.remotePublicKey?.toString('hex')?.slice(0, 12) || 'unknown'

    // The drive may have been stopped between hypercore queueing this event
    // and delivering it. No entry means we are no longer tracking it.
    const peers = this.peersByDrive.get(driveId)
    if (!peers) {
      return
    }

    if (!peers.has(peerId)) {
      peers.add(peerId)
      this.emit('peer-connected', { peerId, driveId })
    }

    const transfer = this.getOrCreateTransfer(driveId, peerId, totalBytes)
    transfer.bytesTransferred += byteLength
    transfer.lastUpdate = Date.now()

    const percent = percentOf(transfer.bytesTransferred, totalBytes)
    const speed = bytesPerSecond(transfer.bytesTransferred, transfer.startTime)

    // Events fire per block for the UI; the log gets one line per 10% step.
    const decile = Math.floor(percent / 10)
    if (decile > transfer.lastLoggedDecile) {
      transfer.lastLoggedDecile = decile
      const done = formatBytes(transfer.bytesTransferred)
      const total = formatBytes(totalBytes)
      console.log(`[Upload] ${driveId} → ${peerId} ${percent}% (${done}/${total} @ ${formatSpeed(speed)})`)
    }

    const progress: UploadProgressEvent = {
      peerId,
      driveId,
      bytesTransferred: transfer.bytesTransferred,
      totalBytes,
      percent,
      speed
    }
    this.emit('progress', progress)

    if (transfer.bytesTransferred >= totalBytes) {
      const complete: UploadCompleteEvent = {
        peerId,
        driveId,
        totalBytes,
        duration: Date.now() - transfer.startTime
      }
      this.emit('complete', complete)
    }
  }

  private getOrCreateTransfer(driveId: string, peerId: string, totalBytes: number): TransferState {
    const id = `${driveId}:${peerId}`
    let transfer = this.transfers.get(id)

    if (!transfer) {
      transfer = {
        driveId,
        peerId,
        totalBytes,
        bytesTransferred: 0,
        startTime: Date.now(),
        lastUpdate: Date.now(),
        lastLoggedDecile: -1
      }
      this.transfers.set(id, transfer)
    }

    return transfer
  }

  /** Stop tracking a drive and forget its transfers. */
  stopTracking(driveId: string): void {
    // Detach listeners FIRST, so no event arrives while state is dismantled.
    const registered = this.handlersByDrive.get(driveId)
    if (registered) {
      for (const { core, handler } of registered) {
        try {
          core.removeListener('upload', handler)
        } catch (err) {
          console.warn('[ProgressTracker] Could not detach listener', (err as Error).message)
        }
      }
      this.handlersByDrive.delete(driveId)
    }

    for (const id of this.transfers.keys()) {
      if (id.startsWith(`${driveId}:`)) {
        this.transfers.delete(id)
      }
    }

    const peers = this.peersByDrive.get(driveId)
    if (peers) {
      for (const peerId of peers) {
        this.emit('peer-disconnected', { peerId, driveId })
      }
      this.peersByDrive.delete(driveId)
    }

    console.log('[ProgressTracker] Stopped tracking', { driveId })
  }

  /** Every transfer in progress, with its percent and speed. */
  getActiveTransfers(): ActiveTransfer[] {
    return [...this.transfers.values()].map((transfer) => ({
      ...transfer,
      percent: percentOf(transfer.bytesTransferred, transfer.totalBytes),
      speed: bytesPerSecond(transfer.bytesTransferred, transfer.startTime)
    }))
  }

  clear(): void {
    this.transfers.clear()
    this.peersByDrive.clear()
  }
}
