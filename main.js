/**
 * MODULE: main.js (PearDrop v2)
 * PURPOSE: Electron main process for PearDrop - P2P file sharing
 * VERSION: 0.24.0
 * EXPORTS: None (entry point)
 * FUNCTIONS:
 * createWindow() - Creates main BrowserWindow with platform-aware styling
 * initializeApp() - Ensures app directories exist, loads config
 * setupIPC() - Registers all IPC handlers for renderer
 * IPC HANDLERS (renderer can invoke):
 *   Hyperdrive:
 * 'hyperdrive-share' - Create share from files, returns link
 * 'hyperdrive-check-duplicate' - Fast local duplicate check
 * 'hyperdrive-open' - Connect to remote drive (includes dedup check)
 * 'hyperdrive-download' - Download files from opened drive
 *   HyperdriveManager (UI Interface):
 * 'drive-get' - Get single drive by ID
 * 'drives-list' - Get all tracked drives
 * 'drives-pause' - Pause seeding (keep data)
 * 'drives-resume' - Resume seeding
 * 'drives-remove' - Delete drive completely
 *   Utilities:
 * 'open-downloads' - Open downloads folder in Finder/Explorer
 * 'open-file' - Open file in default application
 * 'show-file-in-folder' - Reveal file in Finder/Explorer
 * 'get-files-stats' - Get file/folder stats with folder expansion
 * 'generate-qr' - Generate QR data URL for a string
 * 'get-app-version' - App version (reset-notice gating)
 * 'check-legacy-data-present' - Detect pre-unified state files
 * 'get-file-thumbnail' - Image src or OS-native icon for a file
 * 'get-debug' - Get current debug state
 * 'set-debug' - Set debug state (persists to config)
 * IPC EVENTS SENT (to renderer):
 * 'peer-connected' - Peer joined (upload) or download starting
 * 'peer-disconnected' - Peer left
 * 'upload-progress' - Transfer progress update
 * 'upload-complete' - Transfer finished
 * 'files-downloaded' - Download complete with file list
 * 'drives-updated' - Drive added/removed/changed
 * 'download-peer-disconnected' - Sender went offline during download
 * EXTERNAL CALLS:
 * lib/hyperdrive-manager.js (manager singleton) - Single source of truth for drives
 * lib/downloader.js (downloadFromDrive)
 * lib/file-utils.js (formatBytes, formatSpeed)
 * lib/logger.js (createLogger, loadConfig, setDebug)
 * KEY STATE:
 * mainWindow - BrowserWindow instance
 * APP_DATA_DIR - ~/peardrop
 * DOWNLOADS_DIR - ~/peardrop/downloads
 * PLATFORM SUPPORT:
 * macOS: Full glassmorphism, traffic lights, vibrancy
 * Windows: Standard title bar, solid background
 * Linux: Standard title bar, solid background
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { join } = path;
const fs = require('fs').promises;
const os = require('os');

// Hyperdrive manager for file sharing (🔒 SACRED core + UI interface)
const { manager: hyperdriveManager, DriveState } = require('./lib/hyperdrive-manager');
// Download orchestration (✅ SAFE to modify)
const { downloadFromDrive } = require('./lib/downloader');
// Utilities
const { formatBytes, formatSpeed, normalizeUserPath } = require('./lib/file-utils');
const { EngineError } = require('./lib/engine-errors');
// Debug logging
const { createLogger, loadConfig: loadDebugConfig, setDebug, isDebugEnabled } = require('./lib/logger');
const log = createLogger('PearDrop');

// Platform detection
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const isLinux = process.platform === 'linux';

let mainWindow;

// SINGLE INSTANCE LOCK (added 2026-07-03): two instances fight over the same
// corestore fd locks ("File descriptor could not be locked"), which used to
// make drives fail to resume. Second instance exits immediately and focuses
// the first.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    console.log('[PearDrop] Another instance is already running - exiting');
    app.exit(0);
}
app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

// App configuration
const APP_DATA_DIR = join(os.homedir(), 'peardrop');
const DOWNLOADS_DIR = join(APP_DATA_DIR, 'downloads');
const WINDOW_STATE_FILE = join(APP_DATA_DIR, 'window-state.json');

// ============================================================================
// Window state persistence — remembers the last window size/position/
// maximized state so mobile-UI vs desktop-UI (a purely size-based decision)
// stays consistent across sessions.
// ============================================================================
let windowStateSaveTimer = null;

function loadWindowState() {
    try {
        const raw = require('fs').readFileSync(WINDOW_STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
            return parsed;
        }
    } catch { /* missing / corrupt / first launch */ }
    return null;
}

