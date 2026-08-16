/**
 * MODULE: lib/progress-tracker.js
 * PURPOSE: Track upload/download progress, emit events for UI updates
 * EXPORTS:
 * ProgressTracker (class) - Progress tracking with events
 * tracker (instance) - Singleton for app-wide use
 * formatBytes(bytes) - Format bytes as "1.2 MB"
 * formatSpeed(bps) - Format speed as "1.2 MB/s"
 * FUNCTIONS (ProgressTracker):
 * trackUploads(driveId, drive, totalBytes) - Track peers downloading from us
 * stopTracking(driveId) - Stop tracking a drive
 *   (download progress is tracked in lib/downloader.js, not here)
 * getActiveTransfers() - Get all active transfer states
 * clear() - Clear all tracking data
 * EVENTS EMITTED:
 * 'peer-connected' - { peerId, driveId }
 * 'peer-disconnected' - { peerId, driveId }
 * 'progress' - { peerId, driveId, bytesTransferred, totalBytes, percent, speed }
 * 'complete' - { peerId, driveId, totalBytes, duration }
 * EXTERNAL CALLS: None (standalone)
 * KEY STATE:
 * transfers (Map) - "driveId:peerId" -> transfer state
 * peersByDrive (Map) - driveId -> Set of peerIds
 */

const { EventEmitter } = require('events')

class ProgressTracker extends EventEmitter {
  constructor() {
    super()
    
    // Track active transfers: Map<peerId, TransferState>
    this.transfers = new Map()
    
    // Track connected peers per drive: Map<driveId, Set<peerId>>
    this.peersByDrive = new Map()
  }

  /**
   * Start tracking uploads for a drive (sender side)
   * @param {string} driveId - Drive identifier
   * @param {Hyperdrive} drive - The Hyperdrive instance
   * @param {number} totalBytes - Total bytes to transfer
   */
  trackUploads(driveId, drive, totalBytes) {
    const blobs = drive.blobs?.core || drive.core
    
    if (!blobs) {
      console.warn('[ProgressTracker] No core found for tracking')
      return
    }

    // Track peer connections
    const swarm = drive.corestore?.swarm
    
    // Initialize peer set for this drive
    if (!this.peersByDrive.has(driveId)) {
      this.peersByDrive.set(driveId, new Set())
    }

    // Listen for upload events on the blobs core
    const uploadHandler = (index, byteLength, peer) => {
      const peerId = peer?.remotePublicKey?.toString('hex')?.slice(0, 12) || 'unknown'

      // Track this peer
      const peers = this.peersByDrive.get(driveId)
      if (!peers.has(peerId)) {
        peers.add(peerId)
        this.emit('peer-connected', { peerId, driveId })
      }

      // Update transfer state
      let transfer = this.transfers.get(`${driveId}:${peerId}`)
      if (!transfer) {
        transfer = {
          driveId,
          peerId,
          totalBytes,
          bytesTransferred: 0,
          startTime: Date.now(),
          lastUpdate: Date.now(),
          lastBytes: 0,
          lastLoggedDecile: -1
        }
        this.transfers.set(`${driveId}:${peerId}`, transfer)
      }

      transfer.bytesTransferred += byteLength
      transfer.lastUpdate = Date.now()

      // Calculate progress
      const percent = Math.min(100, Math.round((transfer.bytesTransferred / totalBytes) * 100))
      const elapsed = (Date.now() - transfer.startTime) / 1000
      const speed = elapsed > 0 ? transfer.bytesTransferred / elapsed : 0

      // THROTTLED LOGGING (2026-07-03): events still fire per block for the UI,
      // but the console gets one line per 10% step instead of 3 lines per 64KB.
      const decile = Math.floor(percent / 10)
      if (decile > transfer.lastLoggedDecile) {
        transfer.lastLoggedDecile = decile
        console.log(`[Upload] ${driveId} → ${peerId} ${percent}% (${formatBytes(transfer.bytesTransferred)}/${formatBytes(totalBytes)} @ ${formatSpeed(speed)})`)
      }

      this.emit('progress', {
        peerId,
        driveId,
        bytesTransferred: transfer.bytesTransferred,
        totalBytes,
        percent,
        speed
      })
      
      // Check for completion
      if (transfer.bytesTransferred >= totalBytes) {
        this.emit('complete', {
          peerId,
          driveId,
          totalBytes,
          duration: Date.now() - transfer.startTime
        })
      }
    }

    blobs.on('upload', uploadHandler)
    
    // Store handler reference for cleanup
    if (!drive._progressHandlers) drive._progressHandlers = []
    drive._progressHandlers.push({ core: blobs, event: 'upload', handler: uploadHandler })
    
    console.log('[ProgressTracker] Tracking uploads for drive', { driveId, totalBytes })
  }

  /**
   * Stop tracking a drive
   * @param {string} driveId - Drive to stop tracking
   */
  stopTracking(driveId) {
    // Remove all transfers for this drive
    for (const key of this.transfers.keys()) {
      if (key.startsWith(`${driveId}:`)) {
        this.transfers.delete(key)
      }
    }
    
    // Remove peer tracking
    const peers = this.peersByDrive.get(driveId)
    if (peers) {
      for (const peerId of peers) {
        this.emit('peer-disconnected', { peerId, driveId })
      }
      this.peersByDrive.delete(driveId)
    }
    
    console.log('[ProgressTracker] Stopped tracking', { driveId })
  }

  /**
   * Get all active transfers
   */
  getActiveTransfers() {
    const active = []
    for (const transfer of this.transfers.values()) {
      const elapsed = (Date.now() - transfer.startTime) / 1000
      active.push({
        ...transfer,
        percent: Math.min(100, Math.round((transfer.bytesTransferred / transfer.totalBytes) * 100)),
        speed: elapsed > 0 ? transfer.bytesTransferred / elapsed : 0
      })
    }
    return active
  }

  /**
   * Clear all tracking
   */
  clear() {
    this.transfers.clear()
    this.peersByDrive.clear()
  }
}

// Utility: Format bytes for display
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Utility: Format speed for display
function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s'
}

// Export singleton and utilities
const tracker = new ProgressTracker()

module.exports = {
  ProgressTracker,
  tracker,
  formatBytes,
  formatSpeed
}
