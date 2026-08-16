/**
 * MODULE: main.js (PearDrop v2)
 * PURPOSE: Electron main process for PearDrop - P2P file sharing
 * VERSION: 0.18.0
 * 
 * EXPORTS: None (entry point)
 * 
 * FUNCTIONS:
 *   - createWindow() - Creates main BrowserWindow with platform-aware styling
 *   - initializeApp() - Ensures app directories exist, loads config
 *   - setupIPC() - Registers all IPC handlers for renderer
 * 
 * IPC HANDLERS (renderer can invoke):
 *   Hyperdrive:
 *     - 'hyperdrive-share' - Create share from files, returns link
 *     - 'hyperdrive-stop' - Stop sharing a drive
 *     - 'hyperdrive-open' - Connect to remote drive (includes dedup check)
 *     - 'hyperdrive-abort' - Abort pending connection(s)
 *     - 'hyperdrive-download' - Download files from opened drive
 *     - 'hyperdrive-status' - Get active/stopped drives stats
 *   DriveManager:
 *     - 'drives-list' - Get all tracked drives
 *     - 'drives-pause' - Pause seeding (keep data)
 *     - 'drives-resume' - Resume seeding
 *     - 'drives-remove' - Delete drive completely
 *     - 'drives-check-files' - Verify local file availability
 *     - 'drive-get' - Get single drive by ID
 *   Utilities:
 *     - 'open-downloads' - Open downloads folder in Finder/Explorer
 *     - 'open-file' - Open file in default application
 *     - 'show-file-in-folder' - Reveal file in Finder/Explorer
 *     - 'get-files-stats' - Get file/folder stats with folder expansion
 *     - 'get-debug' - Get current debug state
 *     - 'set-debug' - Set debug state (persists to config)
 * 
 * IPC EVENTS SENT (to renderer):
 *   - 'peer-connected' - Peer joined (upload) or download starting
 *   - 'peer-disconnected' - Peer left
 *   - 'upload-progress' - Transfer progress update
 *   - 'upload-complete' - Transfer finished
 *   - 'files-downloaded' - Download complete with file list
 *   - 'drives-updated' - Drive added/removed/changed
 *   - 'download-peer-disconnected' - Sender went offline during download
 * 
 * EXTERNAL CALLS:
 *   - lib/hyperdrive-manager.js (manager singleton) - 🔒 SACRED
 *   - lib/drive-manager.js (driveManager singleton) - Single source of truth
 *   - lib/downloader.js (downloadFromDrive)
 *   - lib/file-utils.js (formatBytes, formatSpeed)
 *   - lib/logger.js (createLogger, loadConfig, setDebug)
 * 
 * KEY STATE:
 *   - mainWindow - BrowserWindow instance
 *   - APP_DATA_DIR - ~/peardrop
 *   - DOWNLOADS_DIR - ~/peardrop/downloads
 * 
 * PLATFORM SUPPORT:
 *   - macOS: Full glassmorphism, traffic lights, vibrancy
 *   - Windows: Standard title bar, solid background
 *   - Linux: Standard title bar, solid background
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { join } = path;
const fs = require('fs').promises;
const os = require('os');

// Hyperdrive manager for file sharing (🔒 SACRED - don't modify)
const { manager: hyperdriveManager } = require('./lib/hyperdrive-manager');
// Download orchestration (✅ SAFE to modify)
const { downloadFromDrive } = require('./lib/downloader');
// Drive manager - single source of truth for all drives (✅ SAFE to modify)
const { manager: driveManager, DriveState } = require('./lib/drive-manager');
// Utilities
const { formatBytes, formatSpeed } = require('./lib/file-utils');
// Debug logging
const { createLogger, loadConfig: loadDebugConfig, setDebug, isDebugEnabled } = require('./lib/logger');
const log = createLogger('PearDrop');

// Platform detection
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

let mainWindow;

// App configuration
const APP_DATA_DIR = join(os.homedir(), 'peardrop');
const DOWNLOADS_DIR = join(APP_DATA_DIR, 'downloads');

// ============================================================================
// Window Management
// ============================================================================

function createWindow() {
    // Platform-specific window options
    const windowOptions = {
        width: 415,
        height: 830,
        minWidth: 450,
        minHeight: 450,
        maxWidth: 480,
        maxHeight: 1000,
        resizable: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: join(__dirname, 'preload.js')
        },
        title: 'PearDrop',
        show: false
    };

    // macOS-specific: glassmorphism + hidden title bar
    if (isMac) {
        Object.assign(windowOptions, {
            titleBarStyle: 'hiddenInset',
            trafficLightPosition: { x: 12, y: 12 },
            vibrancy: 'under-window',
            visualEffectState: 'active',
            transparent: true,
            backgroundColor: '#00000000'
        });
    } else {
        // Windows/Linux: standard title bar, solid background
        Object.assign(windowOptions, {
            backgroundColor: '#1a1a2e',
            // Frame is default true on Windows/Linux
            autoHideMenuBar: true  // Hide menu bar but allow Alt to show it
        });
    }

    mainWindow = new BrowserWindow(windowOptions);

    // Load main interface
    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
        
        // Position on right side of screen
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth } = primaryDisplay.workAreaSize;
        const [winWidth] = mainWindow.getSize();
        mainWindow.setPosition(screenWidth - winWidth - 20, 80);
    });

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// ============================================================================
// App Initialization
// ============================================================================

async function initializeApp() {
    try {
        // Load debug config first
        const debugEnabled = loadDebugConfig();
        log('Debug logging:', debugEnabled ? 'ENABLED' : 'DISABLED');
        
        // Ensure app directories exist
        await fs.mkdir(APP_DATA_DIR, { recursive: true });
        await fs.mkdir(DOWNLOADS_DIR, { recursive: true });
        log('App directories ready');
        return true;
    } catch (error) {
        console.error('[PearDrop] Failed to initialize:', error);
        throw error;
    }
}

// ============================================================================
// IPC Handlers
// ============================================================================

function setupIPC() {
    // ========================================================================
    // Hyperdrive File Sharing
    // ========================================================================

    // Create a shareable link for files
    ipcMain.handle('hyperdrive-share', async (event, { files, options = {} }) => {
        try {
            const result = await hyperdriveManager.createDrive(files, {
                ttlMs: options.ttlMs || 0,
                name: options.name
            });
            
            console.log('[PearDrop] Share created:', result.shareLink);
            
            // Calculate total bytes from files
            const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
            const shareName = options.name || (files.length === 1 ? files[0].name : `${files.length} files`);
            
            // Add to DriveManager (single source of truth for Shares tab)
            const driveEntry = await driveManager.add({
                id: result.driveId,
                key: result.key,
                shareLink: result.shareLink,
                name: shareName,
                files: files.map(f => ({
                    name: f.name,
                    path: f.path,
                    size: f.size
                })),
                totalBytes: totalBytes,
                localPath: files[0]?.path ? path.dirname(files[0].path) : null,
                storagePath: path.join(hyperdriveManager.drivesDir, result.driveId),
                state: DriveState.ACTIVE,
                isUpload: true
            });
            
            // Notify renderer about new drive entry
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('drives-updated', {
                    action: 'added',
                    entry: driveEntry
                });
            }
            
            return {
                success: true,
                driveId: result.driveId,
                shareLink: result.shareLink,
                driveEntryId: driveEntry.id
            };
        } catch (error) {
            console.error('[PearDrop] Share failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Stop sharing a drive
    ipcMain.handle('hyperdrive-stop', async (event, { driveId, purge = true }) => {
        try {
            await hyperdriveManager.stopDrive(driveId, { purge });
            console.log('[PearDrop] Share stopped:', driveId);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Quick local-only duplicate check (fast, no network)
    ipcMain.handle('hyperdrive-check-duplicate', async (event, { shareLink }) => {
        const driveKey = shareLink.replace('peardrop://', '').toLowerCase();
        const existingDrive = driveManager.getByKey(driveKey);
        
        if (existingDrive) {
            const localAvailable = await driveManager.checkLocalAvailability(existingDrive.id);
            return {
                isDuplicate: true,
                localStatus: localAvailable ? 'available' : 'missing',
                existingDrive: existingDrive,
                driveId: existingDrive.id
            };
        }
        
        return { isDuplicate: false };
    });

    // Open a shared drive for download
    // Includes dedup check - returns existing entry if already downloaded
    // Pass forceOpen: true to skip dedup check (for re-downloads)
    ipcMain.handle('hyperdrive-open', async (event, { shareLink, forceOpen = false }) => {
        try {
            console.log('[PearDrop] Opening:', shareLink, forceOpen ? '(force)' : '');
            
            // Check for duplicate BEFORE opening the drive (unless forcing)
            // Extract key from peardrop:// link
            const driveKey = shareLink.replace('peardrop://', '').toLowerCase();
            if (driveKey && !forceOpen) {
                const existingDrive = driveManager.getByKey(driveKey);
                
                if (existingDrive) {
                    // Check if local files still exist
                    const localAvailable = await driveManager.checkLocalAvailability(existingDrive.id);
                    
                    console.log('[PearDrop] Duplicate detected:', {
                        driveKey: driveKey.slice(0, 12) + '...',
                        localAvailable
                    });
                    
                    // Return duplicate info - let renderer decide what to do
                    return {
                        success: true,
                        isDuplicate: true,
                        localStatus: localAvailable ? 'available' : 'missing',
                        existingDrive: existingDrive,
                        driveId: existingDrive.id,
                        shareName: existingDrive.name,
                        totalBytes: existingDrive.totalBytes,
                        localPath: existingDrive.localPath
                    };
                }
            }
            
            // Not a duplicate, proceed with normal open
            const result = await hyperdriveManager.openDrive(shareLink);
            
            return {
                success: true,
                isDuplicate: false,
                driveId: result.driveId,
                files: result.files,
                shareName: result.shareName,
                totalBytes: result.totalBytes,
                hasManifest: result.hasManifest,
                peerConnected: result.peerConnected
            };
        } catch (error) {
            console.error('[PearDrop] Open failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Abort a pending connection
    ipcMain.handle('hyperdrive-abort', async (event, { driveId }) => {
        try {
            if (driveId) {
                const aborted = hyperdriveManager.abortConnection(driveId);
                console.log('[PearDrop] Abort connection:', { driveId, aborted });
                return { success: true, aborted };
            } else {
                hyperdriveManager.abortAllConnections();
                console.log('[PearDrop] Aborted all pending connections');
                return { success: true, aborted: true };
            }
        } catch (error) {
            console.error('[PearDrop] Abort failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Download files from an opened drive
    // Uses lib/downloader.js (✅ SAFE module - can be modified without touching sacred code)
    ipcMain.handle('hyperdrive-download', async (event, { driveId, destDir }) => {
        try {
            const session = hyperdriveManager.activeDrives.get(driveId);
            if (!session) {
                throw new Error('Session not found');
            }
            
            const downloadPath = destDir || DOWNLOADS_DIR;
            
            console.log('[PearDrop] Download starting via downloader module');
            
            // Use the downloader module with callbacks for UI updates
            const result = await downloadFromDrive(session.drive, {
                destDir: downloadPath,
                totalBytes: session.totalBytes || 0,
                shareName: session.shareName,
                
                onPeerConnected: (data) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('peer-connected', {
                            driveId,
                            peerId: 'self',
                            shareName: data.shareName,
                            totalBytes: data.totalBytes
                        });
                    }
                },
                
                onProgress: (data) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('upload-progress', {
                            peerId: 'self',
                            driveId,
                            ...data
                        });
                    }
                },
                
                onComplete: (data) => {
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('upload-complete', {
                            peerId: 'self',
                            driveId,
                            totalBytes: data.totalBytes,
                            duration: data.duration
                        });
                    }
                },
                
                onError: (data) => {
                    console.error('[PearDrop] File error:', data);
                }
            });
            
            // Add to DriveManager (single source of truth)
            const driveEntry = await driveManager.add({
                id: driveId,
                key: session.metadata?.key,
                shareLink: session.shareLink || `peardrop://${session.metadata?.key || 'unknown'}`,
                name: session.shareName,
                files: result.files,
                totalBytes: result.totalBytes,
                localPath: downloadPath,
                storagePath: path.join(hyperdriveManager.drivesDir, driveId),
                state: DriveState.ACTIVE,
                isUpload: false  // This is a download
            });
            
            // Mark session as seeding mode
            if (session) {
                session.isSeeding = true;
                session.driveEntryId = driveEntry.id;
            }
            
            console.log('[PearDrop] Download complete, now seeding:', driveEntry.name);
            
            // Notify renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('files-downloaded', {
                    files: result.files,
                    downloadPath,
                    driveId: driveEntry.id,
                    isSeeding: true
                });
                
                // Notify about new drive entry
                mainWindow.webContents.send('drives-updated', {
                    action: 'added',
                    entry: driveEntry
                });
            }
            
            return { success: true, files: result.files, downloadPath, driveId: driveEntry.id };
        } catch (error) {
            console.error('[PearDrop] Download failed:', error);
            return { success: false, error: error.message };
        }
    });

    // Get status of all drives
    ipcMain.handle('hyperdrive-status', async () => {
        try {
            return { success: true, ...hyperdriveManager.getStatus() };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Open downloads folder
    ipcMain.handle('open-downloads', async () => {
        try {
            await shell.openPath(DOWNLOADS_DIR);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Open file in default application
    ipcMain.handle('open-file', async (event, { filePath }) => {
        try {
            if (!filePath) {
                return { success: false, error: 'No file path provided' };
            }
            const result = await shell.openPath(filePath);
            // shell.openPath returns empty string on success, error message on failure
            if (result) {
                return { success: false, error: result };
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Show file in Finder/Explorer
    ipcMain.handle('show-file-in-folder', async (event, { filePath }) => {
        try {
            if (!filePath) {
                return { success: false, error: 'No file path provided' };
            }
            shell.showItemInFolder(filePath);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Get drive info by ID
    ipcMain.handle('drive-get', async (event, { id }) => {
        try {
            const drive = driveManager.get(id);
            if (!drive) {
                return { success: false, error: 'Drive not found' };
            }
            return { success: true, drive };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // ========================================================================
    // DriveManager - Single source of truth for all drives
    // ========================================================================

    // Get all drives
    ipcMain.handle('drives-list', async () => {
        try {
            const drives = driveManager.getAll();
            return { success: true, drives };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Pause seeding (keep drive, stop network)
    ipcMain.handle('drives-pause', async (event, { id }) => {
        try {
            console.log('[PearDrop] Pausing drive', { id });
            
            // Stop the hyperdrive but keep storage
            const session = hyperdriveManager.activeDrives.get(id);
            if (session) {
                await hyperdriveManager.stopDrive(id, { purge: false });
            }
            
            // Update DriveManager state
            const entry = await driveManager.pause(id);
            
            return { success: true, entry };
        } catch (error) {
            console.error('[PearDrop] Failed to pause drive:', error);
            return { success: false, error: error.message };
        }
    });

    // Resume seeding
    ipcMain.handle('drives-resume', async (event, { id }) => {
        try {
            console.log('[PearDrop] Resuming drive', { id });
            
            // TODO: Implement re-joining swarm for paused drives
            // For now, just update state
            const entry = await driveManager.resume(id);
            
            return { success: true, entry };
        } catch (error) {
            console.error('[PearDrop] Failed to resume drive:', error);
            return { success: false, error: error.message };
        }
    });

    // Remove drive completely
    ipcMain.handle('drives-remove', async (event, { id, deleteFiles = false }) => {
        try {
            console.log('[PearDrop] Removing drive', { id, deleteFiles });
            
            // Stop if active
            const session = hyperdriveManager.activeDrives.get(id);
            if (session) {
                console.log('[PearDrop] Stopping active drive', { id });
                await hyperdriveManager.stopDrive(id, { purge: true });
            }
            
            // Remove via DriveManager (handles storage + optional file deletion)
            const success = await driveManager.remove(id, { 
                deleteFiles, 
                deleteStorage: true 
            });
            
            // Notify renderer
            if (success && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('drives-updated', {
                    action: 'removed',
                    id
                });
            }
            
            console.log('[PearDrop] Drive removed completely', { id });
            return { success };
        } catch (error) {
            console.error('[PearDrop] Failed to remove drive:', error);
            return { success: false, error: error.message };
        }
    });

    // Check local file availability for all drives
    ipcMain.handle('drives-check-files', async () => {
        try {
            const drives = driveManager.getAll();
            const results = [];
            
            for (const drive of drives) {
                const available = await driveManager.checkLocalAvailability(drive.id);
                if (available !== drive.isLocalAvailable) {
                    await driveManager.update(drive.id, { isLocalAvailable: available });
                }
                results.push({ ...drive, isLocalAvailable: available });
            }
            
            return { success: true, drives: results };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // ========================================================================
    // Debug Logging Control
    // ========================================================================

    // Get current debug state
    ipcMain.handle('get-debug', async () => {
        return { enabled: isDebugEnabled() };
    });

    // Set debug state (persists to ~/peardrop/config.json)
    ipcMain.handle('set-debug', async (event, { enabled }) => {
        setDebug(enabled);
        return { success: true, enabled: isDebugEnabled() };
    });

    // ========================================================================
    // QR Code generation
    // ========================================================================
    ipcMain.handle('generate-qr', async (event, { text }) => {
        const QRCode = require('qrcode');
        return await QRCode.toDataURL(text, { width: 160, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    });

    // ========================================================================
    // File Stats (with folder expansion)
    // ========================================================================

    // Get stats for files/folders, expanding folder contents
    ipcMain.handle('get-files-stats', async (event, filePaths) => {
        const path = require('path');
        
        /**
         * Recursively get total size of a directory
         */
        async function getFolderSize(folderPath) {
            let totalSize = 0;
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const entryPath = path.join(folderPath, entry.name);
                try {
                    if (entry.isDirectory()) {
                        totalSize += await getFolderSize(entryPath);
                    } else if (entry.isFile()) {
                        const stats = await fs.stat(entryPath);
                        totalSize += stats.size;
                    }
                } catch (err) {
                    console.log('[PearDrop] Skipping inaccessible entry:', entryPath);
                }
            }
            
            return totalSize;
        }
        
        /**
         * Recursively enumerate all files in a directory
         */
        async function enumerateFolderContents(folderPath, basePath = null) {
            const results = [];
            basePath = basePath || folderPath;
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            
            for (const entry of entries) {
                const entryPath = path.join(folderPath, entry.name);
                try {
                    if (entry.isDirectory()) {
                        const subResults = await enumerateFolderContents(entryPath, basePath);
                        results.push(...subResults);
                    } else if (entry.isFile()) {
                        const stats = await fs.stat(entryPath);
                        results.push({
                            path: entryPath,
                            name: entry.name,
                            relativePath: path.relative(basePath, entryPath),
                            size: stats.size
                        });
                    }
                } catch (err) {
                    console.log('[PearDrop] Skipping inaccessible entry:', entryPath);
                }
            }
            
            return results;
        }
        
        const results = [];
        
        for (const filePath of filePaths) {
            try {
                const stats = await fs.stat(filePath);
                
                if (stats.isDirectory()) {
                    // For folders: calculate total size and enumerate contents
                    const totalSize = await getFolderSize(filePath);
                    const contents = await enumerateFolderContents(filePath);
                    
                    results.push({
                        path: filePath,
                        name: path.basename(filePath),
                        size: totalSize,
                        type: 'folder',
                        fileCount: contents.length,
                        contents: contents
                    });
                    
                    console.log('[PearDrop] Folder stat:', path.basename(filePath), 
                        `${contents.length} files, ${formatBytes(totalSize)}`);
                } else {
                    // Regular file
                    results.push({
                        path: filePath,
                        name: path.basename(filePath),
                        size: stats.size,
                        type: 'file'
                    });
                }
            } catch (error) {
                console.error('[PearDrop] Failed to stat:', filePath, error.message);
            }
        }
        
        return results;
    });
}

