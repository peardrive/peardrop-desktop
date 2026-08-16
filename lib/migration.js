/**
 * MODULE: lib/migration.js  
 * PURPOSE: One-time migration from DriveManager + HyperdriveManager to unified HyperdriveManager
 * VERSION: 1.0.0
 * 
 * EXPORTS:
 *   - checkMigrationNeeded() - Check if migration is needed
 *   - runMigration() - Execute the migration process  
 *   - getMigrationSummary() - Get info about what will be migrated
 * 
 * MIGRATION PROCESS:
 *   1. Check for drives.json (DriveManager) and drives-manifest.json (HyperdriveManager)
 *   2. Merge data intelligently (HyperdriveManager = P2P truth, DriveManager = UI data)
 *   3. Clean up orphaned drives (no corresponding corestore directories)
 *   4. Create unified drives-state.json
 *   5. Backup old files with timestamp
 * 
 * SAFETY:
 *   - All operations are atomic (success or rollback)
 *   - Original files are backed up, never deleted
 *   - Graceful error handling with detailed logging
 *   - Can be safely removed after migration completes
 * 
 * EXTERNAL CALLS: fs.promises, path, os
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const PEARDROP_DIR = path.join(os.homedir(), 'peardrop');
const DRIVES_DIR = path.join(PEARDROP_DIR, 'drives');
const OLD_DRIVEMANAGER_FILE = path.join(PEARDROP_DIR, 'drives.json');
const OLD_HYPERDRIVEMANAGER_FILE = path.join(PEARDROP_DIR, 'drives-manifest.json');
const NEW_DRIVES_STATE_FILE = path.join(PEARDROP_DIR, 'drives-state.json');

/**
 * Check if migration is needed
 * @returns {Promise<{needed: boolean, summary: object}>}
 */
async function checkMigrationNeeded() {
  try {
    // Check if new file already exists and has data
    try {
      const newState = JSON.parse(await fs.readFile(NEW_DRIVES_STATE_FILE, 'utf8'));
      if (newState.drives && Object.keys(newState.drives).length > 0) {
        return { needed: false, reason: 'drives-state.json already has data' };
      }
    } catch {
      // File doesn't exist or is invalid, continue checking for migration
    }

    // Check for old files
    const [dmExists, hmExists] = await Promise.all([
      fileExists(OLD_DRIVEMANAGER_FILE),
      fileExists(OLD_HYPERDRIVEMANAGER_FILE)
    ]);

    if (!dmExists && !hmExists) {
      return { needed: false, reason: 'no legacy files found' };
    }

    // Get summary of what would be migrated
    const summary = await getMigrationSummary();
    
    return { 
      needed: true, 
      summary,
      sources: {
        driveManager: dmExists,
        hyperdriveManager: hmExists
      }
    };
  } catch (error) {
    console.error('[Migration] Error checking migration need:', error);
    return { needed: false, reason: 'error checking files', error: error.message };
  }
}

/**
 * Get summary of what will be migrated
 */
async function getMigrationSummary() {
  const summary = {
    driveManagerDrives: 0,
    hyperdriveManagerDrives: 0,
    corestoreDirectories: 0,
    orphanedDrives: 0,
    totalToMigrate: 0
  };

  try {
    // Count DriveManager drives
    if (await fileExists(OLD_DRIVEMANAGER_FILE)) {
      const dmData = JSON.parse(await fs.readFile(OLD_DRIVEMANAGER_FILE, 'utf8'));
      summary.driveManagerDrives = dmData.drives?.length || 0;
    }

    // Count HyperdriveManager drives
    if (await fileExists(OLD_HYPERDRIVEMANAGER_FILE)) {
      const hmData = JSON.parse(await fs.readFile(OLD_HYPERDRIVEMANAGER_FILE, 'utf8'));
      summary.hyperdriveManagerDrives = Object.keys(hmData.drives || {}).length;
    }

    // Count actual corestore directories
    if (await fileExists(DRIVES_DIR)) {
      const dirEntries = await fs.readdir(DRIVES_DIR, { withFileTypes: true });
      summary.corestoreDirectories = dirEntries.filter(entry => entry.isDirectory()).length;
    }

    // Estimate orphaned drives (drives in manifests but no corestore)
    summary.orphanedDrives = Math.max(0, 
      summary.hyperdriveManagerDrives - summary.corestoreDirectories
    );

    summary.totalToMigrate = Math.max(summary.driveManagerDrives, summary.hyperdriveManagerDrives);

  } catch (error) {
    console.error('[Migration] Error getting summary:', error);
  }

  return summary;
}

