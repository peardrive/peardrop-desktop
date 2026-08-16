/**
 * MODULE: lib/hyperdrive-manager.js
 * PURPOSE: Manages Hyperdrive lifecycle for P2P file sharing
 * 
 * EXPORTS:
 *   - HyperdriveManager (class) - Main manager class
 *   - manager (instance) - Singleton for app-wide use
 *   - DriveState (enum) - CREATING, ACTIVE, SEEDING, STOPPED, PURGED
 * 
 * FUNCTIONS:
 *   Core:
 *     - init() - Load manifest, ensure directories, cleanup incomplete, resume active
 *     - createDrive(files, options) - Create share with manifest, join swarm
 *     - openDrive(shareLink) - Connect to remote drive, read manifest
 *     - stopDrive(driveId, options) - Leave swarm, close drive, purge storage
 *     - stopAll(options) - Stop all active drives
 *     - getStatus() - Return active/stopped drives and stats
 *     - cleanupManifest() - Remove purged entries from manifest
 *   
 *   Resume (called by init):
 *     - _resumeActiveDrives() - Resume all ACTIVE drives from manifest
 *     - _resumeDrive(driveId, metadata) - Resume single drive, rejoin swarm
 *   
 *   File Operations (for UI):
 *     - setDownloadedFiles(driveId, files, destDir) - Store downloaded file paths
 *     - getDriveInfo(driveId) - Get drive metadata and file paths
 *     - openFile(driveId) - Open first file in default app
 *     - showInFolder(driveId) - Show file in Finder/Explorer
 *     - openDownloadsFolder() - Open ~/peardrop/downloads
 * 
 * EVENTS EMITTED:
 *   - 'peer-connected' - { driveId, peerId }
 *   - 'peer-disconnected' - { driveId, peerId }
 *   - 'upload-progress' - { driveId, peerId, percent, bytesTransferred... }
 *   - 'upload-complete' - { driveId, peerId, totalBytes, duration }
 *   - 'drive-created' - { driveId, shareLink, metadata }
 *   - 'drive-stopped' - { driveId, purged }
 * 
 * EXTERNAL CALLS:
 *   - Corestore, Hyperdrive, Hyperswarm (holepunch P2P stack)
 *   - ./progress-tracker.js (tracker singleton)
 * 
 * KEY STATE:
 *   - activeDrives (Map) - driveId -> { drive, store, swarm, metadata }
 *   - manifest (Object) - Persistent tracking: drives{}, stats{}
 * 
 * KEY CONSTANTS:
 *   - DRIVE_MANIFEST_PATH - '/.peardrop.json' (in-drive metadata)
 *   - DRIVES_MANIFEST_FILE - ~/peardrop/drives-manifest.json (local tracking)
 *   - PEARDROP_DIR - ~/peardrop
 *   - DRIVES_DIR - ~/peardrop/drives
 */

const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Hyperswarm = require('hyperswarm')
const fs = require('fs').promises
const path = require('path')
const os = require('os')
const { EventEmitter } = require('events')
const { tracker } = require('./progress-tracker')

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
const DRIVES_MANIFEST_FILE = path.join(PEARDROP_DIR, 'drives-manifest.json')

/**
 * Drive states for tracking lifecycle
 */
const DriveState = {
  CREATING: 'creating',
  ACTIVE: 'active',      // Being shared
  SEEDING: 'seeding',    // Available for download
  STOPPED: 'stopped',    // No longer sharing
  PURGED: 'purged'       // Data deleted
}

/**
 * HyperdriveManager - Manages ephemeral file sharing drives
 */
class HyperdriveManager extends EventEmitter {
  constructor(options = {}) {
    super()
    
    this.drivesDir = options.drivesDir || DRIVES_DIR
    this.manifestPath = options.manifestPath || DRIVES_MANIFEST_FILE
    
    // Active drives: Map<driveId, DriveSession>
    this.activeDrives = new Map()
    
    // Pending connections that can be aborted: Map<driveId, AbortController-like>
    this.pendingConnections = new Map()
    
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
    console.log('[HyperdriveManager] Initialized', {
      activeDrives: this.activeDrives.size,
      totalTracked: Object.keys(this.manifest.drives).length
    })
  }

