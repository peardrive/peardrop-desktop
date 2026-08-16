/**
 * MODULE: preload.js
 * PURPOSE: Secure IPC bridge between renderer and main process
 * VERSION: 0.18.0
 * 
 * EXPORTS (via window.electronAPI):
 *   INVOKE (renderer -> main):
 *     Hyperdrive:
 *       - hyperdriveShare(data) - Create share from files
 *       - hyperdriveStop(data) - Stop sharing
 *       - hyperdriveOpen(data) - Open remote drive
 *       - hyperdriveDownload(data) - Download from opened drive
 *       - hyperdriveAbort(data) - Abort pending connection
 *       - hyperdriveStatus() - Get drive stats
 *     
 *     DriveManager (single source of truth):
 *       - drivesList() - Get all drives
 *       - drivesPause(data) - Pause seeding (keep data)
 *       - drivesResume(data) - Resume seeding
 *       - drivesRemove(data) - Remove drive completely
 *       - drivesCheckFiles() - Check local file availability
 *       - driveGet(id) - Get drive info by ID
 *     
 *     Utilities:
 *       - openDownloads() - Open downloads folder
 *       - openFile(filePath) - Open file in default app
 *       - showFileInFolder(filePath) - Show file in Finder/Explorer
 *       - getFilesStats(paths) - Get file/folder stats
 *     
 *     Debug:
 *       - getDebug() - Get current debug state
 *       - setDebug(enabled) - Set debug state (persists to config)
 * 
 *   LISTENERS (main -> renderer):
 *     - onFilesDownloaded(cb) - Download complete
 *     - onPeerConnected(cb) - Peer joined
 *     - onPeerDisconnected(cb) - Peer left
 *     - onUploadProgress(cb) - Transfer progress
 *     - onUploadComplete(cb) - Transfer complete
 *     - onDownloadProgress(cb) - Download progress
 *     - onDownloadPeerDisconnected(cb) - Sender went offline
 *     - onDrivesUpdated(cb) - Drive added/removed/updated
 * 
 * EXTERNAL CALLS: Electron contextBridge, ipcRenderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // ========================================================================
    // Hyperdrive operations
    // ========================================================================
    hyperdriveShare: (data) => ipcRenderer.invoke('hyperdrive-share', data),
    hyperdriveStop: (data) => ipcRenderer.invoke('hyperdrive-stop', data),
    hyperdriveCheckDuplicate: (data) => ipcRenderer.invoke('hyperdrive-check-duplicate', data),
    hyperdriveOpen: (data) => ipcRenderer.invoke('hyperdrive-open', data),
    hyperdriveDownload: (data) => ipcRenderer.invoke('hyperdrive-download', data),
    hyperdriveAbort: (data) => ipcRenderer.invoke('hyperdrive-abort', data || {}),
    hyperdriveStatus: () => ipcRenderer.invoke('hyperdrive-status'),
    
    // ========================================================================
    // DriveManager - Single source of truth for Shares tab
    // ========================================================================
    drivesList: () => ipcRenderer.invoke('drives-list'),
    drivesPause: (data) => ipcRenderer.invoke('drives-pause', data),
    drivesResume: (data) => ipcRenderer.invoke('drives-resume', data),
    drivesRemove: (data) => ipcRenderer.invoke('drives-remove', data),
    drivesCheckFiles: () => ipcRenderer.invoke('drives-check-files'),
    
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
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', callback),
    onDownloadPeerDisconnected: (callback) => ipcRenderer.on('download-peer-disconnected', callback),
    onDrivesUpdated: (callback) => ipcRenderer.on('drives-updated', callback)
});