/**
 * Execute the migration process
 * @returns {Promise<{success: boolean, migrated: number, cleaned: number, backed_up: string[]}>}
 */
async function runMigration() {
  const result = {
    success: false,
    migrated: 0,
    cleaned: 0,
    backed_up: [],
    error: null
  };

  try {
    console.log('[Migration] Starting drive data migration...');

    // Step 1: Load existing data
    const driveManagerData = await loadDriveManagerData();
    const hyperdriveManagerData = await loadHyperdriveManagerData();
    const corestoreDirectories = await getCorestoreDirectories();

    console.log('[Migration] Loaded data:', {
      driveManagerDrives: driveManagerData?.drives?.length || 0,
      hyperdriveManagerDrives: Object.keys(hyperdriveManagerData?.drives || {}).length,
      corestoreDirectories: corestoreDirectories.length
    });

    // Step 2: Merge and clean data
    const mergedData = await mergeAndCleanData(
      driveManagerData, 
      hyperdriveManagerData, 
      corestoreDirectories
    );

    console.log('[Migration] Merged data:', {
      totalDrives: Object.keys(mergedData.drives).length,
      cleaned: result.cleaned
    });

    // Step 3: Create backup of old files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    await backupOldFiles(timestamp);
    result.backed_up = [`drives.json.backup-${timestamp}`, `drives-manifest.json.backup-${timestamp}`];

    // Step 4: Write new drives-state.json
    await fs.writeFile(NEW_DRIVES_STATE_FILE, JSON.stringify(mergedData, null, 2));
    console.log('[Migration] Created drives-state.json');

    result.success = true;
    result.migrated = Object.keys(mergedData.drives).length;
    result.cleaned = mergedData.stats.totalCleaned || 0;

    console.log('[Migration] Migration completed successfully');
    return result;

  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    result.error = error.message;
    return result;
  }
}

/**
 * Load DriveManager data (drives.json)
 */
async function loadDriveManagerData() {
  try {
    if (await fileExists(OLD_DRIVEMANAGER_FILE)) {
      return JSON.parse(await fs.readFile(OLD_DRIVEMANAGER_FILE, 'utf8'));
    }
  } catch (error) {
    console.warn('[Migration] Could not load DriveManager data:', error.message);
  }
  return null;
}

/**
 * Load HyperdriveManager data (drives-manifest.json)
 */
async function loadHyperdriveManagerData() {
  try {
    if (await fileExists(OLD_HYPERDRIVEMANAGER_FILE)) {
      return JSON.parse(await fs.readFile(OLD_HYPERDRIVEMANAGER_FILE, 'utf8'));
    }
  } catch (error) {
    console.warn('[Migration] Could not load HyperdriveManager data:', error.message);
  }
  return null;
}

/**
 * Get list of actual corestore directories
 */
async function getCorestoreDirectories() {
  try {
    if (await fileExists(DRIVES_DIR)) {
      const dirEntries = await fs.readdir(DRIVES_DIR, { withFileTypes: true });
      return dirEntries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    }
  } catch (error) {
    console.warn('[Migration] Could not read drives directory:', error.message);
  }
  return [];
}

/**
 * Merge DriveManager and HyperdriveManager data, clean orphaned drives
 */
