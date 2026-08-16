/**
 * MODULE: preload.js
 * PURPOSE: Secure IPC bridge between renderer and main process
 * VERSION: 0.19.1
 * EXPORTS (via window.electronAPI):
 *   INVOKE (renderer -> main):
 *     Hyperdrive:
 * hyperdriveShare(data) - Create share from files
 * hyperdriveCheckDuplicate(data) - Fast local duplicate check
 * hyperdriveOpen(data) - Open remote drive
 * hyperdriveDownload(data) - Download from opened drive
 *     Drive list (HyperdriveManager + drives-state.json):
 * drivesList() - Get all drives
 * drivesPause(id | {id}) - Pause seeding (keep data)
 * drivesResume(id | {id}) - Resume seeding (rejoins swarm)
 * drivesRemove(id | {id, deleteFiles}) - Remove drive completely
 *     Utilities:
 * openDownloads() - Open downloads folder
 * openFile(filePath) - Open file in default app
 * showFileInFolder(filePath) - Show file in Finder/Explorer
 * driveGet(id) - Get single drive by ID (drive-actions open/show)
 * getFilesStats(paths) - Get file/folder stats
 * generateQr(text) - Generate QR data URL for a string
 * getAppVersion() - Get app version (for reset notice gating)
 * checkLegacyDataPresent() - Detect pre-unified state files
 * getFileThumbnail(filePath) - Image src or OS icon for a file
 *     Debug:
 * getDebug() - Get current debug state
 * setDebug(enabled) - Set debug state (persists to config)
 *   LISTENERS (main -> renderer):
 * onFilesDownloaded(cb) - Download complete
 * onPeerConnected(cb) - Peer joined
 * onPeerDisconnected(cb) - Peer left
 * onUploadProgress(cb) - Transfer progress
 * onUploadComplete(cb) - Transfer complete
 * onDownloadPeerDisconnected(cb) - Sender went offline
 * onDriveReadyToDownload(cb) - Resumed drive ready to continue download
 * onDrivesUpdated(cb) - Drive added/removed/updated
 * EXTERNAL CALLS: Electron contextBridge, ipcRenderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ========================================================================
    // Hyperdrive operations
    // ========================================================================
    hyperdriveShare: (data) => ipcRenderer.invoke('hyperdrive-share', data),
    hyperdriveCheckDuplicate: (data) => ipcRenderer.invoke('hyperdrive-check-duplicate', data),
    hyperdriveOpen: (data) => ipcRenderer.invoke('hyperdrive-open', data),
    hyperdriveDownload: (data) => ipcRenderer.invoke('hyperdrive-download', data),

    // ========================================================================
    // HyperdriveManager - Single source of truth for Shares tab
    // ========================================================================
    drivesList: () => ipcRenderer.invoke('drives-list'),
    // NORMALIZED (2026-07-03): callers historically passed either a bare id
    // string or an {id} object while main always destructures {id} — the
    // mismatch made Pause/Resume silent no-ops ({id: undefined}). The bridge
    // now accepts both shapes so the contract can't silently drift again.
    drivesPause: (idOrData) => ipcRenderer.invoke('drives-pause',
        typeof idOrData === 'string' ? { id: idOrData } : idOrData),
    drivesResume: (idOrData) => ipcRenderer.invoke('drives-resume',
        typeof idOrData === 'string' ? { id: idOrData } : idOrData),
    drivesRemove: (idOrData) => ipcRenderer.invoke('drives-remove',
        typeof idOrData === 'string' ? { id: idOrData } : idOrData),

    // ========================================================================
    // Utilities
    // ========================================================================
    openDownloads: () => ipcRenderer.invoke('open-downloads'),
    openFile: (filePath) => ipcRenderer.invoke('open-file', { filePath }),
    showFileInFolder: (filePath) => ipcRenderer.invoke('show-file-in-folder', { filePath }),
    driveGet: (id) => ipcRenderer.invoke('drive-get', { id }),
    getFilesStats: (filePaths) => ipcRenderer.invoke('get-files-stats', filePaths),
    
    // ========================================================================
    // QR Code
    // ========================================================================
    generateQr: (text) => ipcRenderer.invoke('generate-qr', { text }),

    // ========================================================================
    // One-time reset notice — version + legacy-fallback gating.
    // Safe to remove once the notice is retired.
    // ========================================================================
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    checkLegacyDataPresent: () => ipcRenderer.invoke('check-legacy-data-present'),

    // ========================================================================
    // File thumbnails — used by the expanded drive-item file list.
    // ========================================================================
    getFileThumbnail: (filePath) => ipcRenderer.invoke('get-file-thumbnail', { path: filePath }),

    // ========================================================================
    // Debug Control
    // ========================================================================
    getDebug: () => ipcRenderer.invoke('get-debug'),
    setDebug: (enabled) => ipcRenderer.invoke('set-debug', { enabled }),
    
    // ========================================================================
    // Events (main -> renderer)
    // ========================================================================
    onFilesDownloaded: (callback) => ipcRenderer.on('files-downloaded', callback),
    onPeerConnected: (callback) => ipcRenderer.on('peer-connected', callback),
    onPeerDisconnected: (callback) => ipcRenderer.on('peer-disconnected', callback),
    onUploadProgress: (callback) => ipcRenderer.on('upload-progress', callback),
    onUploadComplete: (callback) => ipcRenderer.on('upload-complete', callback),
    onDownloadPeerDisconnected: (callback) => ipcRenderer.on('download-peer-disconnected', callback),
    onDriveReadyToDownload: (callback) => ipcRenderer.on('drive-ready-to-download', callback),
    onDrivesUpdated: (callback) => ipcRenderer.on('drives-updated', callback),
    // Runtime resume-failure signal (boot-time failures also travel in the
    // drives-updated action:'loaded' payload; this channel exists for post-init
    // failures and future-proofing).
    onDriveResumeFailed: (callback) => ipcRenderer.on('drive-resume-failed', callback)
});