// ============================================================================
// App Lifecycle
// ============================================================================

app.whenReady().then(async () => {
    try {
        await initializeApp();
        setupIPC();
        createWindow();
        
        // Initialize Hyperdrive manager
        await hyperdriveManager.init();
        
        // Initialize DriveManager (single source of truth for UI)
        await driveManager.init();
        
        // Forward progress events to renderer
        hyperdriveManager.on('peer-connected', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('peer-connected', data);
            }
        });
        
        hyperdriveManager.on('peer-disconnected', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('peer-disconnected', data);
            }
        });
        
        hyperdriveManager.on('upload-progress', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('upload-progress', {
                    ...data,
                    bytesFormatted: formatBytes(data.bytesTransferred),
                    totalFormatted: formatBytes(data.totalBytes),
                    speedFormatted: formatSpeed(data.speed)
                });
            }
        });
        
        hyperdriveManager.on('upload-complete', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('upload-complete', data);
            }
        });
        
        // Download peer disconnected - sender went offline
        hyperdriveManager.on('download-peer-disconnected', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('download-peer-disconnected', data);
            }
        });
        
        console.log('[PearDrop] Ready');
        
    } catch (error) {
        console.error('[PearDrop] Startup failed:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('Startup Error', error.message);
        app.quit();
    }
});

app.on('window-all-closed', async () => {
    // Stop all shares and cleanup
    try {
        await hyperdriveManager.stopAll({ purge: true });
        console.log('[PearDrop] Shares cleaned up');
    } catch (error) {
        console.error('[PearDrop] Cleanup error:', error);
    }
    
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('before-quit', async () => {
    try {
        await hyperdriveManager.stopAll({ purge: true });
    } catch (error) {
        console.error('[PearDrop] Cleanup error:', error);
    }
});
