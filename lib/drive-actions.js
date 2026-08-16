/**
 * MODULE: drive-actions.js
 * PURPOSE: Maps DriveItem UI actions to system calls
 * VERSION: 1.0.0
 * ARCHITECTURE:
 *   DriveItem (UI) → emits action → DriveActions → calls API → main.js IPC → HyperdriveManager/shell
 *   This module bridges UI events and system operations without either knowing about the other.
 *   DriveItem stays pure (no Electron deps), HyperdriveManager stays data-focused.
 * EXPORTS:
 * handleAction(api, action, data) - Main entry point for all actions
 * DriveActions class - For apps that want instance-based usage
 * ACTIONS HANDLED:
 * open: Open file in default app
 * show-files: Show file in Finder/Explorer
 * remove: Remove drive from manager
 * pause: Pause drive (stop network, keep data)
 * resume: Resume paused drive
 * more-info: Get drive metadata (returns data, UI handles display)
 * tip: Get tip address (returns address, UI handles Lightning flow)
 * API INTERFACE REQUIRED:
 *   The `api` parameter must implement:
 * driveGet(id) → { success, drive }
 * drivesRemove({ id, deleteFiles }) → { success }
 * drivesPause(id) → { success }
 * drivesResume(id) → { success }
 * openFile(filePath) → { success }
 * showFileInFolder(filePath) → { success }
 * openDownloads() → { success }
 * USAGE:
 *   // Functional style
 *   import { handleAction } from './drive-actions.js';
 *   item.on('action', (e) => handleAction(window.electronAPI, e.action, e.data));
 *   // Class style
 *   import { DriveActions } from './drive-actions.js';
 *   const actions = new DriveActions(window.electronAPI);
 *   item.on('action', (e) => actions.handle(e.action, e.data));
 * EXTERNAL CALLS:
 * api.driveGet, api.drivesRemove, api.drivesPause, api.drivesResume
 * api.openFile, api.showFileInFolder, api.openDownloads
 */

(function(global, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    // CommonJS
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    // AMD
    define(factory);
  } else {
    // Browser global
    global.DriveActions = factory().DriveActions;
    global.handleDriveAction = factory().handleAction;
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  /**
   * Get file path from drive info
   * @private
   */
  function getFilePath(drive) {
    if (!drive) return null;
    
    // Try direct file path first
    if (drive.files?.[0]?.path) {
      return drive.files[0].path;
    }
    
    // Try constructing from localPath + filename
    if (drive.localPath && drive.files?.[0]?.name) {
      return `${drive.localPath}/${drive.files[0].name}`;
    }
    
    // Try localPath alone (for folders)
    if (drive.localPath) {
      return drive.localPath;
    }
    
    return null;
  }

  /**
   * Open file in default application
   */
  async function openFile(api, data) {
    try {
      const result = await api.driveGet(data.id);
      if (!result.success || !result.drive) {
        return { success: false, error: 'Drive not found' };
      }
      
      const filePath = getFilePath(result.drive);
      if (filePath) {
        return await api.openFile(filePath);
      } else {
        // Fallback to downloads folder
        return await api.openDownloads();
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Show file in Finder/Explorer
   */
  async function showFiles(api, data) {
    try {
      const result = await api.driveGet(data.id);
      if (!result.success || !result.drive) {
        // Fallback to downloads folder
        return await api.openDownloads();
      }
      
      const filePath = getFilePath(result.drive);
      if (filePath) {
        return await api.showFileInFolder(filePath);
      } else {
        return await api.openDownloads();
      }
    } catch (err) {
      // Fallback to downloads folder
      return await api.openDownloads();
    }
  }

  /**
   * Remove drive from manager
   */
  async function remove(api, data, options = {}) {
    try {
      return await api.drivesRemove({ 
        id: data.id, 
        deleteFiles: options.deleteFiles || false 
      });
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Pause drive (stop network, keep data)
   */
  async function pause(api, data) {
    try {
      return await api.drivesPause(data.id);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Resume paused drive
   */
  async function resume(api, data) {
    try {
      return await api.drivesResume(data.id);
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Get drive info (for more-info panel)
   */
  async function getInfo(api, data) {
    try {
      const result = await api.driveGet(data.id);
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Handle tip action (returns tip address for UI to handle)
   */
  function getTipAddress(data) {
    return {
      success: !!data.tipAddress,
      tipAddress: data.tipAddress || null
    };
  }

  /**
   * Main action handler - functional style
   * @param {Object} api - API interface (e.g., window.electronAPI)
   * @param {string} action - Action name from DriveItem
   * @param {Object} data - Drive data from DriveItem
   * @param {Object} options - Optional action-specific options
   * @returns {Promise<Object>} Result with success boolean
   */
  async function handleAction(api, action, data, options = {}) {
    switch (action) {
      case 'open':
        return openFile(api, data);
      
      case 'show-files':
        return showFiles(api, data);
      
      case 'remove':
        return remove(api, data, options);
      
      case 'pause':
        return pause(api, data);
      
      case 'resume':
        return resume(api, data);
      
      case 'more-info':
        return getInfo(api, data);
      
      case 'tip':
        return getTipAddress(data);
      
      default:
        console.warn('[DriveActions] Unknown action:', action);
        return { success: false, error: `Unknown action: ${action}` };
    }
  }

  /**
   * DriveActions class - for apps that prefer instance-based usage
   */
  class DriveActions {
    constructor(api) {
      this.api = api;
    }

    async handle(action, data, options = {}) {
      return handleAction(this.api, action, data, options);
    }

    // Convenience methods
    async open(data) { return openFile(this.api, data); }
    async showFiles(data) { return showFiles(this.api, data); }
    async remove(data, opts) { return remove(this.api, data, opts); }
    async pause(data) { return pause(this.api, data); }
    async resume(data) { return resume(this.api, data); }
    async getInfo(data) { return getInfo(this.api, data); }
  }

  // Export
  return {
    handleAction,
    DriveActions,
    // Individual handlers for direct use
    openFile,
    showFiles,
    remove,
    pause,
    resume,
    getInfo,
    getTipAddress
  };
}));
