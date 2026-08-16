/**
 * MODULE: lib/hyperdrive-manager.js
 * PURPOSE: Manages Hyperdrive lifecycle for P2P file sharing
 * EXPORTS:
 * HyperdriveManager (class) - Main manager class
 * manager (instance) - Singleton for app-wide use
 * DriveState (enum) - CREATING, ACTIVE, PAUSED, ERRORED
 * FUNCTIONS:
 *   Core P2P:
 * init() - Load state, ensure directories, cleanup incomplete, resume active
 * createDrive(files, options) - Create share with manifest, join swarm
 * openDrive(shareLink) - Connect to remote drive, read manifest
 * stopDrive(driveId, options) - Leave swarm, close drive; opts: delete, persistState
 * stopAll(options) - Stop all active drives
 * getStatus() - Return active/stopped drives and stats
 * cleanupManifest() - Remove deleted entries from manifest
 *   UI Interface (DriveManager compatibility):
 * addDriveEntry(data) - Add drive with UI-friendly data
 * removeDriveEntry(id, opts) - Remove drive entry + optional file/storage cleanup
 * updateDriveEntry(id, updates) - Update drive entry data
 * pauseDriveEntry(id) - Mark drive as paused (UI state)
 * resumeDrive(id) - Re-open drive, rejoin swarm, persist ACTIVE
 * getDriveEntry(id) - Get single drive by ID
 * getAllDriveEntries() - Get all drives as array
 * getDriveEntryByKey(key) - Find drive by hyperdrive key (dedup)
 * checkLocalAvailability(id) - Check if local files exist
 *   Resume (called by init):
 * _resumeActiveDrives() - Resume all ACTIVE drives from state
 * _resumeDrive(driveId, metadata) - Resume single drive, rejoin swarm
 *   File Operations (for UI):
 * setDownloadedFiles(driveId, files, destDir) - Store downloaded file paths
 * getDriveInfo(driveId) - Get drive metadata and file paths
 * openFile(driveId) - Open first file in default app
 * showInFolder(driveId) - Show file in Finder/Explorer
 * openDownloadsFolder() - Open ~/peardrop/downloads
 * EVENTS EMITTED:
 * 'peer-connected' - { driveId, peerId }
 * 'peer-disconnected' - { driveId, peerId }
 * 'upload-progress' - { driveId, peerId, percent, bytesTransferred... }
 * 'upload-complete' - { driveId, peerId, totalBytes, duration }
 * 'drive-created' - { driveId, shareLink, metadata }
 * 'drive-stopped' - { driveId, deleted }
 * EXTERNAL CALLS:
 * Corestore, Hyperdrive, Hyperswarm (holepunch P2P stack)
 * ./progress-tracker.js (tracker singleton)
 * KEY STATE:
 * activeDrives (Map) - driveId -> { drive, store, swarm, metadata }
 * manifest (Object) - Persistent tracking: drives{}, stats{}
 * KEY CONSTANTS:
 * DRIVE_MANIFEST_PATH - '/.peardrop.json' (in-drive metadata)
 * DRIVES_STATE_FILE - ~/peardrop/drives-state.json (local tracking)
 * PEARDROP_DIR - ~/peardrop
 * DRIVES_DIR - ~/peardrop/drives
 */

const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Hyperswarm = require('hyperswarm')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { EventEmitter } = require('events')
const { tracker } = require('./progress-tracker')
const { computeTruncation } = require('./file-utils')
const { EngineError } = require('./engine-errors')

// For file operations
let shell = null
try {
  shell = require('electron').shell
} catch (e) {
  // Not in Electron context (CLI usage)
}

// PearDrop in-drive manifest (metadata file inside shared drives)
const DRIVE_MANIFEST_PATH = '/.peardrop.json'
const DRIVE_MANIFEST_VERSION = 1
const DRIVE_MANIFEST_MAX_SIZE = 64 * 1024  // 64KB max
const DRIVE_MANIFEST_MAX_FILES = 1000      // Max files to list

// Storage paths
const PEARDROP_DIR = path.join(os.homedir(), 'peardrop')
const DRIVES_DIR = path.join(PEARDROP_DIR, 'drives')
const DRIVES_STATE_FILE = path.join(PEARDROP_DIR, 'drives-state.json')

/**
 * Drive states for tracking lifecycle
 */
const DriveState = {
  CREATING: 'creating',  // Temporary during creation
  ACTIVE: 'active',      // Sharing and available (DEFAULT)
  SEEKING: 'seeking',    // Download attempting to find peers
  PAUSED: 'paused',      // User explicitly paused, can resume
  ERRORED: 'errored'     // Something wrong, needs fixing  
  // Note: No PURGED state - drives are either active or completely deleted
}

/**
 * HyperdriveManager - Manages ephemeral file sharing drives
 */
