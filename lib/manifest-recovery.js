/**
 * MODULE: manifest-recovery.js
 * PURPOSE: Robust drives-state.json recovery and validation system
 * VERSION: 0.19.0
 * 
 * EXPORTS:
 *   - ManifestRecovery(manifestPath, drivesDir) - Recovery manager
 *     - loadWithRecovery() - Load manifest with automatic recovery
 *     - validateAndSync() - Validate manifest against drive folders
 *     - rebuildFromDrives() - Rebuild from drive folder scanning
 *     - recoverPartial() - Attempt partial recovery from corrupted data
 *     - scanDriveFolder(driveId) - Extract metadata from single drive
 *     - cleanupOrphans() - Remove orphaned drives/manifest entries
 * 
 * EXTERNAL CALLS:
 *   - Node.js fs/promises
 *   - Corestore, Hyperdrive (for drive scanning)
 *   - path module
 * 
 * PHILOSOPHY:
 *   - Isolated recovery logic (don't contaminate hyperdrive-manager)
 *   - Fail gracefully - prefer partial recovery over total loss
 *   - Always sync drives folder ↔ manifest consistency
 *   - Backup corrupted data before overwriting
 */

const fs = require('fs').promises
const path = require('path')

class ManifestRecovery {
  constructor(manifestPath, drivesDir) {
    this.manifestPath = manifestPath
    this.drivesDir = drivesDir
    this.defaultManifest = {
      drives: {},
      stats: {
        totalCreated: 0,
        totalPurged: 0,
        totalBytesShared: 0
      }
    }
  }

