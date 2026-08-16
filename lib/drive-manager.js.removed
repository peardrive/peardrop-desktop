/**
 * MODULE: drive-manager.js
 * PURPOSE: Single source of truth for all PearDrop drives (uploads & downloads)
 * 
 * EXPORTS:
 *   - DriveManager class
 *   - manager (singleton instance)
 * 
 * FUNCTIONS:
 *   Core:
 *     - init() - Load state from disk, reconcile with actual storage
 *     - add(drive) - Add a new drive entry
 *     - remove(id, opts) - Remove drive, optionally delete files
 *     - update(id, updates) - Update drive properties
 *   
 *   State Control:
 *     - pause(id) - Stop seeding but keep drive available
 *     - resume(id) - Start seeding again
 *   
 *   Queries:
 *     - get(id) - Get single drive by ID
 *     - getAll() - Get all drives
 *     - getActive() - Get currently seeding drives
 *     - getByKey(key) - Find drive by hyperdrive key (for dedup)
 * 
 * EVENTS:
 *   - 'added' (entry) - New drive added
 *   - 'removed' (id) - Drive removed
 *   - 'updated' (entry) - Drive updated
 * 
 * DATA FILE: ~/peardrop/drives.json
 * 
 * DRIVE ENTRY SCHEMA:
 *   {
 *     id: string,           // Unique ID (drive_xxx or recv_xxx)
 *     key: string,          // Hyperdrive public key (hex, 64 chars)
 *     shareLink: string,    // peardrop://xxx
 *     name: string,         // Display name
 *     files: [{name, size, path?}],
 *     totalBytes: number,
 *     createdAt: string,    // ISO timestamp
 *     localPath: string,    // Download destination (for received files)
 *     storagePath: string,  // Hyperdrive corestore location
 *     state: 'active'|'paused'|'local',
 *     isUpload: boolean,    // true = we shared, false = we downloaded
 *     stats: { uploaded, downloaded, peers }
 *   }
 * 
 * EXTERNAL CALLS:
 *   - fs.readFile, fs.writeFile, fs.mkdir, fs.rm, fs.access
 *   - EventEmitter
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

// Paths
const PEARDROP_DIR = path.join(os.homedir(), 'peardrop');
const DRIVES_FILE = path.join(PEARDROP_DIR, 'drives.json');
const DRIVES_STORAGE_DIR = path.join(PEARDROP_DIR, 'drives');

// Drive states
const DriveState = {
  ACTIVE: 'active',   // Currently seeding/available on network
  PAUSED: 'paused',   // Not seeding, but drive data exists (can resume)
  LOCAL: 'local'      // Only local files exist, no hyperdrive data
};

class DriveManager extends EventEmitter {
  constructor() {
    super();
    this.drives = new Map();
    this.initialized = false;
    this.drivesDir = DRIVES_STORAGE_DIR;
  }

  /**
   * Initialize: load from disk, reconcile with actual storage
   */
  async init() {
    if (this.initialized) return;

    // Ensure directories exist
    await fs.mkdir(PEARDROP_DIR, { recursive: true });
    await fs.mkdir(DRIVES_STORAGE_DIR, { recursive: true });

    // Load existing data
    try {
      const data = await fs.readFile(DRIVES_FILE, 'utf8');
      const parsed = JSON.parse(data);
      
      if (parsed.drives && Array.isArray(parsed.drives)) {
        for (const drive of parsed.drives) {
          this.drives.set(drive.id, drive);
        }
      }
      
      console.log('[DriveManager] Loaded', { count: this.drives.size });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('[DriveManager] Error loading drives.json:', err.message);
      }
      console.log('[DriveManager] Starting fresh');
    }

    // Reconcile: check that storage exists for each drive
    await this._reconcile();

    this.initialized = true;
  }

  /**
   * Reconcile drives list with actual storage on disk
   */
  async _reconcile() {
    let removed = 0;
    let fixed = 0;

    for (const [id, drive] of this.drives) {
      if (drive.state === DriveState.LOCAL) continue; // No storage expected
      
      // Check if storage directory exists
      const storageExists = await this._pathExists(drive.storagePath);
      
      if (!storageExists && drive.state === DriveState.ACTIVE) {
        // Storage missing but marked active - fix state
        drive.state = DriveState.LOCAL;
        fixed++;
      }
    }

    if (fixed > 0) {
      console.log('[DriveManager] Reconciled', { fixed });
      await this._save();
    }
  }

  /**
   * Add a new drive
   */
  async add(driveData) {
    if (!this.initialized) await this.init();

    const entry = {
      id: driveData.id,
      key: driveData.key,
      shareLink: driveData.shareLink || `peardrop://${driveData.key}`,
      name: driveData.name || 'Unnamed',
      files: driveData.files || [],
      totalBytes: driveData.totalBytes || 0,
      createdAt: driveData.createdAt || new Date().toISOString(),
      localPath: driveData.localPath || null,
      storagePath: driveData.storagePath || path.join(DRIVES_STORAGE_DIR, driveData.id),
      state: driveData.state || DriveState.ACTIVE,
      isUpload: driveData.isUpload || false,
      stats: {
        uploaded: 0,
        downloaded: 0,
        peers: 0,
        ...driveData.stats
      }
    };

    this.drives.set(entry.id, entry);
    await this._save();

    this.emit('added', entry);
    console.log('[DriveManager] Added', { id: entry.id, name: entry.name, state: entry.state });

    return entry;
  }

  /**
   * Remove a drive completely
   * @param {string} id - Drive ID
   * @param {object} opts - { deleteFiles: boolean, deleteStorage: boolean }
   */
  async remove(id, opts = {}) {
    if (!this.initialized) await this.init();

    const drive = this.drives.get(id);
    if (!drive) {
      console.log('[DriveManager] Remove: not found', { id });
      return false;
    }

    const { deleteFiles = false, deleteStorage = true } = opts;

    console.log('[DriveManager] Removing', { 
      id, 
      name: drive.name, 
      deleteFiles, 
      deleteStorage 
    });

    // Delete hyperdrive storage
    if (deleteStorage && drive.storagePath) {
      try {
        await fs.rm(drive.storagePath, { recursive: true, force: true });
        console.log('[DriveManager] Storage deleted', { path: drive.storagePath });
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn('[DriveManager] Storage delete failed:', err.message);
        }
      }
    }

    // Optionally delete the actual downloaded/shared files
    if (deleteFiles && drive.files) {
      for (const file of drive.files) {
        if (file.path) {
          try {
            await fs.unlink(file.path);
            console.log('[DriveManager] File deleted', { path: file.path });
          } catch (err) {
            if (err.code !== 'ENOENT') {
              console.warn('[DriveManager] File delete failed:', err.message);
            }
          }
        }
      }
    }

    // Remove from map and save
    this.drives.delete(id);
    await this._save();

    this.emit('removed', id);
    console.log('[DriveManager] Removed completely', { id });

    return true;
  }

  /**
   * Update drive properties
   */
  async update(id, updates) {
    if (!this.initialized) await this.init();

    const drive = this.drives.get(id);
    if (!drive) return null;

    Object.assign(drive, updates);
    await this._save();

    this.emit('updated', drive);
    return drive;
  }

  /**
   * Pause seeding (keep drive data, stop network activity)
   */
  async pause(id) {
    const drive = this.drives.get(id);
    if (!drive) return null;

    if (drive.state === DriveState.ACTIVE) {
      drive.state = DriveState.PAUSED;
      await this._save();
      this.emit('updated', drive);
      console.log('[DriveManager] Paused', { id, name: drive.name });
    }

    return drive;
  }

  /**
   * Resume seeding
   */
  async resume(id) {
    const drive = this.drives.get(id);
    if (!drive) return null;

    if (drive.state === DriveState.PAUSED) {
      drive.state = DriveState.ACTIVE;
      await this._save();
      this.emit('updated', drive);
      console.log('[DriveManager] Resumed', { id, name: drive.name });
    }

    return drive;
  }

  /**
   * Get single drive by ID
   */
  get(id) {
    return this.drives.get(id) || null;
  }

  /**
   * Get all drives as array
   */
  getAll() {
    return Array.from(this.drives.values());
  }

  /**
   * Get only active (seeding) drives
   */
  getActive() {
    return this.getAll().filter(d => d.state === DriveState.ACTIVE);
  }

  /**
   * Find drive by hyperdrive key (for dedup checking)
   */
  getByKey(key) {
    if (!key) return null;
    const normalizedKey = key.toLowerCase();
    return this.getAll().find(d => d.key?.toLowerCase() === normalizedKey) || null;
  }

  /**
   * Check if a file/path exists
   */
  async checkLocalAvailability(id) {
    const drive = this.drives.get(id);
    if (!drive || !drive.files || drive.files.length === 0) return false;

    // Check first file
    const firstFile = drive.files[0];
    if (!firstFile.path) return false;

    return this._pathExists(firstFile.path);
  }

  /**
   * Update stats for a drive
   */
  async updateStats(id, stats) {
    const drive = this.drives.get(id);
    if (!drive) return null;

    drive.stats = { ...drive.stats, ...stats };
    await this._save();
    
    return drive;
  }

  // ============================================================================
  // Private helpers
  // ============================================================================

  async _save() {
    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      drives: Array.from(this.drives.values())
    };

    await fs.writeFile(DRIVES_FILE, JSON.stringify(data, null, 2));
  }

  async _pathExists(filePath) {
    if (!filePath) return false;
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
const manager = new DriveManager();

module.exports = {
  DriveManager,
  manager,
  DriveState
};