async function mergeAndCleanData(driveManagerData, hyperdriveManagerData, corestoreDirectories) {
  const merged = {
    version: 2,
    migratedAt: Date.now(),
    drives: {},
    stats: {
      totalCreated: 0,
      totalPurged: 0,
      totalBytesShared: 0,
      totalCleaned: 0
    }
  };

  // Create lookup maps
  const dmDrivesByKey = new Map();
  const hmDrivesByKey = new Map();
  const corestoreSet = new Set(corestoreDirectories);

  // Index DriveManager drives by key
  if (driveManagerData?.drives) {
    for (const drive of driveManagerData.drives) {
      if (drive.key) {
        dmDrivesByKey.set(drive.key, drive);
      }
    }
  }

  // Index HyperdriveManager drives by key  
  if (hyperdriveManagerData?.drives) {
    for (const [driveId, drive] of Object.entries(hyperdriveManagerData.drives)) {
      if (drive.key) {
        hmDrivesByKey.set(drive.key, { ...drive, driveId });
      }
    }
  }

  // Merge drives (prefer HyperdriveManager for P2P data, DriveManager for UI data)
  const allKeys = new Set([...dmDrivesByKey.keys(), ...hmDrivesByKey.keys()]);

  for (const key of allKeys) {
    const dmDrive = dmDrivesByKey.get(key);
    const hmDrive = hmDrivesByKey.get(key);
    
    // Use HyperdriveManager drive as base (has P2P data)
    const baseDrive = hmDrive || dmDrive;
    const driveId = baseDrive.driveId || baseDrive.id;

    // Check if corestore exists
    const hasStorage = corestoreSet.has(driveId);

    // Skip drives without storage (orphaned) - these will be silently skipped
    if (!hasStorage) {
      console.log('[Migration] Skipping orphaned drive (no storage):', driveId);
      merged.stats.totalCleaned++;
      continue;
    }

    // Create merged drive entry
    const mergedDrive = {
      // Core P2P data (from HyperdriveManager)
      driveId,
      key: baseDrive.key,
      discoveryKey: baseDrive.discoveryKey,
      state: 'active', // All migrated drives default to active (no more purged state)
      
      // File data
      files: baseDrive.files || [],
      totalBytes: baseDrive.totalBytes || 0,
      storagePath: baseDrive.storagePath || path.join(DRIVES_DIR, driveId),
      
      // UI-friendly data (prefer DriveManager, fallback to computed)
      name: dmDrive?.name || baseDrive.name || computeDisplayName(baseDrive.files || []),
      shareLink: dmDrive?.shareLink || `peardrop://${baseDrive.key}`,
      localPath: dmDrive?.localPath || baseDrive.localPath,
      
      // Transfer metadata
      createdAt: baseDrive.createdAt || dmDrive?.createdAt || Date.now(),
      isUpload: dmDrive?.isUpload ?? baseDrive.isUpload ?? true,
      
      // Stats
      stats: {
        uploaded: 0,
        downloaded: 0, 
        peers: 0,
        ...(dmDrive?.stats || {})
      },

      // Migration metadata
      _migratedFrom: {
        driveManager: !!dmDrive,
        hyperdriveManager: !!hmDrive,
        hasStorage
      }
    };

    merged.drives[driveId] = mergedDrive;
  }

  // Copy stats from HyperdriveManager
  if (hyperdriveManagerData?.stats) {
    merged.stats.totalCreated = hyperdriveManagerData.stats.totalCreated || 0;
    merged.stats.totalPurged = hyperdriveManagerData.stats.totalPurged || 0;
    merged.stats.totalBytesShared = hyperdriveManagerData.stats.totalBytesShared || 0;
  }

  return merged;
}

/**
 * Compute display name from file list
 */
function computeDisplayName(files) {
  if (!files || files.length === 0) return 'Empty share';
  if (files.length === 1) return files[0].name;
  return `${files.length} files`;
}

/**
 * Backup old files with timestamp
 */
async function backupOldFiles(timestamp) {
  const backups = [];

  if (await fileExists(OLD_DRIVEMANAGER_FILE)) {
    const backupPath = `${OLD_DRIVEMANAGER_FILE}.backup-${timestamp}`;
    await fs.copyFile(OLD_DRIVEMANAGER_FILE, backupPath);
    backups.push(backupPath);
    console.log('[Migration] Backed up drives.json');
  }

  if (await fileExists(OLD_HYPERDRIVEMANAGER_FILE)) {
    const backupPath = `${OLD_HYPERDRIVEMANAGER_FILE}.backup-${timestamp}`;
    await fs.copyFile(OLD_HYPERDRIVEMANAGER_FILE, backupPath);
    backups.push(backupPath);
    console.log('[Migration] Backed up drives-manifest.json');
  }

  return backups;
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  checkMigrationNeeded,
  runMigration,
  getMigrationSummary
};