class HyperdriveManager extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.drivesDir = options.drivesDir || DRIVES_DIR
    this.manifestPath = options.manifestPath || DRIVES_STATE_FILE
    
    // Active drives: Map<driveId, DriveSession>
    this.activeDrives = new Map()
    
    // Pending connections that can be aborted: Map<driveId, AbortController-like>
    this.pendingConnections = new Map()

    // Resume failures, in-memory ONLY (never persisted): Map<driveId, {error, at}>
    // Kept out of this.manifest so a later _saveManifest() can't accidentally
    // persist a transient boot failure as a permanent drive state.
    this.resumeErrors = new Map()
    
    // Manifest: persistent record of all drives ever created
    this.manifest = {
      drives: {},      // driveId -> metadata
      stats: {
        totalCreated: 0,
        totalPurged: 0,
        totalBytesShared: 0
      }
    }
    
    this.initialized = false
  }
  
  /**
   * Abort a pending connection attempt
   */
  abortConnection(driveId) {
    const pending = this.pendingConnections.get(driveId)
    if (pending) {
      console.log('[HyperdriveManager] Aborting connection', { driveId })
      pending.aborted = true
      if (pending.cleanup) pending.cleanup()
      this.pendingConnections.delete(driveId)
      return true
    }
    return false
  }
  
  /**
   * Abort all pending connections
   */
  abortAllConnections() {
    for (const [driveId] of this.pendingConnections) {
      this.abortConnection(driveId)
    }
  }

  /**
   * Initialize the manager - load manifest, ensure directories exist, resume drives
   */
  async init() {
    if (this.initialized) return
    
    // Ensure directories exist
    await fs.mkdir(this.drivesDir, { recursive: true })
    
    // Load existing manifest
    await this._loadManifest()
    
    // Clean up incomplete drives (stuck in CREATING state)
    await this._cleanupOrphanedDrives()
    
    // Resume drives that were active when we last exited
    await this._resumeActiveDrives()
    
    this.initialized = true

    // One-line boot summary with state breakdown, so "why isn't drive X
    // announcing?" is answerable from the first lines of the log.
    const stateCounts = {}
    for (const meta of Object.values(this.manifest.drives)) {
      stateCounts[meta.state] = (stateCounts[meta.state] || 0) + 1
    }
    console.log(`[HyperdriveManager] Initialized: ${this.activeDrives.size} announcing / ${Object.keys(this.manifest.drives).length} tracked`,
      stateCounts, this.resumeErrors.size ? `(${this.resumeErrors.size} resume failure(s), will retry next boot)` : '')
  }

  /**
   * Create a new drive for sharing files
   * @param {Array<{name: string, path: string, size: number}>} files - Files to share
   * @param {Object} options - Share options
   * @param {number} options.ttlMs - Time-to-live in milliseconds (0 = indefinite)
   * @param {string} options.name - Optional friendly name for the share
   * @returns {Promise<{driveId: string, shareLink: string, key: string}>}
   */
  async createDrive(files, options = {}) {
    if (!this.initialized) await this.init()
    
    const driveId = this._generateDriveId()
    const drivePath = path.join(this.drivesDir, driveId)
    
    console.log('[HyperdriveManager] Creating drive', { driveId, fileCount: files.length })
    
    // Create isolated Corestore session for this drive
    const store = new Corestore(drivePath)
    await store.ready()
    
    // Create the Hyperdrive
    const drive = new Hyperdrive(store)
    await drive.ready()
    
    const key = drive.key.toString('hex')
    const discoveryKey = drive.discoveryKey.toString('hex')
    
    // Record in manifest BEFORE adding files (so we can cleanup on failure)
    const metadata = {
      driveId,
      key,
      discoveryKey,
      state: DriveState.CREATING,
      createdAt: Date.now(),
      ttlMs: options.ttlMs || 0,
      expiresAt: options.ttlMs ? Date.now() + options.ttlMs : null,
      name: options.name || `Share ${driveId.slice(0, 8)}`,
      files: [],
      totalBytes: 0,
      storagePath: drivePath
    }
    
    this.manifest.drives[driveId] = metadata
    this.manifest.stats.totalCreated++
    await this._saveManifest()
    
    try {
      // Add all files to the drive
      let totalBytes = 0
      const fileEntries = []
      
      for (const file of files) {
        const fileName = file.name || path.basename(file.path)
        // Use relativePath if provided (for folder structure), otherwise just the filename
        const storagePath = file.relativePath || fileName
        
        // Get file size without loading into memory
        const stats = await fs.stat(file.path)
        const fileSize = stats.size
        
        // Create read stream for large files instead of loading into memory
        const readStream = require('fs').createReadStream(file.path)
        const writeStream = drive.createWriteStream(`/${storagePath}`)
        
        // Pipe the file data through streams
        await new Promise((resolve, reject) => {
          readStream.pipe(writeStream)
          writeStream.on('finish', resolve)
          writeStream.on('error', reject)
          readStream.on('error', reject)
        })
        
        totalBytes += fileSize
        fileEntries.push({
          name: fileName,
          storagePath: storagePath,
          size: fileSize,
          addedAt: Date.now()
        })
        
        console.log('[HyperdriveManager] Added file', { storagePath, size: fileSize })
      }
      
      // Create and add PearDrop manifest
      const peardropManifest = {
        version: DRIVE_MANIFEST_VERSION,
        name: options.name || (files.length === 1 ? fileEntries[0].name : `${files.length} files`),
        created: Date.now(),
        files: fileEntries.map(f => ({
          path: `/${f.storagePath}`,
          name: f.name,
          size: f.size
        })),
        totalBytes,
        totalFiles: fileEntries.length
      }
      
      await drive.put(DRIVE_MANIFEST_PATH, Buffer.from(JSON.stringify(peardropManifest)))
      console.log('[HyperdriveManager] Added manifest', { totalBytes, files: fileEntries.length })
      
      // Update metadata
      metadata.files = fileEntries
      metadata.totalBytes = totalBytes
      metadata.state = DriveState.ACTIVE
      this.manifest.stats.totalBytesShared += totalBytes
      await this._saveManifest()
      
      // Create swarm for sharing
      const swarm = new Hyperswarm()
      
      // Debug: Log swarm status
      console.log('[HyperdriveManager] Swarm created, DHT bootstrapping...', { driveId })
      
      // Handle connections
      swarm.on('connection', (socket, peerInfo) => {
        const peerId = peerInfo?.publicKey?.toString('hex')?.slice(0, 12) || 'peer'
        console.log('[HyperdriveManager] Peer connected', { driveId, peerId })
        
        // Emit peer connected event
        this.emit('peer-connected', { driveId, peerId })
        
        store.replicate(socket)
        
        socket.on('close', () => {
          console.log('[HyperdriveManager] Peer disconnected', { driveId, peerId })
          this.emit('peer-disconnected', { driveId, peerId })
        })
        
        socket.on('error', (err) => {
          console.log('[HyperdriveManager] Socket error', { driveId, peerId, error: err.message })
        })
      })
      
      // Join the swarm
      const done = drive.findingPeers()
      const topic = swarm.join(drive.discoveryKey)
      
      // Log when we're announced on the DHT (include the LINK key prefix so a
      // pasted link can be matched to a live drive at a glance)
      topic.flushed().then(() => {
        console.log(`[HyperdriveManager] Announced on DHT: ${driveId} link=peardrop://${drive.key.toString('hex').slice(0, 12)}… topic=${drive.discoveryKey.toString('hex').slice(0, 12)}…`)
      })
      
      swarm.flush().then(done, done)
      
      // Start tracking upload progress
      tracker.trackUploads(driveId, drive, totalBytes)

      // Forward progress events. Named handlers stored on the session so
      // stopDrive can remove them — the tracker is a long-lived singleton, so
      // anonymous listeners here would leak (and double-emit) on every
      // create/resume.
      const onTrackerProgress = (data) => {
        if (data.driveId === driveId) this.emit('upload-progress', data)
      }
      const onTrackerComplete = (data) => {
        if (data.driveId === driveId) this.emit('upload-complete', data)
      }
      tracker.on('progress', onTrackerProgress)
      tracker.on('complete', onTrackerComplete)

      // Store session info
      const session = {
        driveId,
        drive,
        store,
        swarm,
        metadata,
        totalBytes,
        createdAt: Date.now(),
        trackerHandlers: { onTrackerProgress, onTrackerComplete }
      }
      this.activeDrives.set(driveId, session)
      
      // Set up TTL expiration if specified
      if (options.ttlMs > 0) {
        session.expirationTimer = setTimeout(() => {
          console.log('[HyperdriveManager] Drive expired', { driveId })
          this.stopDrive(driveId, { delete: true })
        }, options.ttlMs)
      }
      
      const shareLink = this._createShareLink(key)
      
      console.log('[HyperdriveManager] Drive created and sharing', {
        driveId,
        shareLink,
        files: fileEntries.length,
        totalBytes
      })
      
      this.emit('drive-created', { driveId, shareLink, metadata })
      
      return { driveId, shareLink, key }
      
    } catch (error) {
      // Cleanup on failure
      console.error('[HyperdriveManager] Failed to create drive', error)
      metadata.state = DriveState.ERRORED
      metadata.error = error.message
      await this._saveManifest()
      
      await drive.close()
      await store.close()
      
      throw error
    }
  }

  /**
   * Stop sharing a drive
   * @param {string} driveId - Drive ID to stop
   * @param {Object} options
   * @param {boolean} options.delete - Whether to completely remove drive (default: false)
   * @param {boolean} options.persistState - Write PAUSED to the manifest (default: true).
   *   Pass false for app shutdown: disconnect from the network but leave the
   *   drive's persisted state untouched so it auto-resumes on next boot.
   *   (Bug fixed 2026-07-03: quit used to persist PAUSED for every drive, so
   *   each graceful quit permanently demoted all shares and nothing announced
   *   on the next boot.)
   */
  async stopDrive(driveId, options = { delete: false }) {
    const session = this.activeDrives.get(driveId)
    
    if (!session) {
      console.warn('[HyperdriveManager] Drive not active', { driveId })
      return
    }
    
    console.log('[HyperdriveManager] Stopping drive', { driveId, delete: options.delete })
    
    // Clear expiration timer
    if (session.expirationTimer) {
      clearTimeout(session.expirationTimer)
    }
    
    // Stop progress tracking and remove this drive's tracker listeners so they
    // don't accumulate on the singleton tracker across restarts.
    tracker.stopTracking(driveId)
    if (session.trackerHandlers) {
      tracker.removeListener('progress', session.trackerHandlers.onTrackerProgress)
      tracker.removeListener('complete', session.trackerHandlers.onTrackerComplete)
    }

    // Leave swarm
    if (session.swarm) {
      await session.swarm.destroy()
    }
    
    // Close drive first
    if (session.drive) {
      try {
        await session.drive.close()
        console.log('[HyperdriveManager] Drive closed', { driveId })
      } catch (err) {
        console.warn('[HyperdriveManager] Error closing drive', err.message)
      }
    }
    
    // Close corestore session
    if (session.store) {
      try {
        await session.store.close()
        console.log('[HyperdriveManager] Store closed', { driveId })
      } catch (err) {
        console.warn('[HyperdriveManager] Error closing store', err.message)
      }
    }
    
    // Delete storage directory if requested (manual cleanup)
    if (options.delete && session.metadata?.storagePath) {
      try {
        await fs.rm(session.metadata.storagePath, { recursive: true, force: true })
        console.log('[HyperdriveManager] Storage deleted', { 
          path: session.metadata.storagePath 
        })
      } catch (err) {
        console.warn('[HyperdriveManager] Failed to delete storage', err.message)
      }
    }
    
    // Update manifest
    const metadata = this.manifest.drives[driveId]
    if (metadata) {
      if (options.delete) {
        // Drive will be completely removed - delete from manifest
        delete this.manifest.drives[driveId]
        this.manifest.stats.totalPurged++
        await this._saveManifest()
      } else if (options.persistState !== false) {
        // User-initiated pause: persist it
        metadata.state = DriveState.PAUSED
        metadata.stoppedAt = Date.now()
        await this._saveManifest()
      }
      // persistState === false (app shutdown): leave persisted state alone so
      // the drive resumes and re-announces on next boot.
    }
    
    // Remove from active drives
    this.activeDrives.delete(driveId)
    
    this.emit('drive-stopped', { driveId, deleted: options.delete })
    
    console.log('[HyperdriveManager] Drive fully stopped', { driveId })
  }

  /**
   * Open a drive for downloading (receiving files)
   * @param {string} shareLink - peardrop:// link
   * @returns {Promise<{driveId: string, files: Array, download: Function}>}
   */
  async openDrive(shareLink) {
    // NOTE: Removed init() call to prevent infinite loops during resume
    // openDrive() is an internal method that should only be called after init()
    
    const key = this._parseShareLink(shareLink)
    if (!key) {
      throw new EngineError({
        category: 'receive.invalid-link',
        cause: 'invalid-link',
        message: 'Invalid share link',
      })
    }
    
    const driveId = `recv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const drivePath = path.join(this.drivesDir, driveId)

    // Persistence deferred until a peer actually connects (see the post-peer
    // addDriveEntry below). The pre-peer stub used to live here — but if
    // the open was cancelled OR the app was killed during the seeking window,
    // the stub survived in drives-state.json with `files: []` and a matching
    // key, which then produced a false "Already downloaded" duplicate hit on
    // the next paste of the same link (Cluster 3 in the 5A investigation).
    // Not persisting until peer contact means every path through this
    // function ends with either "manifest has a real entry" or "manifest
    // has no entry" — no orphan stubs.

    console.log('[HyperdriveManager] Opening remote drive', { driveId, key: key.slice(0, 16) + '...' })
    
    // Create isolated Corestore session
    const store = new Corestore(drivePath)
    await store.ready()
    
    // Open the remote drive by key
    const drive = new Hyperdrive(store, Buffer.from(key, 'hex'))
    await drive.ready()
    
    // Join swarm to find peers
    const swarm = new Hyperswarm()
    
    console.log('[HyperdriveManager] Joining swarm to find sender...', { 
      driveId, 
      discoveryKey: drive.discoveryKey.toString('hex').slice(0, 16) + '...'
    })
    
    let peerConnected = false
    let peerDisconnected = false
    swarm.on('connection', (socket) => {
      peerConnected = true
      console.log('[HyperdriveManager] Connected to peer for download', { driveId })
      store.replicate(socket)
      
      socket.on('error', (err) => {
        console.log('[HyperdriveManager] Download socket error', { driveId, error: err.message })
      })
      
      socket.on('close', () => {
        peerDisconnected = true
        console.log('[HyperdriveManager] Download peer disconnected', { driveId })
        this.emit('download-peer-disconnected', { driveId })
      })
    })
    
    // Join swarm for persistent peer discovery (no timeout)
    const topic = swarm.join(drive.discoveryKey)
    
    // Log DHT lookup progress
    topic.flushed().then(() => {
      console.log('[HyperdriveManager] DHT lookup complete', { driveId, peerConnected })
    })
    
    await swarm.flush()
    // REMOVED: done() - Keep seeking peers indefinitely
    
    console.log('[HyperdriveManager] Swarm flushed, waiting for drive update...', { driveId, peerConnected })
    
    // Track this pending connection so it can be aborted
    const pendingConnection = {
      driveId,
      aborted: false,
      cleanup: async () => {
        try {
          await swarm.destroy()
          await drive.close()
          await store.close()
          await fs.rm(drivePath, { recursive: true, force: true })
          // Belt-and-braces: if any codepath ever creates an early manifest
          // stub (pre-Sprint-5A there was one at line ~527), remove it here
          // so a next paste of the same link doesn't produce a false
          // "Already downloaded" duplicate hit. Idempotent — removeDriveEntry
          // is a no-op when the entry is already absent. `deleteStorage:false`
          // because the fs.rm above already covers the storage folder.
          await this.removeDriveEntry(driveId, { deleteStorage: false })
        } catch (err) {
          console.log('[HyperdriveManager] Cleanup error (ignored)', err.message)
        }
      }
    }
    this.pendingConnections.set(driveId, pendingConnection)
    
    // Wait for drive to update - NO TIMEOUT, only user cancellation
    // Periodic status updates to show we're still trying
    const REFRESH_INTERVAL_MS = 30000 // Log every 30 seconds
    const updatePromise = drive.update({ wait: true })
    
    const abortPromise = new Promise((_, reject) => {
      const checkAbort = setInterval(() => {
        if (pendingConnection.aborted) {
          clearInterval(checkAbort)
          reject(new EngineError({
            category: 'receive.cancelled',
            cause: 'open-cancelled',
            message: 'Connection cancelled by user',
          }))
        }
      }, 100)
      pendingConnection.abortCheck = checkAbort
    })
    
    // Periodic refresh/status logging (not a timeout - just shows we're still trying)
    const refreshInterval = setInterval(() => {
      if (!pendingConnection.aborted) {
        console.log('[HyperdriveManager] Still searching for peers...', { driveId, peerConnected })
        this.emit('connection-status', { driveId, status: 'searching', peerConnected })
      }
    }, REFRESH_INTERVAL_MS)
    pendingConnection.refreshInterval = refreshInterval
    
    try {
      await Promise.race([updatePromise, abortPromise])
      // Clear intervals on success
      if (pendingConnection.abortCheck) clearInterval(pendingConnection.abortCheck)
      if (pendingConnection.refreshInterval) clearInterval(pendingConnection.refreshInterval)
    } catch (err) {
      // Clear intervals
      if (pendingConnection.abortCheck) clearInterval(pendingConnection.abortCheck)
      if (pendingConnection.refreshInterval) clearInterval(pendingConnection.refreshInterval)
      // Cleanup on abort
      console.log('[HyperdriveManager] Connection cancelled, cleaning up', { driveId, error: err.message })
      this.pendingConnections.delete(driveId)
      await pendingConnection.cleanup()
      throw err
    }
    
    // Connection successful - remove from pending
    this.pendingConnections.delete(driveId)
    
    // Only read drive data when we have verified peer connections
    let files = []
    let manifest = null
    let totalBytes = 0
    let shareName = null
    let truncated = null

    if (!peerConnected) {
      console.log('[HyperdriveManager] No peer connected yet - drive remains in seeking state')
      // Don't read any data - keep drive in seeking state
    } else {
      // We have peer connection - safe to read drive data
      try {
        const manifestData = await drive.get(DRIVE_MANIFEST_PATH)
      if (manifestData && manifestData.length <= DRIVE_MANIFEST_MAX_SIZE) {
        manifest = JSON.parse(manifestData.toString())

        // Validate manifest
        if (manifest.version === DRIVE_MANIFEST_VERSION && Array.isArray(manifest.files)) {
          shareName = manifest.name
          totalBytes = manifest.totalBytes || 0

          // Surface a truncation hint when the manifest declares more files
          // than the receive cap allows. The slice below caps at 1000; this
          // signal lets the UI say "showing 1000 of N" instead of silently
          // dropping the overflow. Matches mobile's `truncated` field shape.
          truncated = computeTruncation(manifest.files.length, DRIVE_MANIFEST_MAX_FILES)

          // Extract files (with security limits)
          files = manifest.files.slice(0, DRIVE_MANIFEST_MAX_FILES).map(f => {
            // Security: validate path doesn't have traversal
            const safePath = f.path?.replace(/\.\./g, '').replace(/^\/+/, '/')
            return {
              name: safePath || f.name,
              displayName: f.name,
              size: f.size || 0
            }
          })
          
          console.log('[HyperdriveManager] Loaded manifest', { 
            shareName, 
            files: files.length, 
            totalBytes 
          })
        }
      }
      } catch (err) {
        console.log('[HyperdriveManager] No manifest, falling back to listing', err.message)
      }
      
      // Fallback: list files from drive directly (only when peer connected)
      if (files.length === 0) {
        for await (const entry of drive.list('/')) {
          // Skip manifest file
          if (entry.key === DRIVE_MANIFEST_PATH) continue
          
          files.push({
            name: entry.key,
            displayName: path.basename(entry.key),
            size: entry.value?.blob?.byteLength || 0
          })
        }
        totalBytes = files.reduce((sum, f) => sum + f.size, 0)
      }
    } // End peer connected check
    
    const session = {
      driveId,
      drive,
      store,
      swarm,
      isReceiving: true,
      manifest,
      totalBytes,
      shareName,
      shareLink,  // IMPORTANT: Save the original share link for history/re-sharing
      metadata: { key },  // Save key for fallback link generation
      createdAt: Date.now()
    }
    this.activeDrives.set(driveId, session)
    
    // First and only persist for this drive — the pre-peer stub write that
    // used to happen up-front (Cluster 3 in the 5A investigation) has been
    // removed, so this is where the manifest entry actually comes into
    // being. Only writes when a peer has actually connected; a
    // never-connected open ends with no manifest entry, which is what makes
    // "cancelled or crashed open leaves a stub" impossible.
    if (peerConnected) {
      await this.addDriveEntry({
        driveId: driveId,
        key: drive.key.toString('hex'), // Use canonical drive key format
        discoveryKey: drive.discoveryKey.toString('hex'),
        state: 'seeking', // Stay seeking until download completes
        shareLink: shareLink,
        isUpload: false,
        files: files,
        totalBytes: totalBytes,
        storagePath: path.join(this.drivesDir, driveId),
        createdAt: Date.now(),
        name: shareName || 'Remote Share',
        lastAttempt: Date.now()
      })
    }
    
    console.log('[HyperdriveManager] Remote drive opened', { 
      driveId, 
      files: files.length,
      totalBytes,
      hasManifest: !!manifest,
      peerConnected
    })
    
    return {
      driveId,
      files,
      shareName,
      totalBytes,
      hasManifest: !!manifest,
      peerConnected,
      truncated,

      // Expose the drive so external callers (e.g. the CLI's `peardrop
      // download`) can pass it directly to lib/downloader.js. The GUI IPC
      // handler reaches through `hyperdriveManager.activeDrives.get(driveId)`
      // to get the same reference; this field is the equivalent surface for
      // callers that hold the openDrive return value.
      drive,

      /**
       * Close this receiving session and cleanup
       */
      close: async () => {
        await this.stopDrive(driveId, { delete: true })
      }
    }
  }

  // ============================================================================
  // UI INTERFACE (DriveManager compatibility - single source of truth)
  // ============================================================================

  /**
   * Add a drive to the manifest with UI-friendly data
   * Merges P2P data with presentation data for frontend consumption
   */
  async addDriveEntry(driveData) {
    // NOTE: Removed init() call to prevent infinite loops
    // addDriveEntry() is an internal method that should only be called after init()
    
    const driveId = driveData.id || driveData.driveId
    
    // Use provided name - caller is responsible for setting appropriate name
    const shareLink = driveData.shareLink || `peardrop://${driveData.key}`
    
    const entry = {
      // Core P2P data
      driveId,
      key: driveData.key,
      discoveryKey: driveData.discoveryKey,
      state: driveData.state || DriveState.ACTIVE,
      
      // File system data
      files: driveData.files || [],
      totalBytes: driveData.totalBytes || 0,
      localPath: driveData.localPath || null,
      storagePath: driveData.storagePath || path.join(this.drivesDir, driveId),
      
      // UI-friendly cached data  
      name: driveData.name || 'Untitled Share',
      shareLink,
      
      // Transfer metadata
      createdAt: driveData.createdAt || Date.now(),
      isUpload: driveData.isUpload || false,
      
      // Stats
      stats: {
        uploaded: 0,
        downloaded: 0,
        peers: 0,
        ...driveData.stats
      }
    }
    
    this.manifest.drives[driveId] = entry
    await this._saveManifest()
    
    console.log('[HyperdriveManager] Drive entry added', { id: driveId, name: entry.name })
    return entry
  }

  /**
   * Remove drive entry and optionally delete files/storage
   */
  async removeDriveEntry(id, opts = {}) {
    // NOTE: Removed init() call to prevent infinite loops during deletion
    // removeDriveEntry() is an internal method that should only be called after init()
    
    const drive = this.manifest.drives[id]
    if (!drive) {
      console.log('[HyperdriveManager] Remove entry: not found', { id })
      return false
    }
    
    console.log('[HyperdriveManager] Removing drive entry', { 
      id, 
      name: drive.name,
      deleteFiles: opts.deleteFiles, 
      deleteStorage: opts.deleteStorage 
    })
    
    // Delete hyperdrive storage directory
    if (opts.deleteStorage && drive.storagePath) {
      try {
        await fs.rm(drive.storagePath, { recursive: true, force: true })
        console.log('[HyperdriveManager] Storage deleted', { path: drive.storagePath })
      } catch (err) {
        console.warn('[HyperdriveManager] Storage delete failed:', err.message)
      }
    }
    
    // Delete local files
    if (opts.deleteFiles && drive.files) {
      for (const file of drive.files) {
        if (file.path) {
          try {
            await fs.unlink(file.path)
            console.log('[HyperdriveManager] File deleted', { path: file.path })
          } catch (err) {
            console.warn('[HyperdriveManager] File delete failed:', err.message)
          }
        }
      }
    }
    
    // Remove from manifest
    delete this.manifest.drives[id]
    await this._saveManifest()
    
    console.log('[HyperdriveManager] Drive entry removed completely', { id })
    return true
  }

  /**
   * Update drive entry data
   */
  async updateDriveEntry(id, updates) {
    // NOTE: Removed init() call to prevent infinite loops
    // updateDriveEntry() is an internal method that should only be called after init()
    
    const drive = this.manifest.drives[id]
    if (!drive) return null
    
    Object.assign(drive, updates)
    
    // Recompute derived data if files changed
    if (updates.files) {
      drive.name = this._computeDisplayName(updates.files)
      drive.totalBytes = updates.files.reduce((sum, f) => sum + (f.size || 0), 0)
    }
    
    await this._saveManifest()
    return drive
  }

  /**
   * Pause drive (manifest state; the network side is stopped by the caller
   * via stopDrive, which persists PAUSED itself — this keeps them consistent)
   */
  async pauseDriveEntry(id) {
    const drive = this.manifest.drives[id]
    if (!drive) return null

    drive.state = DriveState.PAUSED
    drive.pausedAt = Date.now()
    await this._saveManifest()

    console.log('[HyperdriveManager] Drive entry paused', { id, name: drive.name })
    return drive
  }

  /**
   * Resume a paused/errored drive: actually re-open the corestore, rejoin the
   * swarm, and re-announce — then persist ACTIVE.
   * (Fixed 2026-07-03: the old resumeDriveEntry only flipped the manifest
   * field with a "TODO: rejoin swarm" — the Resume button was a no-op until
   * the next app restart.)
   */
  async resumeDrive(id) {
    const metadata = this.manifest.drives[id]
    if (!metadata) return null

    if (this.activeDrives.has(id)) {
      console.log('[HyperdriveManager] Drive already active', { id })
      return metadata
    }

    // A paused DOWNLOAD (isUpload:false / recv_*) must resume as seeking, not
    // as a share — _resumeDrive routes on state, so restore it first.
    if (metadata.isUpload === false && metadata.state === DriveState.PAUSED) {
      metadata.state = DriveState.SEEKING
    }

    // Rejoin first; only persist the new state if it actually came back up.
    await this._resumeDrive(id, metadata)

    // Shares become ACTIVE; resumed downloads stay SEEKING until they complete
    if (metadata.state !== DriveState.SEEKING) {
      metadata.state = DriveState.ACTIVE
    }
    delete metadata.pausedAt
    delete metadata.stoppedAt
    delete metadata.error
    this.resumeErrors.delete(id)
    await this._saveManifest()

    console.log('[HyperdriveManager] Drive resumed and announcing', { id, name: metadata.name })
    return metadata
  }

  /**
   * Get single drive by ID (UI interface)
   */
  getDriveEntry(id) {
    return this.manifest.drives[id] || null
  }

  /**
   * Get all drives as array (UI interface) 
   */
  getAllDriveEntries() {
    return Object.values(this.manifest.drives)
  }

  /**
   * Get active drives (UI interface)
   */
  getActiveDriveEntries() {
    return this.getAllDriveEntries().filter(d => d.state === DriveState.ACTIVE)
  }

  /**
   * Find drive by hyperdrive key (for deduplication)
   */
  getDriveEntryByKey(key) {
    if (!key) return null
    const normalizedKey = key.toLowerCase()
    return this.getAllDriveEntries().find(d => d.key?.toLowerCase() === normalizedKey) || null
  }

  /**
   * Check if local files still exist for a drive
   */
  async checkLocalAvailability(id) {
    const drive = this.manifest.drives[id]
    if (!drive || !drive.files || drive.files.length === 0) return false
    
    // Check first file exists
    try {
      await fs.access(drive.files[0].path)
      return true
    } catch {
      return false
    }
  }

  /**
   * Compute display name from file list
   */
  _computeDisplayName(files) {
    if (!files || files.length === 0) return 'Empty share'
    if (files.length === 1) return files[0].name
    return `${files.length} files`
  }

  // ============================================================================
  // FILE OPERATIONS (for UI actions: open, show in folder, etc.)
  // ============================================================================

  /**
   * Store downloaded file info for a drive
   * Called after download completes
   * @param {string} driveId 
   * @param {Array<{name, path, size}>} files 
   * @param {string} destDir - Download destination directory
   */
  setDownloadedFiles(driveId, files, destDir) {
    const session = this.activeDrives.get(driveId)
    if (session) {
      session.downloadedFiles = files
      session.localPath = destDir
    }
    
    // Also update manifest for persistence
    const metadata = this.manifest.drives[driveId]
    if (metadata) {
      metadata.files = files.map(f => ({
        name: f.name,
        path: f.path,
        size: f.size
      }))
      metadata.localPath = destDir
      this._saveManifest()
    }
    
    console.log('[HyperdriveManager] Stored file info', { driveId, files: files.length, destDir })
  }

  /**
   * Get file info for a drive (downloaded files)
   * @param {string} driveId 
   * @returns {{success: boolean, drive?: object, error?: string}}
   */
  getDriveInfo(driveId) {
    // Check active sessions first
    const session = this.activeDrives.get(driveId)
    if (session) {
      return {
        success: true,
        drive: {
          id: driveId,
          files: session.downloadedFiles || session.metadata?.files || [],
          localPath: session.localPath || session.metadata?.localPath,
          shareLink: session.shareLink || this._createShareLink(session.metadata?.key),
          shareName: session.shareName || session.metadata?.name,
          totalBytes: session.totalBytes || session.metadata?.totalBytes,
          isReceiving: session.isReceiving || false
        }
      }
    }
    
    // Check manifest for completed/closed drives
    const metadata = this.manifest.drives[driveId]
    if (metadata) {
      return {
        success: true,
        drive: {
          id: driveId,
          files: metadata.files || [],
          localPath: metadata.localPath,
          shareLink: this._createShareLink(metadata.key),
          shareName: metadata.name,
          totalBytes: metadata.totalBytes
        }
      }
    }
    
    return { success: false, error: 'Drive not found' }
  }

  /**
   * Open the first file of a drive in default application
   * @param {string} driveId 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async openFile(driveId) {
    if (!shell) {
      return { success: false, error: 'Shell not available (not in Electron)' }
    }
    
    const info = this.getDriveInfo(driveId)
    if (!info.success) return info
    
    const filePath = this._getFirstFilePath(info.drive)
    if (!filePath) {
      // Fallback to downloads folder
      return this.openDownloadsFolder()
    }
    
    try {
      const result = await shell.openPath(filePath)
      if (result) {
        // openPath returns empty string on success, error message on failure
        return { success: false, error: result }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Show file in Finder/Explorer
   * @param {string} driveId 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async showInFolder(driveId) {
    if (!shell) {
      return { success: false, error: 'Shell not available (not in Electron)' }
    }
    
    const info = this.getDriveInfo(driveId)
    if (!info.success) {
      // Fallback to downloads folder
      return this.openDownloadsFolder()
    }
    
    const filePath = this._getFirstFilePath(info.drive)
    if (!filePath) {
      return this.openDownloadsFolder()
    }
    
    try {
      shell.showItemInFolder(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Open the downloads folder
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async openDownloadsFolder() {
    if (!shell) {
      return { success: false, error: 'Shell not available (not in Electron)' }
    }
    
    const downloadsPath = path.join(PEARDROP_DIR, 'downloads')
    try {
      await fs.mkdir(downloadsPath, { recursive: true })
      const result = await shell.openPath(downloadsPath)
      if (result) {
        return { success: false, error: result }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  /**
   * Get first file path from drive info
   * @private
   */
  _getFirstFilePath(drive) {
    if (!drive) return null
    
    // Try files array first
    if (drive.files?.[0]?.path) {
      return drive.files[0].path
    }
    
    // Try constructing from localPath + filename
    if (drive.localPath && drive.files?.[0]?.name) {
      return path.join(drive.localPath, drive.files[0].name)
    }
    
    // Just return localPath (for folders)
    if (drive.localPath) {
      return drive.localPath
    }
    
    return null
  }

  /**
   * Get status of all drives
   */
  getStatus() {
    const active = []
    const stopped = []
    
    for (const [driveId, session] of this.activeDrives) {
      active.push({
        driveId,
        shareLink: this._createShareLink(session.metadata.key),
        files: session.metadata.files,
        totalBytes: session.metadata.totalBytes,
        createdAt: session.metadata.createdAt,
        expiresAt: session.metadata.expiresAt,
        isReceiving: session.isReceiving || false
      })
    }
    
    for (const [driveId, metadata] of Object.entries(this.manifest.drives)) {
      if (metadata.state === DriveState.PAUSED || metadata.state === DriveState.ERRORED) {
        stopped.push({
          driveId,
          state: metadata.state,
          createdAt: metadata.createdAt,
          stoppedAt: metadata.stoppedAt,
          totalBytes: metadata.totalBytes
        })
      }
    }
    
    return {
      active,
      stopped,
      stats: this.manifest.stats
    }
  }

  /**
   * Stop all active drives
   */
  async stopAll(options = { delete: false }) {
    console.log('[HyperdriveManager] Stopping all drives')
    
    const driveIds = Array.from(this.activeDrives.keys())
    for (const driveId of driveIds) {
      await this.stopDrive(driveId, options)
    }
    
    console.log('[HyperdriveManager] All drives stopped', { count: driveIds.length })
  }

  /**
   * Cleanup all deleted drives from manifest (for maintenance)
   */
  async cleanupManifest() {
    const toRemove = []
    
    for (const [driveId, metadata] of Object.entries(this.manifest.drives)) {
      if (false) { // No more PURGED state - drives are deleted immediately
        // Verify storage is actually deleted
        try {
          await fs.access(metadata.storagePath)
          // Storage still exists, try to delete
          await fs.rm(metadata.storagePath, { recursive: true, force: true })
        } catch {
          // Storage doesn't exist or was deleted - good
        }
        toRemove.push(driveId)
      }
    }
    
    for (const driveId of toRemove) {
      delete this.manifest.drives[driveId]
    }
    
    await this._saveManifest()
    
    console.log('[HyperdriveManager] Manifest cleaned', { removed: toRemove.length })
    return toRemove.length
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  _generateDriveId() {
    return `drive_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }

  _createShareLink(key) {
    return `peardrop://${key}`
  }

  _parseShareLink(link) {
    if (!link || typeof link !== 'string') return null

    // Strip the scheme (and any surrounding whitespace), then require a valid
    // 64-char hex key for BOTH forms. Previously the peardrop:// branch returned
    // whatever followed the prefix unvalidated, which then hit Buffer.from(key,
    // 'hex') downstream and silently produced a truncated/empty key buffer.
    const raw = link.trim().replace(/^peardrop:\/\//, '')
    if (/^[a-f0-9]{64}$/i.test(raw)) {
      return raw.toLowerCase()
    }

    return null
  }

  async _loadManifest() {
    // SIMPLE, NON-DESTRUCTIVE loader (2026-07-02). Replaced the ManifestRecovery
    // system, whose "validation" could delete every drive entry if the drives
    // dir was momentarily unreadable. Rules here:
    //   1. Parse drives-state.json. If valid → use as-is. NEVER prune entries.
    //   2. Missing file → start with an empty manifest (first run).
    //   3. Corrupt file → back it up alongside, then start empty.
    //   4. NEVER touch drive folders on disk. Ever.
    const emptyManifest = () => ({
      drives: {},
      stats: { totalCreated: 0, totalPurged: 0, totalBytesShared: 0 }
    })

    try {
      const data = await fs.readFile(this.manifestPath, 'utf8')
      const manifest = JSON.parse(data)
      if (!manifest || typeof manifest.drives !== 'object' || manifest.drives === null) {
        throw new Error('Invalid manifest structure')
      }
      manifest.stats = manifest.stats || emptyManifest().stats
      this.manifest = manifest
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[HyperdriveManager] No manifest found - starting fresh')
      } else {
        const backupPath = `${this.manifestPath}.corrupted.${Date.now()}`
        try {
          await fs.copyFile(this.manifestPath, backupPath)
          console.warn('[HyperdriveManager] Manifest unreadable - backed up to', backupPath)
        } catch {
          console.warn('[HyperdriveManager] Manifest unreadable - could not back it up', error.message)
        }
      }
      this.manifest = emptyManifest()
    }

    console.log('[HyperdriveManager] Manifest loaded', {
      drives: Object.keys(this.manifest.drives).length
    })
  }

  async _saveManifest() {
    // Serialize saves through a chain so concurrent callers can't interleave
    // writes to the temp file, then resolve to the latest write.
    this._savePromise = (this._savePromise || Promise.resolve())
      .catch(() => {})
      .then(() => this._writeManifestAtomic())
    return this._savePromise
  }

  async _writeManifestAtomic() {
    // DURABILITY: write to a temp file then rename. rename() is atomic on the
    // same filesystem, so a crash mid-write can never leave a truncated
    // drives-state.json (the single source of truth) — readers see either the
    // old complete file or the new complete file, never a half-written one.
    const tmpPath = `${this.manifestPath}.tmp`
    try {
      await fs.writeFile(tmpPath, JSON.stringify(this.manifest, null, 2))
      await fs.rename(tmpPath, this.manifestPath)
    } catch (error) {
      console.error('[HyperdriveManager] Failed to save manifest', error)
      try { await fs.rm(tmpPath, { force: true }) } catch {}
    }
  }

  async _cleanupOrphanedDrives() {
    // Only cleanup drives stuck in CREATING state (incomplete creation)
    // ACTIVE drives should be resumed, not deleted
    for (const [driveId, metadata] of Object.entries(this.manifest.drives)) {
      if (metadata.state === DriveState.CREATING) {
        console.log('[HyperdriveManager] Cleaning up incomplete drive', { driveId })
        
        try {
          await fs.rm(metadata.storagePath, { recursive: true, force: true })
        } catch {
          // Ignore errors
        }
        
        // Delete incomplete drives immediately
        delete this.manifest.drives[driveId]
        this.manifest.stats.totalPurged++
      }
    }
    
    await this._saveManifest()
  }

  /**
   * Resume drives that were ACTIVE when the process last exited
   * Called during init() to restore previous sharing state
   */
  async _resumeActiveDrives() {
    const toResume = Object.entries(this.manifest.drives)
      .filter(([_, meta]) => meta.state === DriveState.ACTIVE || meta.state === DriveState.SEEKING)
    
    if (toResume.length === 0) return
    
    console.log('[HyperdriveManager] Resuming active drives', { count: toResume.length })
    
    for (const [driveId, metadata] of toResume) {
      try {
        await this._resumeDrive(driveId, metadata)
      } catch (err) {
        console.error('[HyperdriveManager] Failed to resume drive (will retry next boot)', { driveId, error: err.message })
        // DO NOT persist ERRORED here (fixed 2026-07-03). Resume failures are
        // usually transient (e.g. corestore fd still locked by a closing
        // instance); persisting ERRORED permanently demoted good drives.
        // Keep the manifest state as-is so the next boot retries, and track
        // the failure in-memory only for the UI.
        this.resumeErrors.set(driveId, { error: err.message, at: Date.now() })
        this.emit('drive-resume-failed', { driveId, error: err.message })
      }
    }
  }

  /**
   * Resume a single drive from stored metadata
   */
  async _resumeDrive(driveId, metadata) {
    console.log('[HyperdriveManager] Resuming drive', { driveId, state: metadata.state })
    
    // For 'seeking' state drives (downloads), resume peer discovery with existing drive
    if (metadata.state === DriveState.SEEKING && metadata.shareLink) {
      console.log('[HyperdriveManager] Resuming download in seeking state', { driveId })
      try {
        await this._resumeSeekingDrive(driveId, metadata)
        return
      } catch (error) {
        console.error('[HyperdriveManager] Failed to resume seeking download', { driveId, error: error.message })
        throw error
      }
    }
    
    const drivePath = metadata.storagePath
    
    // Verify storage exists
    try {
      await fs.access(drivePath)
    } catch {
      throw new Error('Storage directory missing')
    }
    
    // Re-open the corestore and drive with stored key
    const store = new Corestore(drivePath)
    await store.ready()
    
    const drive = new Hyperdrive(store, Buffer.from(metadata.key, 'hex'))
    await drive.ready()
    
    // Verify key matches
    const key = drive.key.toString('hex')
    if (key !== metadata.key) {
      await drive.close()
      await store.close()
      throw new Error('Drive key mismatch')
    }
    
    // Rejoin swarm
    const swarm = new Hyperswarm()
    
    swarm.on('connection', (socket, peerInfo) => {
      const peerId = peerInfo?.publicKey?.toString('hex')?.slice(0, 12) || 'peer'
      console.log('[HyperdriveManager] Peer connected (resumed)', { driveId, peerId })
      this.emit('peer-connected', { driveId, peerId })
      
      store.replicate(socket)
      
      socket.on('close', () => {
        console.log('[HyperdriveManager] Peer disconnected (resumed)', { driveId, peerId })
        this.emit('peer-disconnected', { driveId, peerId })
      })
      
      socket.on('error', (err) => {
        console.log('[HyperdriveManager] Socket error (resumed)', { driveId, peerId, error: err.message })
      })
    })
    
    // Join swarm for persistent peer discovery (no timeout)
    const topic = swarm.join(drive.discoveryKey)
    
    topic.flushed().then(() => {
      console.log(`[HyperdriveManager] Resumed drive announced on DHT: ${driveId} link=peardrop://${drive.key.toString('hex').slice(0, 12)}… topic=${drive.discoveryKey.toString('hex').slice(0, 12)}…`)
    })
    
    // REMOVED: swarm.flush().then(done, done) - Keep seeking peers indefinitely
    
    // Track uploads
    tracker.trackUploads(driveId, drive, metadata.totalBytes)
    
    // Create unique handlers to avoid duplicate listeners. Stored under
    // trackerHandlers (same shape as createDrive) so stopDrive removes them.
    const onTrackerProgress = (data) => {
      if (data.driveId === driveId) this.emit('upload-progress', data)
    }
    const onTrackerComplete = (data) => {
      if (data.driveId === driveId) this.emit('upload-complete', data)
    }

    tracker.on('progress', onTrackerProgress)
    tracker.on('complete', onTrackerComplete)

    // Store session
    const session = {
      driveId,
      drive,
      store,
      swarm,
      metadata,
      totalBytes: metadata.totalBytes,
      createdAt: metadata.createdAt,
      resumedAt: Date.now(),
      trackerHandlers: { onTrackerProgress, onTrackerComplete }
    }
    this.activeDrives.set(driveId, session)
    
    console.log('[HyperdriveManager] Drive resumed', { 
      driveId, 
      files: metadata.files?.length,
      totalBytes: metadata.totalBytes 
    })
  }

  /**
   * Resume a seeking drive using existing driveId and storage (no duplicates)
   */
  async _resumeSeekingDrive(driveId, metadata) {
    const key = this._parseShareLink(metadata.shareLink)
    if (!key) {
      throw new Error('Invalid share link in metadata')
    }
    
    console.log('[HyperdriveManager] Resuming seeking drive', { driveId, key: key.slice(0, 16) + '...' })
    
    // Use EXISTING storage path from metadata
    const drivePath = metadata.storagePath
    
    // Create isolated Corestore session
    const store = new Corestore(drivePath)
    await store.ready()
    
    // Open the remote drive by key
    const drive = new Hyperdrive(store, Buffer.from(key, 'hex'))
    await drive.ready()
    
    // Join swarm to find peers
    const swarm = new Hyperswarm()
    
    console.log('[HyperdriveManager] Joining swarm to find sender...', { 
      driveId, 
      discoveryKey: drive.discoveryKey.toString('hex').slice(0, 16) + '...'
    })
    
    let peerConnected = false
    swarm.on('connection', (socket) => {
      peerConnected = true
      console.log('[HyperdriveManager] Connected to peer for download', { driveId })
      store.replicate(socket)
      
      socket.on('error', (err) => {
        console.log('[HyperdriveManager] Download socket error', { driveId, error: err.message })
      })
      
      socket.on('close', () => {
        console.log('[HyperdriveManager] Download peer disconnected', { driveId })
        this.emit('download-peer-disconnected', { driveId })
      })
    })
    
    // Join swarm for persistent peer discovery (no timeout)
    const topic = swarm.join(drive.discoveryKey)
    
    // Log DHT lookup progress
    topic.flushed().then(() => {
      console.log('[HyperdriveManager] DHT lookup complete', { driveId, peerConnected })
    })
    
    await swarm.flush()
    console.log('[HyperdriveManager] Swarm flushed, waiting for drive update...', { driveId, peerConnected })
    
    // Track this pending connection so it can be aborted
    const pendingConnection = {
      driveId,
      aborted: false,
      cleanup: async () => {
        try {
          await swarm.destroy()
          await drive.close()
          await store.close()
          // NOTE: Don't delete storage path on cleanup - this is a resume, not new download
        } catch (err) {
          console.log('[HyperdriveManager] Cleanup error (ignored)', err.message)
        }
      }
    }
    this.pendingConnections.set(driveId, pendingConnection)
    
    // Wait for drive to update - NO TIMEOUT, only user cancellation
    const REFRESH_INTERVAL_MS = 30000 // Log every 30 seconds
    const updatePromise = drive.update({ wait: true })
    
    const abortPromise = new Promise((_, reject) => {
      const checkAbort = setInterval(() => {
        if (pendingConnection.aborted) {
          clearInterval(checkAbort)
          reject(new EngineError({
            category: 'receive.cancelled',
            cause: 'open-cancelled',
            message: 'Connection cancelled by user',
          }))
        }
      }, 100)
      pendingConnection.abortCheck = checkAbort
    })
    
    // Periodic refresh/status logging
    const refreshInterval = setInterval(() => {
      if (!pendingConnection.aborted) {
        console.log('[HyperdriveManager] Still searching for peers...', { driveId, peerConnected })
        this.emit('connection-status', { driveId, status: 'searching', peerConnected })
      }
    }, REFRESH_INTERVAL_MS)
    pendingConnection.refreshInterval = refreshInterval
    
    try {
      await Promise.race([updatePromise, abortPromise])
      // Clear intervals on success
      if (pendingConnection.abortCheck) clearInterval(pendingConnection.abortCheck)
      if (pendingConnection.refreshInterval) clearInterval(pendingConnection.refreshInterval)
    } catch (err) {
      // Clear intervals on error/abort
      if (pendingConnection.abortCheck) clearInterval(pendingConnection.abortCheck)
      if (pendingConnection.refreshInterval) clearInterval(pendingConnection.refreshInterval)
      this.pendingConnections.delete(driveId)
      
      // Clean up on abort
      if (pendingConnection.cleanup) {
        await pendingConnection.cleanup()
      }
      
      throw err
    }
    
    // If we get here, drive.update() succeeded (peer connected and drive synced)
    this.pendingConnections.delete(driveId)
    
    // Read manifest to get file list
    let manifest = null
    let files = []
    let shareName = 'Remote Share'
    let totalBytes = 0
    let truncated = null

    try {
      const manifestBuffer = await drive.get(DRIVE_MANIFEST_PATH)
      // Cap the size before parsing — the manifest comes from a remote peer and
      // an oversized blob could OOM the JSON parse on this resume path (openDrive
      // already enforces the same limit).
      if (manifestBuffer && manifestBuffer.length > 0 && manifestBuffer.length <= DRIVE_MANIFEST_MAX_SIZE) {
        manifest = JSON.parse(manifestBuffer.toString())
        const declaredCount = Array.isArray(manifest.files) ? manifest.files.length : 0
        truncated = computeTruncation(declaredCount, DRIVE_MANIFEST_MAX_FILES)
        files = (manifest.files || []).slice(0, DRIVE_MANIFEST_MAX_FILES)
        shareName = manifest.name || files[0]?.name || 'Remote Share'
        totalBytes = manifest.totalBytes || files.reduce((sum, f) => sum + (f.size || 0), 0)
      } else if (manifestBuffer && manifestBuffer.length > DRIVE_MANIFEST_MAX_SIZE) {
        throw new EngineError({
          category: 'receive.manifest-oversized',
          cause: 'manifest-oversized',
          message: 'manifest exceeds size limit',
        })
      }
    } catch (err) {
      console.log('[HyperdriveManager] No manifest found, scanning drive...', { driveId })
      // Fallback: scan drive for files
      for await (const entry of drive.list('/')) {
        if (entry.key !== '/.peardrop.json') {
          try {
            const stat = await drive.stat(entry.key)
            files.push({
              name: path.basename(entry.key),
              path: entry.key,
              size: stat.blob.byteLength
            })
            totalBytes += stat.blob.byteLength
          } catch {}
        }
      }
      if (files.length > 0) {
        shareName = files.length === 1 ? files[0].name : `${files.length} files`
      }
    }
    
    // Create session object
    const session = {
      driveId,
      drive,
      store,
      swarm,
      isReceiving: true,
      manifest,
      totalBytes,
      shareName,
      shareLink: metadata.shareLink,
      metadata: { key },
      createdAt: metadata.createdAt || Date.now()
    }
    this.activeDrives.set(driveId, session)
    
    // Update the existing drive entry with real data now that we have successful connection
    console.log('[HyperdriveManager] Checking if should emit download event', { driveId, peerConnected })
    if (peerConnected) {
      await this.addDriveEntry({
        driveId: driveId, // Use EXISTING driveId, not new one
        key: drive.key.toString('hex'),
        discoveryKey: drive.discoveryKey.toString('hex'),
        state: 'seeking', // Stay seeking until download completes
        shareLink: metadata.shareLink,
        isUpload: false,
        files: files,
        totalBytes: totalBytes,
        storagePath: metadata.storagePath, // Use EXISTING storage path
        createdAt: metadata.createdAt || Date.now(),
        name: shareName,
        lastAttempt: Date.now()
      })
      
      // Emit event to trigger download just like new downloads do
      console.log('[HyperdriveManager] Emitting drive-ready-to-download event', { driveId, shareLink: metadata.shareLink })
      this.emit('drive-ready-to-download', {
        driveId,
        shareLink: metadata.shareLink,
        shareName,
        totalBytes,
        files
      })
    } else {
      console.log('[HyperdriveManager] No peer connected, not emitting download event', { driveId })
    }
    
    console.log('[HyperdriveManager] Remote drive resumed', { 
      driveId, 
      files: files.length,
      totalBytes,
      hasManifest: !!manifest,
      peerConnected
    })
    
    return {
      driveId,
      files,
      shareName,
      totalBytes,
      hasManifest: !!manifest,
      peerConnected,
      truncated
    }
  }
}

// Export singleton instance and class
const manager = new HyperdriveManager()

module.exports = {
  HyperdriveManager,
  manager,
  DriveState
}