function saveWindowState() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        const isMaximized = mainWindow.isMaximized();
        const bounds = isMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
        require('fs').writeFileSync(WINDOW_STATE_FILE, JSON.stringify({
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
            isMaximized
        }, null, 2));
    } catch (err) {
        console.error('[PearDrop] Failed to save window state:', err.message);
    }
}

function scheduleWindowStateSave() {
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = setTimeout(saveWindowState, 300);
}

// ============================================================================
// Window Management
// ============================================================================

function createWindow() {
    // Restore last-session window bounds if we have them.
    const savedState = loadWindowState();

    // Platform-specific window options.
    // NOTE: max width/height intentionally NOT set — Amir's UI depends on
    // being able to stretch into desktop-UI (sidebar appears at >= 600px).
    // minWidth kept small so the mobile-UI still fits comfortably.
    const windowOptions = {
        width: savedState?.width || 415,
        height: savedState?.height || 830,
        ...(savedState && typeof savedState.x === 'number' && typeof savedState.y === 'number'
            ? { x: savedState.x, y: savedState.y }
            : {}),
        minWidth: 380,
        minHeight: 450,
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
            backgroundColor: '#000000',
            // Frame is default true on Windows/Linux
            autoHideMenuBar: true  // Hide menu bar but allow Alt to show it
        });
    }

    mainWindow = new BrowserWindow(windowOptions);

    // Load main interface
    mainWindow.loadFile('index.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();

        // First launch (no saved state): position on right side of primary
        // display. On subsequent launches, respect the restored x/y.
        if (!savedState) {
            const { screen } = require('electron');
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width: screenWidth } = primaryDisplay.workAreaSize;
            const [winWidth] = mainWindow.getSize();
            mainWindow.setPosition(screenWidth - winWidth - 20, 80);
        } else if (savedState.isMaximized) {
            mainWindow.maximize();
        }
    });

    // Persist window size/position — debounced during interaction, saved
    // definitively on close.
    mainWindow.on('resize', scheduleWindowStateSave);
    mainWindow.on('move', scheduleWindowStateSave);
    mainWindow.on('maximize', saveWindowState);
    mainWindow.on('unmaximize', saveWindowState);
    mainWindow.on('close', saveWindowState);

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
            // Sanitize incoming paths at the boundary. Renderer-provided paths
            // may carry file:// prefixes or drag-and-drop artifacts; normalize
            // once here so downstream code can assume clean absolute paths.
            const safeFiles = (files || []).map(f => {
                if (!f || typeof f.path !== 'string') return f;
                try {
                    return { ...f, path: normalizeUserPath(f.path) };
                } catch (err) {
                    throw new Error(`Invalid path for "${f.name || f.path}": ${err.message}`);
                }
            });

            const result = await hyperdriveManager.createDrive(safeFiles, {
                ttlMs: options.ttlMs || 0,
                name: options.name
            });
            
            console.log('[PearDrop] Share created:', result.shareLink);

            // Calculate total bytes from files
            const totalBytes = safeFiles.reduce((sum, f) => sum + (f.size || 0), 0);
            const shareName = options.name || (safeFiles.length === 1 ? safeFiles[0].name : `${safeFiles.length} files`);

            // Add to drives state (single source of truth for UI)
            const driveEntry = await hyperdriveManager.addDriveEntry({
                id: result.driveId,
                key: result.key,
                shareLink: result.shareLink,
                name: shareName,
                files: safeFiles.map(f => ({
                    name: f.name,
                    path: f.path,
                    size: f.size
                })),
                totalBytes: totalBytes,
                localPath: safeFiles[0]?.path ? path.dirname(safeFiles[0].path) : null,
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

    // Quick local-only duplicate check (fast, no network)
    ipcMain.handle('hyperdrive-check-duplicate', async (event, { shareLink }) => {
        const driveKey = shareLink.replace('peardrop://', '').toLowerCase();
        const existingDrive = hyperdriveManager.getDriveEntryByKey(driveKey);
        
        if (existingDrive) {
            const localAvailable = await hyperdriveManager.checkLocalAvailability(existingDrive.id);
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
                const existingDrive = hyperdriveManager.getDriveEntryByKey(driveKey);
                
                if (existingDrive) {
                    // Check if local files still exist
                    const localAvailable = await hyperdriveManager.checkLocalAvailability(existingDrive.id);
                    
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
                peerConnected: result.peerConnected,
                truncated: result.truncated
            };
        } catch (error) {
            console.error('[PearDrop] Open failed:', error);
            // Receive-path handler: attach structured errorDetail alongside the
            // legacy string `error` so renderers keep working while future code
            // can branch on errorDetail.category. Non-EngineError caught here
            // (e.g. programmer bugs) get no errorDetail rather than a fake one.
            return {
                success: false,
                error: error.message,
                ...(error instanceof EngineError ? { errorDetail: error.toJSON() } : {}),
            };
        }
    });

    // Download files from an opened drive
    // Uses lib/downloader.js (✅ SAFE module - can be modified without touching sacred code)
    ipcMain.handle('hyperdrive-download', async (event, { driveId, destDir, fileNames }) => {
        try {
            const session = hyperdriveManager.activeDrives.get(driveId);
            if (!session) {
                throw new EngineError({
                    category: 'receive.no-session',
                    cause: 'session-not-found',
                    message: 'Session not found',
                });
            }

            const downloadPath = destDir || DOWNLOADS_DIR;

            console.log('[PearDrop] Download starting via downloader module');

            // `fileNames` pass-through for per-file selection.
            // Dormant today — no renderer callsite passes it (verified by
            // grep). When 4E-ui lands and the caller starts sending a subset,
            // the caller should also compute a subset-scoped `totalBytes` so
            // downloader.js's byte-percent tracks the selection instead of the
            // whole-drive total. Passing `session.totalBytes` unchanged today
            // is correct because `fileNames` is absent.
            const result = await downloadFromDrive(session.drive, {
                destDir: downloadPath,
                totalBytes: session.totalBytes || 0,
                shareName: session.shareName,
                fileNames,
                
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
            
            // Add to drives state (single source of truth)
            const driveEntry = await hyperdriveManager.addDriveEntry({
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
            // Receive-path handler: attach structured errorDetail when the
            // error is typed. See hyperdrive-open handler above for the
            // rationale (renderer keeps its string `error` field; new code
            // can branch on errorDetail.category).
            return {
                success: false,
                error: error.message,
                ...(error instanceof EngineError ? { errorDetail: error.toJSON() } : {}),
            };
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

    // ========================================================================
    // Drive list — backed by HyperdriveManager + drives-state.json
    // ========================================================================

    // Get single drive by ID (used by drive-actions.js for open/show-in-folder)
    ipcMain.handle('drive-get', async (event, { id }) => {
        try {
            const drive = hyperdriveManager.getDriveEntry(id);
            if (!drive) {
                return { success: false, error: 'Drive not found' };
            }
            return { success: true, drive };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Get all drives
    ipcMain.handle('drives-list', async () => {
        try {
            const drives = hyperdriveManager.getAllDriveEntries();
            return { success: true, drives };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Pause seeding (keep drive, stop network)
    ipcMain.handle('drives-pause', async (event, { id } = {}) => {
        try {
            if (!id) {
                console.warn('[PearDrop] drives-pause called without id');
                return { success: false, error: 'Missing drive id' };
            }
            console.log('[PearDrop] Pausing drive', { id });

            // Stop the hyperdrive but keep storage
            const session = hyperdriveManager.activeDrives.get(id);
            if (session) {
                await hyperdriveManager.stopDrive(id, { delete: false });
            }

            // Update drive state
            const entry = await hyperdriveManager.pauseDriveEntry(id);
            if (!entry) {
                // Previously returned success:true with a null entry — a silent no-op
                return { success: false, error: 'Drive not found' };
            }
            return { success: true, entry };
        } catch (error) {
            console.error('[PearDrop] Failed to pause drive:', error);
            return { success: false, error: error.message };
        }
    });

    // Resume seeding — actually re-opens the drive and rejoins the swarm
    // (was a state-flip-only stub with a TODO until 2026-07-03)
    ipcMain.handle('drives-resume', async (event, { id } = {}) => {
        try {
            if (!id) {
                console.warn('[PearDrop] drives-resume called without id');
                return { success: false, error: 'Missing drive id' };
            }
            console.log('[PearDrop] Resuming drive', { id });
            const entry = await hyperdriveManager.resumeDrive(id);
            if (!entry) {
                return { success: false, error: 'Drive not found' };
            }
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
                await hyperdriveManager.stopDrive(id, { delete: true });
            }
            
            // Remove via drive state (handles storage + optional file deletion)
            const success = await hyperdriveManager.removeDriveEntry(id, { 
                deleteFiles, 
                deleteStorage: true 
            });
            
            console.log('[DEBUG] removeDriveEntry result:', {
                id,
                success,
                mainWindowExists: !!mainWindow,
                mainWindowDestroyed: mainWindow?.isDestroyed()
            });
            
            // Notify renderer (send event even if entry was already removed from manifest)
            if (mainWindow && !mainWindow.isDestroyed()) {
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
    // App version — used by the one-time reset notice in the renderer to
    // detect upgrade-across-fix-boundary scenarios.
    // ========================================================================
    ipcMain.handle('get-app-version', async () => {
        return app.getVersion();
    });

    // ========================================================================
    // File thumbnail — lazy thumbnail provider for the expanded drive items.
    //   * Images → return the file:// URL directly so the renderer can <img>
    //     it. No file read, no encoding, instant.
    //   * Anything else → app.getFileIcon returns the OS-native icon
    //     (Mac/Win/Linux). Encoded as data: URL.
    //   * Failures → return { kind: 'none' } so the renderer keeps the
    //     emoji fallback.
    // ========================================================================
    ipcMain.handle('get-file-thumbnail', async (event, payload) => {
        const filePath = payload && payload.path;
        try {
            if (!filePath) return { kind: 'none', src: null };

            const ext = path.extname(filePath).toLowerCase();
            const imageExts = new Set([
                '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico', '.apng'
            ]);

            if (imageExts.has(ext)) {
                // Electron renderers can load file:// URLs directly into <img>
                const url = 'file:///' + filePath.replace(/\\/g, '/');
                return { kind: 'image', src: url };
            }

            const icon = await app.getFileIcon(filePath, { size: 'normal' });
            return { kind: 'icon', src: icon.toDataURL() };
        } catch (error) {
            return { kind: 'none', src: null, error: error.message };
        }
    });

    // ========================================================================
    // Legacy data detection — fallback for the one-time "share history was
    // reset" notice when localStorage has no lastSeenVersion yet (i.e. the
    // first launch after this build ships). Returns true if any pre-unified
    // state file is on disk (drives.json or drives-manifest.json), meaning
    // the user ran an older build that lost data to the purge-on-close bug.
    // Safe to remove together with the notice once retired.
    // ========================================================================
    ipcMain.handle('check-legacy-data-present', async () => {
        const os = require('os');
        const path = require('path');
        const fs = require('fs').promises;
        const candidates = [
            path.join(os.homedir(), 'peardrop', 'drives.json'),
            path.join(os.homedir(), 'peardrop', 'drives-manifest.json')
        ];
        for (const file of candidates) {
            try {
                await fs.access(file);
                return { present: true };
            } catch { /* missing — try next */ }
        }
        return { present: false };
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

        for (const rawPath of filePaths) {
            let filePath;
            try {
                filePath = normalizeUserPath(rawPath);
            } catch (err) {
                console.error('[PearDrop] Skipping invalid path:', rawPath, err.message);
                continue;
            }

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
        
        // Set up event listeners BEFORE init() so we catch events during drive resume
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
            // (no console.log here — ProgressTracker already logs 10% steps)
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
        
        // Drive ready to download - resumed drive connected and ready to continue
        hyperdriveManager.on('drive-ready-to-download', (data) => {
            console.log('[PearDrop] Received drive-ready-to-download event, forwarding to renderer', { driveId: data.driveId });
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('drive-ready-to-download', data);
            }
        });

        // Resume-failure signal. The manager emits this from _resumeActiveDrives
        // when a per-drive hydrate throws. The manifest state is deliberately
        // NOT flipped to ERRORED (see hyperdrive-manager.js:1420-1424), so the
        // renderer needs this signal to tell the truth about "tracked but not
        // actually running" drives. The event goes out as a distinct IPC
        // channel for runtime/future-proofing; the boot-time snapshot also
        // travels in the `drives-updated action:'loaded'` payload below.
        hyperdriveManager.on('drive-resume-failed', (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('drive-resume-failed', data);
            }
        });
        
        // Initialize Hyperdrive manager with clean, accurate manifest (after event listeners are set up)
        await hyperdriveManager.init();
        
        // Notify frontend that drives have been loaded. Include the boot
        // snapshot of resumeErrors so drives that failed to hydrate can be
        // rendered as `inactive` on first paint — otherwise their manifest
        // state (which stays `active`/`seeking` by design) would silently
        // render them as "Sharing". See status-mapping.js for the merge rule.
        if (mainWindow && !mainWindow.isDestroyed()) {
            const drives = hyperdriveManager.getAllDriveEntries();
            const resumeErrors = {};
            for (const [id, info] of hyperdriveManager.resumeErrors) {
                resumeErrors[id] = { error: info.error, at: info.at };
            }
            mainWindow.webContents.send('drives-updated', {
                action: 'loaded',
                drives: drives,
                resumeErrors
            });
            console.log('[PearDrop] Notified frontend of loaded drives:', drives.length,
                Object.keys(resumeErrors).length ? `(${Object.keys(resumeErrors).length} resume failure(s))` : '');
        }
        
        console.log('[PearDrop] Ready');
        
    } catch (error) {
        console.error('[PearDrop] Startup failed:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('Startup Error', error.message);
        app.quit();
    }
});

app.on('window-all-closed', async () => {
    // Disconnect from network only — persistState:false leaves each drive's
    // manifest state untouched so shares auto-resume + re-announce on next boot
    try {
        await hyperdriveManager.stopAll({ delete: false, persistState: false });
        console.log('[PearDrop] Disconnected from network');
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

// Electron does NOT await async before-quit handlers, so a naive `await` here
// races the process exit and can leave corestores half-closed (lock files,
// partial writes). Instead: cancel the first quit, run cleanup to completion,
// then re-issue the quit — guarded so we only intercept once.
let cleanupDone = false;
let cleanupInProgress = false;
app.on('before-quit', (event) => {
    if (cleanupDone) return; // second pass: let the real quit proceed
    event.preventDefault();
    if (cleanupInProgress) return;
    cleanupInProgress = true;
    (async () => {
        try {
            // persistState:false — shutdown must not demote drives to PAUSED
            await hyperdriveManager.stopAll({ delete: false, persistState: false });
            console.log('[PearDrop] Drives closed cleanly on quit');
        } catch (error) {
            console.error('[PearDrop] Cleanup error:', error);
        } finally {
            cleanupDone = true;
            app.quit();
        }
    })();
});