  /**
   * Main entry point - load manifest with full recovery capability
   */
  async loadWithRecovery() {
    try {
      // Try normal load first
      const data = await fs.readFile(this.manifestPath, 'utf8')
      const manifest = JSON.parse(data)
      
      // Validate structure
      if (!manifest.drives || !manifest.stats) {
        throw new Error('Invalid manifest structure')
      }
      
      // Validate and sync with drive folders
      return await this.validateAndSync(manifest)
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('[ManifestRecovery] No manifest found, rebuilding from drives...')
        return await this.rebuildFromDrives()
      } else {
        console.warn('[ManifestRecovery] Manifest corrupted, attempting recovery...', error.message)
        return await this.recoverPartial()
      }
    }
  }

  /**
   * Validate manifest against actual drive folders and sync them
   */
  async validateAndSync(manifest) {
    let manifestChanged = false
    const manifestDrives = Object.keys(manifest.drives)
    const driveFolders = []
    
    try {
      const entries = await fs.readdir(this.drivesDir, { withFileTypes: true })
      driveFolders.push(...entries.filter(e => e.isDirectory()).map(e => e.name))
    } catch {
      // If drives dir doesn't exist, we'll have empty driveFolders
    }

    console.log('[ManifestRecovery] Validating manifest against drives folder', {
      manifestDrives: manifestDrives.length,
      driveFolders: driveFolders.length
    })

    // SPECIAL CASE: Empty manifest but drives exist = rebuild scenario
    if (manifestDrives.length === 0 && driveFolders.length > 0) {
      console.log('[ManifestRecovery] Empty manifest with existing drives detected - rebuilding...')
      return await this.rebuildFromDrives()
    }

    // Remove manifest entries for missing drive folders
    for (const driveId of manifestDrives) {
      if (!driveFolders.includes(driveId)) {
        console.log('[ManifestRecovery] Removing manifest entry for missing drive folder', { driveId })
        delete manifest.drives[driveId]
        manifestChanged = true
      }
    }

    // Save updated manifest if changed
    if (manifestChanged) {
      await this.saveManifest(manifest)
      console.log('[ManifestRecovery] Manifest updated after validation')
    }

    return manifest
  }

  /**
   * Rebuild manifest completely from drive folders
   */
  async rebuildFromDrives() {
    console.log('[ManifestRecovery] Rebuilding manifest from drive folders...')
    
    // Start with clean manifest
    const manifest = { ...this.defaultManifest }

    try {
      const entries = await fs.readdir(this.drivesDir, { withFileTypes: true })
      const driveFolders = entries.filter(e => e.isDirectory()).map(e => e.name)
      
      console.log('[ManifestRecovery] Found drive folders to scan', { count: driveFolders.length })

      for (const driveId of driveFolders) {
        try {
          const metadata = await this.scanDriveFolder(driveId)
          if (metadata) {
            manifest.drives[driveId] = metadata
            manifest.stats.totalCreated++
            manifest.stats.totalBytesShared += metadata.totalBytes || 0
            console.log('[ManifestRecovery] Recovered drive', { 
              driveId, 
              name: metadata.name, 
              files: metadata.files?.length 
            })
          }
        } catch (error) {
          console.warn('[ManifestRecovery] Failed to scan drive folder', { driveId, error: error.message })
          // Remove invalid drive folder
          await this.removeCorruptedDrive(driveId)
        }
      }

      await this.saveManifest(manifest)
      console.log('[ManifestRecovery] Manifest rebuilt', { 
        drives: Object.keys(manifest.drives).length 
      })

      return manifest

    } catch (error) {
      console.error('[ManifestRecovery] Failed to rebuild manifest', error)
      // Fall back to empty manifest if everything fails
      return this.defaultManifest
    }
  }

  /**
   * Attempt to recover a corrupted manifest by parsing what we can
   */
  async recoverPartial() {
    console.log('[ManifestRecovery] Attempting partial manifest recovery...')
    
    try {
      // Backup corrupted file first
      const corruptedData = await fs.readFile(this.manifestPath, 'utf8')
      const backupPath = this.manifestPath + '.corrupted.' + Date.now()
      await fs.writeFile(backupPath, corruptedData)
      console.log('[ManifestRecovery] Backed up corrupted manifest', { backupPath })
      
      // Look for recoverable drive entries using regex
      const driveMatches = corruptedData.match(/"(drive_[^"]+|recv_[^"]+)": \{[^}]+\}/g) || []
      
      console.log('[ManifestRecovery] Found potentially recoverable entries', { count: driveMatches.length })
      
      // If we found some entries, try to parse them individually
      if (driveMatches.length > 0) {
        const manifest = { ...this.defaultManifest }
        let recoveredCount = 0
        
        for (const match of driveMatches) {
          try {
            // Try to parse individual drive entry
            const entryJson = `{${match}}`
            const entry = JSON.parse(entryJson)
            const driveId = Object.keys(entry)[0]
            
            // Validate the entry has required fields
            if (entry[driveId].key && entry[driveId].state) {
              manifest.drives[driveId] = entry[driveId]
              recoveredCount++
            }
          } catch {
            // Skip corrupted entries
          }
        }
        
        if (recoveredCount > 0) {
          console.log('[ManifestRecovery] Recovered entries from corruption', { recoveredCount })
          await this.saveManifest(manifest)
          return await this.validateAndSync(manifest)
        }
      }
      
    } catch (error) {
      console.warn('[ManifestRecovery] Partial recovery failed', error.message)
    }

    // Fall back to rebuilding from drives
    console.log('[ManifestRecovery] Falling back to rebuild from drives...')
    return await this.rebuildFromDrives()
  }

  /**
   * Scan a single drive folder and extract metadata
   */
  async scanDriveFolder(driveId) {
    const drivePath = path.join(this.drivesDir, driveId)
    
    try {
      // Verify it's a valid corestore directory
      const corestoreFile = path.join(drivePath, 'CORESTORE')
      await fs.access(corestoreFile)
    } catch {
      throw new Error('Not a valid corestore directory')
    }

    const Corestore = require('corestore')
    const Hyperdrive = require('hyperdrive')
    
    const store = new Corestore(drivePath)
    let drive, metadata
    
    try {
      await store.ready()
      drive = new Hyperdrive(store)
      await drive.ready()

      const key = drive.key.toString('hex')
      const discoveryKey = drive.discoveryKey.toString('hex')
      
      // Try to read manifest
      let manifestData = null
      try {
        const manifestBuffer = await drive.get('/.peardrop.json')
        if (manifestBuffer) {
          manifestData = JSON.parse(manifestBuffer.toString())
        }
      } catch {
        // No manifest or corrupted
      }

      // Determine if this is upload or download drive
      const isUpload = driveId.startsWith('drive_')
      const isDownload = driveId.startsWith('recv_')
      
      // Build metadata structure
      metadata = {
        driveId: driveId,
        key: key,
        discoveryKey: discoveryKey,
        state: isUpload ? 'active' : 'paused', // Uploads resume sharing, downloads stay paused
        files: manifestData?.files || [],
        totalBytes: manifestData?.totalBytes || 0,
        localPath: null, // Will be set for uploads if we can determine it
        storagePath: drivePath,
        name: manifestData?.name || (isDownload ? 'Recovered download' : 'Recovered share'),
        shareLink: `peardrop://${key}`,
        createdAt: manifestData?.created || Date.now(),
        isUpload: isUpload,
        stats: {
          uploaded: 0,
          downloaded: 0,
          peers: 0
        }
      }

      return metadata

    } finally {
      if (drive) await drive.close()
      if (store) await store.close()
    }
  }

  /**
   * Clean up orphaned drives and manifest entries
   */
  async cleanupOrphans(manifest) {
    let cleaned = false
    
    try {
      const entries = await fs.readdir(this.drivesDir, { withFileTypes: true })
      const driveFolders = entries.filter(e => e.isDirectory()).map(e => e.name)
      const manifestDrives = Object.keys(manifest.drives)
      
      // Remove drive folders not in manifest
      for (const driveId of driveFolders) {
        if (!manifestDrives.includes(driveId)) {
          console.log('[ManifestRecovery] Removing orphaned drive folder', { driveId })
          await this.removeCorruptedDrive(driveId)
          cleaned = true
        }
      }
      
      // Remove manifest entries for missing drive folders
      for (const driveId of manifestDrives) {
        if (!driveFolders.includes(driveId)) {
          console.log('[ManifestRecovery] Removing orphaned manifest entry', { driveId })
          delete manifest.drives[driveId]
          cleaned = true
        }
      }
      
      if (cleaned) {
        await this.saveManifest(manifest)
        console.log('[ManifestRecovery] Orphan cleanup completed')
      }
      
    } catch (error) {
      console.warn('[ManifestRecovery] Orphan cleanup failed', error.message)
    }
    
    return manifest
  }

  /**
   * Remove a corrupted drive folder
   */
  async removeCorruptedDrive(driveId) {
    try {
      const drivePath = path.join(this.drivesDir, driveId)
      await fs.rm(drivePath, { recursive: true, force: true })
      console.log('[ManifestRecovery] Removed corrupted drive folder', { driveId })
    } catch (error) {
      console.warn('[ManifestRecovery] Failed to remove drive folder', { driveId, error: error.message })
    }
  }

  /**
   * Save manifest to disk
   */
  async saveManifest(manifest) {
    try {
      await fs.writeFile(
        this.manifestPath,
        JSON.stringify(manifest, null, 2)
      )
    } catch (error) {
      console.error('[ManifestRecovery] Failed to save manifest', error)
      throw error
    }
  }
}

module.exports = ManifestRecovery