  /**
   * Create a new drive for sharing files
   * 
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
        const fileData = await fs.readFile(file.path)
        const fileName = file.name || path.basename(file.path)
        // Use relativePath if provided (for folder structure), otherwise just the filename
        const storagePath = file.relativePath || fileName
        
        await drive.put(`/${storagePath}`, fileData)
        
        totalBytes += fileData.length
        fileEntries.push({
          name: fileName,
          storagePath: storagePath,
          size: fileData.length,
          addedAt: Date.now()
        })
        
        console.log('[HyperdriveManager] Added file', { storagePath, size: fileData.length })
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
      
      // Log when we're announced on the DHT
      topic.flushed().then(() => {
        console.log('[HyperdriveManager] Announced on DHT', { 
          driveId, 
          discoveryKey: drive.discoveryKey.toString('hex').slice(0, 16) + '...'
        })
      })
      
      swarm.flush().then(done, done)
      
      // Start tracking upload progress
      tracker.trackUploads(driveId, drive, totalBytes)
      
      // Forward progress events
      tracker.on('progress', (data) => {
        if (data.driveId === driveId) {
          this.emit('upload-progress', data)
        }
      })
      
      tracker.on('complete', (data) => {
        if (data.driveId === driveId) {
          this.emit('upload-complete', data)
        }
      })
      
      // Store session info
      const session = {
        driveId,
        drive,
        store,
        swarm,
        metadata,
        totalBytes,
        createdAt: Date.now()
      }
      this.activeDrives.set(driveId, session)
      
      // Set up TTL expiration if specified
      if (options.ttlMs > 0) {
        session.expirationTimer = setTimeout(() => {
          console.log('[HyperdriveManager] Drive expired', { driveId })
          this.stopDrive(driveId, { purge: true })
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
      metadata.state = DriveState.STOPPED
      metadata.error = error.message
      await this._saveManifest()
      
      await drive.close()
      await store.close()
      
      throw error
    }
  }

  /**
   * Stop sharing a drive
   * 
   * @param {string} driveId - Drive ID to stop
   * @param {Object} options
   * @param {boolean} options.purge - Whether to delete all data (default: true)
   */
  async stopDrive(driveId, options = { purge: true }) {
    const session = this.activeDrives.get(driveId)
    
    if (!session) {
      console.warn('[HyperdriveManager] Drive not active', { driveId })
      return
    }
    
    console.log('[HyperdriveManager] Stopping drive', { driveId, purge: options.purge })
    
    // Clear expiration timer
    if (session.expirationTimer) {
      clearTimeout(session.expirationTimer)
    }
    
    // Stop progress tracking
    tracker.stopTracking(driveId)
    
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
    
    // Delete storage directory if purging (manual cleanup - more reliable than drive.purge())
    if (options.purge && session.metadata?.storagePath) {
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
      metadata.state = options.purge ? DriveState.PURGED : DriveState.STOPPED
      metadata.stoppedAt = Date.now()
      if (options.purge) {
        this.manifest.stats.totalPurged++
      }
      await this._saveManifest()
    }
    
    // Remove from active drives
    this.activeDrives.delete(driveId)
    
    this.emit('drive-stopped', { driveId, purged: options.purge })
    
    console.log('[HyperdriveManager] Drive fully stopped', { driveId })
  }

  /**
   * Open a drive for downloading (receiving files)
   * 
   * @param {string} shareLink - peardrop:// link
   * @returns {Promise<{driveId: string, files: Array, download: Function}>}
   */
  async openDrive(shareLink) {
    if (!this.initialized) await this.init()
    
    const key = this._parseShareLink(shareLink)
    if (!key) {
      throw new Error('Invalid share link')
    }
    
    const driveId = `recv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const drivePath = path.join(this.drivesDir, driveId)
    
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
    
    const done = drive.findingPeers()
    const topic = swarm.join(drive.discoveryKey)
    
    // Log DHT lookup progress
    topic.flushed().then(() => {
      console.log('[HyperdriveManager] DHT lookup complete', { driveId, peerConnected })
    })
    
    await swarm.flush()
    done()
    
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
          reject(new Error('Connection cancelled by user'))
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
    
    if (!peerConnected) {
      console.warn('[HyperdriveManager] Drive updated but no peer connection logged - may be stale data')
    }
    
    // Try to read PearDrop manifest first (fast, has all metadata)
    let files = []
    let manifest = null
    let totalBytes = 0
    let shareName = null
    
    try {
      const manifestData = await drive.get(DRIVE_MANIFEST_PATH)
      if (manifestData && manifestData.length <= DRIVE_MANIFEST_MAX_SIZE) {
        manifest = JSON.parse(manifestData.toString())
        
        // Validate manifest
        if (manifest.version === DRIVE_MANIFEST_VERSION && Array.isArray(manifest.files)) {
          shareName = manifest.name
          totalBytes = manifest.totalBytes || 0
          
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
    
    // Fallback: list files from drive directly
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
      
      /**
       * Download all files to a directory
       * If shareName exists (folder share), creates a subfolder with that name
       * Preserves full directory structure from the original share
       */
      downloadAll: async (destDir) => {
        await fs.mkdir(destDir, { recursive: true })
        
        // Determine the root folder for this download
        // For folder shares: destDir/shareName/
        // For single files: destDir/
        console.log('[HyperdriveManager] downloadAll starting', { 
          destDir, 
          shareName, 
          fileCount: files.length,
          manifestName: manifest?.name 
        })
        
        const isFolderShare = files.length > 1 || (shareName && !shareName.includes('.'))
        const downloadRoot = isFolderShare && shareName 
          ? path.join(destDir, shareName)
          : destDir
        
        console.log('[HyperdriveManager] Download root calculated', { 
          isFolderShare, 
          downloadRoot 
        })
        
        await fs.mkdir(downloadRoot, { recursive: true })
        
        for (const file of files) {
          const data = await drive.get(file.name)
          if (data) {
            // file.name is like "/lib/foo.js" - preserve the structure
            // Remove leading slash and join with download root
            const relativePath = file.name.replace(/^\/+/, '')
            const destPath = path.join(downloadRoot, relativePath)
            
            // Ensure parent directories exist
            const parentDir = path.dirname(destPath)
            await fs.mkdir(parentDir, { recursive: true })
            
            await fs.writeFile(destPath, data)
            console.log('[HyperdriveManager] Downloaded file', { name: file.name, destPath })
          }
        }
        
        console.log('[HyperdriveManager] Download complete', { 
          downloadRoot, 
          fileCount: files.length,
          isFolderShare 
        })
        return downloadRoot
      },
      
      /**
       * Download a specific file
       */
      downloadFile: async (fileName, destPath) => {
        const data = await drive.get(fileName)
        if (!data) throw new Error(`File not found: ${fileName}`)
        
        await fs.writeFile(destPath, data)
        return destPath
      },
      
      /**
       * Close this receiving session and cleanup
       */
      close: async () => {
        await this.stopDrive(driveId, { purge: true })
      }
    }
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
      if (metadata.state === DriveState.STOPPED || metadata.state === DriveState.PURGED) {
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
  async stopAll(options = { purge: true }) {
    console.log('[HyperdriveManager] Stopping all drives')
    
    const driveIds = Array.from(this.activeDrives.keys())
    for (const driveId of driveIds) {
      await this.stopDrive(driveId, options)
    }
    
    console.log('[HyperdriveManager] All drives stopped', { count: driveIds.length })
  }

  /**
   * Cleanup all purged drives from manifest (for maintenance)
   */
  async cleanupManifest() {
    const toRemove = []
    
    for (const [driveId, metadata] of Object.entries(this.manifest.drives)) {
      if (metadata.state === DriveState.PURGED) {
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
    
    if (link.startsWith('peardrop://')) {
      return link.replace('peardrop://', '')
    }
    
    // Maybe it's just a raw key
    if (/^[a-f0-9]{64}$/i.test(link)) {
      return link
    }
    
    return null
  }

  async _loadManifest() {
    try {
      const data = await fs.readFile(this.manifestPath, 'utf8')
      this.manifest = JSON.parse(data)
      console.log('[HyperdriveManager] Manifest loaded', {
        drives: Object.keys(this.manifest.drives).length
      })
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('[HyperdriveManager] Failed to load manifest', error)
      }
      // Use default manifest
    }
  }

  async _saveManifest() {
    try {
      await fs.writeFile(
        this.manifestPath,
        JSON.stringify(this.manifest, null, 2)
      )
    } catch (error) {
      console.error('[HyperdriveManager] Failed to save manifest', error)
    }
  }

  async _cleanupOrphanedDrives() {
    // Only cleanup drives stuck in CREATING state (incomplete creation)
    // ACTIVE drives should be resumed, not purged
    for (const [driveId, metadata] of Object.entries(this.manifest.drives)) {
      if (metadata.state === DriveState.CREATING) {
        console.log('[HyperdriveManager] Cleaning up incomplete drive', { driveId })
        
        try {
          await fs.rm(metadata.storagePath, { recursive: true, force: true })
        } catch {
          // Ignore errors
        }
        
        metadata.state = DriveState.PURGED
        metadata.stoppedAt = Date.now()
        metadata.error = 'Incomplete on startup'
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
      .filter(([_, meta]) => meta.state === DriveState.ACTIVE)
    
    if (toResume.length === 0) return
    
    console.log('[HyperdriveManager] Resuming active drives', { count: toResume.length })
    
    for (const [driveId, metadata] of toResume) {
      try {
        await this._resumeDrive(driveId, metadata)
      } catch (err) {
        console.error('[HyperdriveManager] Failed to resume drive', { driveId, error: err.message })
        // Mark as stopped but don't purge - user can retry or clear manually
        metadata.state = DriveState.STOPPED
        metadata.stoppedAt = Date.now()
        metadata.error = `Resume failed: ${err.message}`
      }
    }
    
    await this._saveManifest()
  }

  /**
   * Resume a single drive from stored metadata
   */
  async _resumeDrive(driveId, metadata) {
    console.log('[HyperdriveManager] Resuming drive', { driveId })
    
    const drivePath = metadata.storagePath
    
    // Verify storage exists
    try {
      await fs.access(drivePath)
    } catch {
      throw new Error('Storage directory missing')
    }
    
    // Re-open the corestore and drive
    const store = new Corestore(drivePath)
    await store.ready()
    
    const drive = new Hyperdrive(store)
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
    
    const done = drive.findingPeers()
    const topic = swarm.join(drive.discoveryKey)
    
    topic.flushed().then(() => {
      console.log('[HyperdriveManager] Resumed drive announced on DHT', { 
        driveId, 
        discoveryKey: drive.discoveryKey.toString('hex').slice(0, 16) + '...'
      })
    })
    
    swarm.flush().then(done, done)
    
    // Track uploads
    tracker.trackUploads(driveId, drive, metadata.totalBytes)
    
    tracker.on('progress', (data) => {
      if (data.driveId === driveId) {
        this.emit('upload-progress', data)
      }
    })
    
    tracker.on('complete', (data) => {
      if (data.driveId === driveId) {
        this.emit('upload-complete', data)
      }
    })
    
    // Store session
    const session = {
      driveId,
      drive,
      store,
      swarm,
      metadata,
      totalBytes: metadata.totalBytes,
      createdAt: metadata.createdAt,
      resumedAt: Date.now()
    }
    this.activeDrives.set(driveId, session)
    
    console.log('[HyperdriveManager] Drive resumed', { 
      driveId, 
      files: metadata.files?.length,
      totalBytes: metadata.totalBytes 
    })
  }
}

// Export singleton instance and class
const manager = new HyperdriveManager()

module.exports = {
  HyperdriveManager,
  manager,
  DriveState
}
