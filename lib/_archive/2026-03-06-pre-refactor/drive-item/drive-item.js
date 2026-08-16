/**
 * DriveItem - Standalone drive display component
 * 
 * @module DriveItem
 * @version 0.1.0
 * 
 * EXPORTS:
 *   - DriveItem (class) - Main component class
 * 
 * DEPENDENCIES:
 *   - None (zero external dependencies)
 *   - Optional: ProgressBar module for download progress
 * 
 * USAGE:
 *   const item = new DriveItem(container, {
 *     data: { title: 'My Drive', size: 1024000, ... },
 *     show: ['title', 'size', 'status', 'progress'],
 *     theme: 'dark'
 *   });
 *   
 *   item.update({ progress: 0.75, speed: 125000 });
 *   item.setVisibility(['title', 'progress', 'peers']);
 *   item.setTheme('light');
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DriveItem = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // ==================== CONSTANTS ====================

  const VERSION = '0.1.0';

  // All available fields
  const FIELDS = [
    'title',
    'size',
    'fileCount',
    'status',      // Full text badge (e.g., "Downloading")
    'statusIcon',  // Compact icon badge (e.g., ↓ with animation)
    'progress',
    'speed',
    'peers',
    'thumbnail',
    'path',
    'creator',
    'tipAddress'
  ];

  // Preset visibility configurations
  const PRESETS = {
    all: FIELDS.filter(f => f !== 'path' && f !== 'statusIcon'), // path hidden by default
    minimal: ['title', 'status'],
    minimalCompact: ['title', 'statusIcon'],
    compact: ['title', 'size', 'status'],
    compactIcon: ['title', 'size', 'statusIcon'],
    download: ['title', 'size', 'progress', 'speed', 'status'],
    downloadCompact: ['title', 'size', 'progress', 'speed', 'statusIcon'],
    share: ['title', 'size', 'fileCount', 'peers', 'status'],
    shareCompact: ['title', 'size', 'fileCount', 'peers', 'statusIcon'],
    full: ['title', 'thumbnail', 'size', 'fileCount', 'status', 'progress', 'speed', 'peers', 'creator', 'tipAddress']
  };

  // Status labels, colors, and compact icons
  const STATUS_CONFIG = {
    sharing: { 
      label: 'Sharing', 
      color: 'var(--di-status-sharing, #22c55e)',
      icon: '↑',
      animate: 'pulse'
    },
    downloading: { 
      label: 'Downloading', 
      color: 'var(--di-status-downloading, #3b82f6)',
      icon: '↓',
      animate: 'bounce'
    },
    paused: { 
      label: 'Paused', 
      color: 'var(--di-status-paused, #eab308)',
      icon: '⏸',
      animate: null,
      dimItem: true  // Grey out the whole item
    },
    inactive: { 
      label: 'Inactive', 
      color: 'var(--di-status-inactive, #6b7280)',
      icon: null,  // No icon in compact mode
      animate: null
    },
    missing: { 
      label: 'Missing', 
      color: 'var(--di-status-missing, #ef4444)',
      icon: '!',
      animate: null
    },
    complete: { 
      label: 'Complete', 
      color: 'var(--di-status-complete, #22c55e)',
      icon: '✓',
      animate: null
    },
    connecting: {
      label: 'Connecting',
      color: 'var(--di-status-connecting, #3b82f6)',
      icon: '↓',
      animate: 'pulse'
    }
  };

  // Default menu items (only pause/resume get icons)
  const DEFAULT_MENU_ITEMS = [
    { id: 'pause', label: 'Pause', icon: '⏸', showWhen: (data) => data.status === 'downloading' || data.status === 'sharing' },
    { id: 'resume', label: 'Resume', icon: '▶', showWhen: (data) => data.status === 'paused' },
    { id: 'open', label: 'Open' },
    { id: 'show-files', label: 'Show Files' },
    { id: 'more-info', label: 'More Info' },
    { id: 'tip', label: 'Send Tip', showWhen: (data) => !!data.tipAddress },
    { id: 'divider' },
    { id: 'remove', label: 'Remove', danger: true, confirm: true }
  ];

  // Default theme (CSS custom properties)
  const DEFAULT_THEME = {
    // Container
    '--di-bg': 'rgba(255, 255, 255, 0.06)',
    '--di-bg-hover': 'rgba(255, 255, 255, 0.09)',
    '--di-border': 'rgba(255, 255, 255, 0.08)',
    '--di-radius': '10px',
    '--di-padding': '12px 14px',
    '--di-shadow': '0 1px 2px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.1)',
    '--di-shadow-inset': 'inset 0 1px 0 rgba(255,255,255,0.05)',
    
    // Text
    '--di-text': '#e0e0e0',
    '--di-text-secondary': 'rgba(255, 255, 255, 0.6)',
    '--di-text-size': '14px',
    '--di-text-size-small': '12px',
    
    // Thumbnail
    '--di-thumb-size': '40px',
    '--di-thumb-radius': '6px',
    '--di-thumb-bg': 'linear-gradient(135deg, #4a9eff, #7c3aed)',
    
    // Progress bar
    '--di-progress-bg': 'rgba(255, 255, 255, 0.1)',
    '--di-progress-fill': '#4a9eff',
    '--di-progress-height': '4px',
    '--di-progress-radius': '2px',
    
    // Status badge
    '--di-badge-padding': '4px 8px',
    '--di-badge-radius': '4px',
    '--di-badge-size': '11px'
  };

  // Light theme override
  const LIGHT_THEME = {
    '--di-bg': 'rgba(255, 255, 255, 0.8)',
    '--di-bg-hover': 'rgba(255, 255, 255, 0.95)',
    '--di-border': 'rgba(0, 0, 0, 0.08)',
    '--di-shadow': '0 1px 2px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.05)',
    '--di-shadow-inset': 'inset 0 1px 0 rgba(255,255,255,0.8)',
    '--di-text': '#333',
    '--di-text-secondary': 'rgba(0, 0, 0, 0.5)',
    '--di-progress-bg': 'rgba(0, 0, 0, 0.1)'
  };

  // ==================== UTILITIES ====================

  function formatBytes(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatSpeed(bytesPerSec) {
    if (bytesPerSec == null || bytesPerSec === 0) return '';
    
    const k = 1024;
    
    // Bytes - rare but handle it
    if (bytesPerSec < k) {
      return Math.round(bytesPerSec) + ' B/s';
    }
    
    // KB range
    const kb = bytesPerSec / k;
    if (kb < 100) {
      // Under 100 KB - show 1 decimal
      return kb.toFixed(1) + ' KB/s';
    }
    if (kb < 1000) {
      // 100-999 KB - no decimal
      return Math.round(kb) + ' KB/s';
    }
    
    // MB range
    const mb = bytesPerSec / (k * k);
    if (mb < 10) {
      // 1-9.99 MB - 2 decimals
      return mb.toFixed(2) + ' MB/s';
    }
    if (mb < 100) {
      // 10-99 MB - 1 decimal
      return mb.toFixed(1) + ' MB/s';
    }
    
    // 100+ MB - no decimal
    return Math.round(mb) + ' MB/s';
  }

  function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function truncateMiddle(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    const half = Math.floor((maxLen - 3) / 2);
    return str.slice(0, half) + '...' + str.slice(-half);
  }

  // ==================== DRIVEITEM CLASS ====================

  class DriveItem {
    /**
     * Create a DriveItem
     * @param {HTMLElement|string} container - Container element or selector
     * @param {Object} options - Configuration options
     * @param {Object} options.data - Drive data
     * @param {Array|string} options.show - Fields to show (array or preset name)
     * @param {string|Object} options.theme - Theme name or custom properties
     * @param {Function} options.onAction - Callback for actions (tip, click, etc.)
     * @param {Object} options.progressBar - External ProgressBar instance
     * @param {Array} options.menuItems - Custom menu items (default: DEFAULT_MENU_ITEMS)
     * @param {boolean} options.showMenu - Show kebab menu button (default: true)
     * @param {boolean} options.autoTransitionToSharing - Auto-transition completed downloads to sharing (default: true)
     * @param {number} options.transitionDelay - Delay in ms before transition (default: 30000)
     */
    constructor(container, options = {}) {
      // Resolve container
      if (typeof container === 'string') {
        this.container = document.querySelector(container);
      } else {
        this.container = container;
      }

      if (!this.container) {
        throw new Error('DriveItem: container not found');
      }

      // Initialize state
      this._data = this._normalizeData(options.data || {});
      this._visible = this._resolveVisibility(options.show || 'compact');
      this._theme = options.theme || 'dark';
      this._customTheme = {};
      this._listeners = {};
      this._progressBar = options.progressBar || null;
      this._onAction = options.onAction || null;
      this._menuItems = options.menuItems || DEFAULT_MENU_ITEMS;
      this._showMenu = options.showMenu !== false;
      this._menuOpen = false;
      this._longPressTimer = null;
      
      // Auto-transition from completed download to sharing
      this._autoTransition = options.autoTransitionToSharing !== false;
      this._transitionDelay = options.transitionDelay || 30000; // 30 seconds
      this._transitionTimer = null;
      this._isTransitioning = false;
      
      // Auto-clear cache after extended inactivity
      this._autoClearCache = options.autoClearCache !== false;
      this._clearCacheDelay = options.clearCacheDelay || 600000; // 10 minutes
      this._clearCacheTimer = null;

      // Create element
      this._element = null;
      this._backdrop = null;
      this._injectStyles();
      this._render();
    }

    // ==================== PUBLIC API ====================

    /**
     * Update drive data
     * @param {Object} data - Partial data to update
     */
    update(data) {
      const prevStatus = this._data.status;
      const prevPeers = this._data.peers;
      const prevSpeed = this._data.speed;
      
      // Merge with existing data first
      const merged = { ...this._data, ...data };
      
      // Normalize and derive status from merged state
      this._data = this._normalizeData(merged, data.status);
      this._render();
      this._emit('update', this._data);
      
      // Handle auto-transition from complete to sharing
      if (this._autoTransition && this._data.status === 'complete' && prevStatus !== 'complete') {
        this._startTransitionToSharing();
      }
      
      // Handle upload idle detection
      if (this._autoTransition && this._data.type === 'upload') {
        const wasActive = prevPeers > 0 || prevSpeed > 0;
        const isIdle = this._data.peers === 0 && this._data.speed === 0;
        
        if (wasActive && isIdle && this._data.status !== 'inactive') {
          // Activity just stopped, start idle timeout
          this._startIdleTimeout();
        } else if (!isIdle) {
          // Activity resumed, cancel both idle and cache clear timers
          this._cancelIdleTimeout();
          this._cancelClearCacheTimer();
        }
      }
      
      return this;
    }

    /**
     * Start the transition from completed download to sharing mode
     */
    _startTransitionToSharing() {
      if (this._transitionTimer) {
        clearTimeout(this._transitionTimer);
      }
      
      this._isTransitioning = true;
      this._emit('transition-start', { type: 'download-to-share', delay: this._transitionDelay });
      
      // Add transitioning class for CSS animation with correct duration
      if (this._element) {
        this._element.style.setProperty('--di-transition-duration', `${this._transitionDelay}ms`);
        this._element.classList.add('is-transitioning');
      }
      
      this._transitionTimer = setTimeout(() => {
        this._completeTransition();
      }, this._transitionDelay);
    }

    /**
     * Complete the transition to sharing mode
     */
    _completeTransition() {
      this._isTransitioning = false;
      this._transitionTimer = null;
      
      if (this._element) {
        this._element.classList.remove('is-transitioning');
      }
      
      // Transition: download complete → ready to share (upload type, inactive until peers)
      this._data = {
        ...this._data,
        type: 'upload',
        status: 'inactive', // Will become 'sharing' when peers connect
        progress: null,
        speed: 0,
        peers: 0
      };
      
      this._render();
      this._emit('transition-complete', { type: 'download-to-share', data: this._data });
      
      // Start cache clear timer now that we're inactive
      this._startClearCacheTimer();
    }

    /**
     * Start idle timeout (for uploads with no activity)
     */
    _startIdleTimeout() {
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
      }
      
      this._idleTimer = setTimeout(() => {
        // Fade upload activity indicators to inactive state
        if (this._data.type === 'upload' && this._data.peers === 0 && this._data.speed === 0) {
          this._data.status = 'inactive';
          this._render();
          this._emit('idle', { data: this._data });
          
          // Start cache clear timer now that we're inactive
          this._startClearCacheTimer();
        }
      }, this._transitionDelay);
    }

    /**
     * Cancel idle timeout
     */
    _cancelIdleTimeout() {
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
        this._idleTimer = null;
      }
    }

    /**
     * Start the cache clear timer (after going inactive)
     */
    _startClearCacheTimer() {
      if (!this._autoClearCache) return;
      
      this._cancelClearCacheTimer();
      
      this._clearCacheTimer = setTimeout(() => {
        // Emit event for parent app to handle the actual clearing
        // Parent would call: driveManager.remove(id, { deleteStorage: true, deleteFiles: false })
        // Or a dedicated: driveManager.clearCache(id)
        this._emit('clear-cache', { 
          data: this._data,
          reason: 'inactivity-timeout',
          // Suggested API call:
          api: {
            method: 'driveManager.remove',
            args: [this._data.id, { deleteStorage: true, deleteFiles: false }],
            note: 'Clears hyperdrive corestores, keeps manifest reference for rebuild when peers reconnect'
          }
        });
      }, this._clearCacheDelay);
    }

    /**
     * Cancel the cache clear timer
     */
    _cancelClearCacheTimer() {
      if (this._clearCacheTimer) {
        clearTimeout(this._clearCacheTimer);
        this._clearCacheTimer = null;
      }
    }

    /**
     * Cancel any pending transition
     */
    cancelTransition() {
      if (this._transitionTimer) {
        clearTimeout(this._transitionTimer);
        this._transitionTimer = null;
      }
      this._isTransitioning = false;
      if (this._element) {
        this._element.classList.remove('is-transitioning');
      }
      return this;
    }

    /**
     * Set which fields are visible
     * @param {Array|string} fields - Field names or preset
     */
    setVisibility(fields) {
      this._visible = this._resolveVisibility(fields);
      this._render();
      return this;
    }

    /**
     * Get current visibility
     * @returns {Array} Visible field names
     */
    getVisibility() {
      return [...this._visible];
    }

    /**
     * Set theme
     * @param {string|Object} theme - Theme name or custom properties
     */
    setTheme(theme) {
      if (typeof theme === 'object') {
        this._customTheme = theme;
      } else {
        this._theme = theme;
        this._customTheme = {};
      }
      this._applyTheme();
      return this;
    }

    /**
     * Get current data
     * @returns {Object} Current drive data
     */
    getData() {
      return { ...this._data };
    }

    /**
     * Set external progress bar module
     * @param {Object} progressBar - ProgressBar instance
     */
    setProgressBar(progressBar) {
      this._progressBar = progressBar;
      this._render();
      return this;
    }

    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     */
    on(event, callback) {
      if (!this._listeners[event]) {
        this._listeners[event] = [];
      }
      this._listeners[event].push(callback);
      return this;
    }

    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     */
    off(event, callback) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
      }
      return this;
    }

    /**
     * Get the DOM element
     * @returns {HTMLElement}
     */
    getElement() {
      return this._element;
    }

    /**
     * Destroy the component
     */
    destroy() {
      if (this._element && this._element.parentNode) {
        this._element.parentNode.removeChild(this._element);
      }
      if (this._backdrop && this._backdrop.parentNode) {
        this._backdrop.parentNode.removeChild(this._backdrop);
      }
      if (this._longPressTimer) {
        clearTimeout(this._longPressTimer);
      }
      if (this._transitionTimer) {
        clearTimeout(this._transitionTimer);
      }
      if (this._idleTimer) {
        clearTimeout(this._idleTimer);
      }
      if (this._clearCacheTimer) {
        clearTimeout(this._clearCacheTimer);
      }
      if (this._escapeHandler) {
        document.removeEventListener('keydown', this._escapeHandler);
      }
      this._listeners = {};
      this._element = null;
      this._backdrop = null;
      this._contentArea = null;
      this._menuContainer = null;
    }

    /**
     * Get version
     * @returns {string}
     */
    static get version() {
      return VERSION;
    }

    /**
     * Get available fields
     * @returns {Array}
     */
    static get fields() {
      return [...FIELDS];
    }

    /**
     * Get available presets
     * @returns {Object}
     */
    static get presets() {
      return { ...PRESETS };
    }

    // ==================== PRIVATE METHODS ====================

    _normalizeData(data, explicitStatus) {
      const normalized = {
        id: data.id || data.driveId || null,
        title: data.title || data.name || 'Untitled',
        size: data.size || data.totalBytes || 0,
        fileCount: data.fileCount || data.files || 0,
        status: null, // Will be auto-determined below
        progress: data.progress != null ? data.progress : null, // 0-1 or null
        speed: data.speed || data.downloadSpeed || 0,
        peers: data.peers || data.peerCount || 0,
        thumbnail: data.thumbnail || data.thumb || null,
        path: data.path || data.filePath || null,
        creator: data.creator || data.creatorId || null,
        tipAddress: data.tipAddress || data.lightningAddress || data.lnurl || null,
        type: data.type || 'download' // download | upload
      };
      
      // Use explicit status if provided, otherwise use data.status
      const statusHint = explicitStatus !== undefined ? explicitStatus : data.status;
      
      // Auto-determine status from data
      normalized.status = this._deriveStatus(normalized, statusHint);
      
      return normalized;
    }

    /**
     * Automatically derive status from data state
     * Priority: explicit paused/missing > inferred from activity > explicit status > inactive
     */
    _deriveStatus(data, explicitStatus) {
      let derived = 'inactive';
      
      // Paused and missing are explicit states - user has to set them
      if (explicitStatus === 'paused' || explicitStatus === 'missing') {
        derived = explicitStatus;
      }
      // Complete: progress is 100%
      else if (data.progress != null && data.progress >= 1) {
        derived = 'complete';
      }
      // Actively downloading: download type with speed OR (progress + peers)
      else if (data.type === 'download' && (
        data.speed > 0 || 
        (data.peers > 0 && data.progress != null && data.progress > 0 && data.progress < 1)
      )) {
        derived = 'downloading';
      }
      // Connecting: download with progress started but no speed/peers yet
      else if (data.type === 'download' && data.progress != null && data.progress >= 0 && data.progress < 1) {
        derived = 'connecting';
      }
      // Sharing: upload type with peers connected
      else if (data.type === 'upload' && data.peers > 0) {
        derived = 'sharing';
      }
      // Use explicit status if provided
      else if (explicitStatus && explicitStatus !== 'inactive') {
        derived = explicitStatus;
      }
      
      // Debug logging
      console.log('[DriveItem] _deriveStatus', {
        type: data.type,
        progress: data.progress,
        speed: data.speed,
        peers: data.peers,
        explicitStatus,
        derived
      });
      
      return derived;
    }

    _resolveVisibility(show) {
      if (Array.isArray(show)) {
        return show.filter(f => FIELDS.includes(f));
      }
      if (typeof show === 'string' && PRESETS[show]) {
        return [...PRESETS[show]];
      }
      return [...PRESETS.compact];
    }

    _emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(cb => cb(data));
      }
    }

    _injectStyles() {
      if (document.getElementById('drive-item-styles')) return;
      
      const style = document.createElement('style');
      style.id = 'drive-item-styles';
      style.textContent = `
        .drive-item {
          display: flex;
          align-items: center;
          gap: 12px;
          background: var(--di-bg);
          border: 1px solid var(--di-border);
          border-radius: var(--di-radius);
          padding: var(--di-padding);
          box-shadow: var(--di-shadow), var(--di-shadow-inset);
          color: var(--di-text);
          font-size: var(--di-text-size);
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease, filter 0.2s ease;
        }
        
        .drive-item:hover {
          background: var(--di-bg-hover);
        }
        
        /* Paused state - dim content but NOT the menu */
        .drive-item.is-paused .drive-item-inner {
          opacity: 0.6;
          filter: saturate(0.3);
        }
        
        .drive-item.is-paused .drive-item-title {
          opacity: 0.7;
        }
        
        .drive-item.is-paused .drive-item-progress-fill {
          background: var(--di-status-paused, #eab308);
          opacity: 0.5;
        }
        
        /* Menu button stays fully active when paused - ALWAYS clickable */
        .drive-item.is-paused .drive-item-menu-container {
          opacity: 1 !important;
          filter: none !important;
          pointer-events: auto !important;
        }
        
        .drive-item.is-paused .drive-item-menu-btn {
          opacity: 1 !important;
          pointer-events: auto !important;
          cursor: pointer !important;
        }
        
        /* Transition animation: download complete → sharing */
        /* Progress bar fades first, then container smoothly shrinks */
        .drive-item.is-transitioning .drive-item-progress {
          animation: progress-fade-out var(--di-transition-duration, 30s) ease-out forwards;
        }
        
        @keyframes progress-fade-out {
          0%, 85% { 
            opacity: 1; 
            max-height: 50px;
            margin-top: 4px;
          }
          95% { 
            opacity: 0; 
            max-height: 50px;
            margin-top: 4px;
          }
          100% { 
            opacity: 0; 
            max-height: 0;
            margin-top: 0;
            overflow: hidden;
          }
        }
        
        /* Upload speed indicator */
        .drive-item-upload-speed {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: var(--di-text-size-small);
          color: var(--di-status-sharing, #22c55e);
          font-weight: 500;
        }
        
        .drive-item-upload-speed-arrow {
          animation: upload-pulse 1s ease-in-out infinite;
        }
        
        @keyframes upload-pulse {
          0%, 100% { opacity: 0.6; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-2px); }
        }
        
        .drive-item-thumb {
          flex-shrink: 0;
          width: var(--di-thumb-size);
          height: var(--di-thumb-size);
          border-radius: var(--di-thumb-radius);
          background: var(--di-thumb-bg);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          overflow: hidden;
        }
        
        .drive-item-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        .drive-item-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .drive-item-header {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .drive-item-title {
          font-weight: 500;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
          transition: opacity 0.2s ease;
        }
        
        .drive-item-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: var(--di-text-size-small);
          color: var(--di-text-secondary);
        }
        
        .drive-item-meta-item {
          white-space: nowrap;
        }
        
        .drive-item-meta-divider {
          opacity: 0.5;
        }
        
        .drive-item-progress {
          margin-top: 4px;
          transition: max-height 0.5s ease, margin 0.5s ease, opacity 0.3s ease;
        }
        
        .drive-item-progress-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .drive-item-progress-bar {
          flex: 1;
          height: var(--di-progress-height);
          background: var(--di-progress-bg);
          border-radius: var(--di-progress-radius);
          overflow: hidden;
        }
        
        .drive-item-progress-fill {
          height: 100%;
          background: var(--di-progress-fill);
          border-radius: var(--di-progress-radius);
          transition: width 0.3s ease, background 0.2s ease, opacity 0.2s ease;
        }
        
        .drive-item-progress-speed {
          flex-shrink: 0;
          font-size: var(--di-text-size-small);
          color: var(--di-text-secondary);
          min-width: 70px;
          text-align: right;
        }
        
        /* Full text badge (expanded view) */
        .drive-item-status {
          flex-shrink: 0;
          padding: var(--di-badge-padding);
          border-radius: var(--di-badge-radius);
          font-size: var(--di-badge-size);
          font-weight: 500;
          text-transform: uppercase;
        }
        
        /* Compact icon badge */
        .drive-item-status-icon {
          flex-shrink: 0;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
        }
        
        /* Status icon animations */
        @keyframes status-bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        
        @keyframes status-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        
        .drive-item-status-icon.animate-bounce {
          animation: status-bounce 0.6s ease-in-out infinite;
        }
        
        .drive-item-status-icon.animate-pulse {
          animation: status-pulse 1.5s ease-in-out infinite;
        }
        
        .drive-item-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        
        .drive-item-action {
          width: 28px;
          height: 28px;
          border: none;
          background: transparent;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          opacity: 0.6;
          transition: opacity 0.15s, background 0.15s;
        }
        
        .drive-item-action:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.1);
        }
        
        .drive-item-peers {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: var(--di-text-size-small);
          color: var(--di-text-secondary);
        }
        
        .drive-item-peers-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #22c55e;
        }
        
        .drive-item-peers-dot.offline {
          background: #6b7280;
        }
        
        /* Kebab menu button */
        .drive-item-menu-btn {
          width: 28px;
          height: 28px;
          border: none;
          background: transparent;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          opacity: 0.5;
          transition: opacity 0.15s, background 0.15s;
          flex-shrink: 0;
        }
        
        .drive-item-menu-btn:hover {
          opacity: 1;
          background: rgba(255, 255, 255, 0.1);
        }
        
        .drive-item-menu-btn span {
          width: 4px;
          height: 4px;
          background: var(--di-text);
          border-radius: 50%;
        }
        
        /* Context menu dropdown */
        .drive-item-menu {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          min-width: 160px;
          background: var(--di-menu-bg, #333);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          overflow: hidden;
          opacity: 0;
          visibility: hidden;
          transform: translateY(-8px) scale(0.95);
          transform-origin: top right;
          transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
          z-index: 100;
        }
        
        .drive-item-menu.open {
          opacity: 1;
          visibility: visible;
          transform: translateY(0) scale(1);
        }
        
        .drive-item-menu-item {
          display: block;
          width: 100%;
          padding: 10px 14px;
          border: none;
          background: transparent;
          color: var(--di-text);
          font-size: 13px;
          text-align: left;
          cursor: pointer;
          transition: background 0.1s;
        }
        
        .drive-item-menu-item:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        
        .drive-item-menu-item.danger {
          color: #ef4444;
        }
        
        .drive-item-menu-item.danger:hover {
          background: rgba(239, 68, 68, 0.1);
        }
        
        .drive-item-menu-divider {
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
          margin: 4px 0;
        }
        
        /* Menu container for positioning */
        .drive-item-menu-container {
          position: relative;
        }
        
        /* Backdrop for closing menu */
        .drive-item-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 99;
          display: none;
        }
        
        .drive-item-backdrop.active {
          display: block;
        }
        
        /* Confirm dialog */
        .drive-item-confirm {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: var(--di-menu-bg, #333);
          border-radius: 12px;
          padding: 20px;
          min-width: 280px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.5);
          z-index: 200;
          text-align: center;
        }
        
        .drive-item-confirm-title {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        
        .drive-item-confirm-message {
          font-size: 14px;
          opacity: 0.7;
          margin-bottom: 20px;
        }
        
        .drive-item-confirm-buttons {
          display: flex;
          gap: 12px;
          justify-content: center;
        }
        
        .drive-item-confirm-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s;
        }
        
        .drive-item-confirm-btn.cancel {
          background: rgba(255, 255, 255, 0.1);
          color: var(--di-text);
        }
        
        .drive-item-confirm-btn.cancel:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        
        .drive-item-confirm-btn.confirm {
          background: #ef4444;
          color: white;
        }
        
        .drive-item-confirm-btn.confirm:hover {
          background: #dc2626;
        }
        
        .drive-item-confirm-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          z-index: 199;
        }
      `;
      document.head.appendChild(style);
    }

    _applyTheme() {
      if (!this._element) return;
      
      // Start with defaults
      let theme = { ...DEFAULT_THEME };
      
      // Apply named theme
      if (this._theme === 'light') {
        theme = { ...theme, ...LIGHT_THEME };
      }
      
      // Apply custom overrides
      theme = { ...theme, ...this._customTheme };
      
      // Set CSS variables
      Object.entries(theme).forEach(([key, value]) => {
        this._element.style.setProperty(key, value);
      });
    }

    _render() {
      const data = this._data;
      const show = this._visible;
      
      // First render - create full structure
      if (!this._element) {
        this._element = document.createElement('div');
        this._element.className = 'drive-item';
        
        // Create stable structure: content area + menu (menu won't be replaced)
        this._contentArea = document.createElement('div');
        this._contentArea.className = 'drive-item-inner';
        this._contentArea.style.cssText = 'display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;';
        
        this._element.appendChild(this._contentArea);
        
        // Create menu container (stable, won't be replaced on updates)
        if (this._showMenu) {
          this._menuContainer = document.createElement('div');
          this._menuContainer.className = 'drive-item-menu-container';
          this._menuContainer.innerHTML = `
            <button class="drive-item-menu-btn" aria-label="Menu">
              <span></span>
              <span></span>
              <span></span>
            </button>
            <div class="drive-item-menu"></div>
          `;
          this._element.appendChild(this._menuContainer);
        }
        
        this.container.appendChild(this._element);
        this._applyTheme();
        this._bindEvents();
      }
      
      // Update only the content area (not the menu)
      const contentHTML = this._buildContentHTML(data, show);
      this._contentArea.innerHTML = contentHTML;
      
      this._element.dataset.id = data.id || '';
      this._element.dataset.status = data.status;
      
      // Handle paused state dimming
      const statusConfig = STATUS_CONFIG[data.status];
      if (statusConfig && statusConfig.dimItem) {
        this._element.classList.add('is-paused');
      } else {
        this._element.classList.remove('is-paused');
      }
      
      // Update progress bar slot if external module provided
      if (this._progressBar && show.includes('progress') && data.progress != null) {
        const slot = this._contentArea.querySelector('.drive-item-progress-slot');
        if (slot) {
          this._progressBar.mount(slot);
          this._progressBar.update(data.progress);
        }
      }
    }

    _buildContentHTML(data, show) {
      const parts = [];
      
      // Thumbnail
      const icon = data.type === 'upload' ? '📤' : '⬇️';
      const thumbContent = data.thumbnail 
        ? `<img src="${escapeHtml(data.thumbnail)}" alt="">`
        : icon;
      parts.push(`<div class="drive-item-thumb">${thumbContent}</div>`);
      
      // Content area
      const contentParts = [];
      
      // Row 1: Title (always)
      if (show.includes('title')) {
        contentParts.push(`<div class="drive-item-header"><div class="drive-item-title">${escapeHtml(data.title)}</div></div>`);
      }
      
      // Determine view mode
      const isExpanded = show.includes('size') || show.includes('fileCount');
      const hasActiveProgress = show.includes('progress') && data.progress != null && data.progress < 1;
      const isDownloading = data.type === 'download' && (data.status === 'downloading' || data.status === 'connecting');
      const isComplete = data.status === 'complete';
      const isActiveUpload = data.type === 'upload' && (data.peers > 0 || data.speed > 0);
      const isInactive = data.status === 'inactive' || (!isDownloading && !isComplete && !isActiveUpload);
      
      const percent = data.progress != null ? Math.round(data.progress * 100) : null;
      const speedText = data.speed > 0 ? formatSpeed(data.speed) : '';
      
      // EXPANDED DOWNLOAD (3 rows): Meta row + Progress bar
      if (isExpanded && hasActiveProgress) {
        // Row 2: Meta (size • files • percent • speed)
        const metaParts = [];
        if (show.includes('size') && data.size > 0) {
          metaParts.push(`<span class="drive-item-meta-item">${formatBytes(data.size)}</span>`);
        }
        if (show.includes('fileCount') && data.fileCount > 0) {
          metaParts.push(`<span class="drive-item-meta-item">${data.fileCount} file${data.fileCount !== 1 ? 's' : ''}</span>`);
        }
        if (percent != null) {
          metaParts.push(`<span class="drive-item-meta-item">${percent}%</span>`);
        }
        if (speedText) {
          metaParts.push(`<span class="drive-item-meta-item">${speedText}</span>`);
        }
        if (metaParts.length > 0) {
          contentParts.push(`<div class="drive-item-meta">${metaParts.join('<span class="drive-item-meta-divider">•</span>')}</div>`);
        }
        
        // Row 3: Progress bar
        contentParts.push(`
          <div class="drive-item-progress">
            <div class="drive-item-progress-bar">
              <div class="drive-item-progress-fill" style="width: ${percent}%"></div>
            </div>
          </div>
        `);
      }
      // COMPACT DOWNLOAD (2 rows): Just progress bar
      else if (!isExpanded && hasActiveProgress) {
        contentParts.push(`
          <div class="drive-item-progress">
            <div class="drive-item-progress-bar">
              <div class="drive-item-progress-fill" style="width: ${percent}%"></div>
            </div>
          </div>
        `);
      }
      // ACTIVE UPLOAD (2 rows): Upload speed + peers
      else if (isActiveUpload) {
        const metaParts = [];
        if (speedText && data.type === 'upload') {
          metaParts.push(`
            <span class="drive-item-upload-speed">
              <span class="drive-item-upload-speed-arrow">↑</span>
              ${speedText}
            </span>
          `);
        }
        if (show.includes('peers') && data.peers > 0) {
          metaParts.push(`
            <span class="drive-item-peers">
              <span class="drive-item-peers-dot"></span>
              ${data.peers} peer${data.peers !== 1 ? 's' : ''}
            </span>
          `);
        }
        if (metaParts.length > 0) {
          contentParts.push(`<div class="drive-item-meta">${metaParts.join('<span class="drive-item-meta-divider">•</span>')}</div>`);
        }
      }
      // COMPLETE or INACTIVE (2 rows): Size • files
      else {
        const metaParts = [];
        if (show.includes('size') && data.size > 0) {
          metaParts.push(`<span class="drive-item-meta-item">${formatBytes(data.size)}</span>`);
        }
        if (show.includes('fileCount') && data.fileCount > 0) {
          metaParts.push(`<span class="drive-item-meta-item">${data.fileCount} file${data.fileCount !== 1 ? 's' : ''}</span>`);
        }
        if (metaParts.length > 0) {
          contentParts.push(`<div class="drive-item-meta">${metaParts.join('<span class="drive-item-meta-divider">•</span>')}</div>`);
        }
      }
      
      // Path (hidden usually, but in DOM for access)
      if (show.includes('path') && data.path) {
        contentParts.push(`<div class="drive-item-meta" style="display:none" data-path="${escapeHtml(data.path)}">${truncateMiddle(data.path, 40)}</div>`);
      }
      
      // Creator
      if (show.includes('creator') && data.creator) {
        contentParts.push(`<div class="drive-item-meta"><span class="drive-item-meta-item">by ${truncateMiddle(data.creator, 16)}</span></div>`);
      }
      
      if (contentParts.length > 0) {
        parts.push(`<div class="drive-item-content">${contentParts.join('')}</div>`);
      }
      
      // Right side - status badge (expanded text or compact icon)
      if (show.includes('status') && data.status) {
        // Expanded view - full text badge
        const config = STATUS_CONFIG[data.status] || STATUS_CONFIG.inactive;
        parts.push(`
          <span class="drive-item-status" style="background: ${config.color}20; color: ${config.color}">
            ${config.label}
          </span>
        `);
      } else if (show.includes('statusIcon') && data.status) {
        // Compact view - icon badge
        const config = STATUS_CONFIG[data.status] || STATUS_CONFIG.inactive;
        
        // For inactive, don't show any icon (per Guy's spec)
        if (config.icon) {
          const animClass = config.animate ? `animate-${config.animate}` : '';
          parts.push(`
            <span class="drive-item-status-icon ${animClass}" style="background: ${config.color}20; color: ${config.color}">
              ${config.icon}
            </span>
          `);
        }
      }
      
      return parts.join('');
    }

    _buildMenuHTML(data) {
      return this._menuItems
        .filter(item => {
          if (item.id === 'divider') return true;
          if (item.showWhen && !item.showWhen(data)) return false;
          return true;
        })
        .map(item => {
          if (item.id === 'divider') {
            return '<div class="drive-item-menu-divider"></div>';
          }
          const dangerClass = item.danger ? 'danger' : '';
          // Icon inline with text (only for items that have icons)
          const label = item.icon ? `${item.icon} ${item.label}` : item.label;
          return `
            <button class="drive-item-menu-item ${dangerClass}" data-action="${item.id}" data-confirm="${item.confirm || false}">
              ${label}
            </button>
          `;
        })
        .join('');
    }

    /**
     * Add a custom menu item
     * @param {Object} item - { id, label, icon?, showWhen?, danger?, confirm? }
     * @param {number} position - Insert position (default: before divider)
     */
    addMenuItem(item, position) {
      if (position === undefined) {
        // Find divider and insert before it
        const dividerIndex = this._menuItems.findIndex(i => i.id === 'divider');
        position = dividerIndex >= 0 ? dividerIndex : this._menuItems.length;
      }
      this._menuItems.splice(position, 0, item);
      return this;
    }

    /**
     * Remove a menu item by id
     * @param {string} id - Item id to remove
     */
    removeMenuItem(id) {
      this._menuItems = this._menuItems.filter(item => item.id !== id);
      return this;
    }

    /**
     * Get current menu items
     * @returns {Array}
     */
    getMenuItems() {
      return [...this._menuItems];
    }

    _bindEvents() {
      // Create backdrop for menu
      this._backdrop = document.createElement('div');
      this._backdrop.className = 'drive-item-backdrop';
      document.body.appendChild(this._backdrop);
      
      this._backdrop.addEventListener('click', () => {
        this._closeMenu();
      });
      
      // Menu button click (on the stable menu container)
      if (this._menuContainer) {
        const menuBtn = this._menuContainer.querySelector('.drive-item-menu-btn');
        if (menuBtn) {
          menuBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this._toggleMenu();
          });
        }
        
        // Menu item clicks (delegated on menu container)
        this._menuContainer.addEventListener('click', (e) => {
          const menuItem = e.target.closest('.drive-item-menu-item');
          if (menuItem) {
            e.stopPropagation();
            const action = menuItem.dataset.action;
            const needsConfirm = menuItem.dataset.confirm === 'true';
            
            this._closeMenu();
            
            if (needsConfirm) {
              this._showConfirmDialog(action);
            } else {
              this._triggerAction(action);
            }
          }
        });
      }
      
      // Content area click (not menu)
      this._contentArea.addEventListener('click', (e) => {
        // Don't trigger click if menu is open
        if (this._menuOpen) {
          this._closeMenu();
          return;
        }
        
        // Regular click
        this._emit('click', this._data);
      });
      
      // Right-click context menu on the entire element
      this._element.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._openMenuAt(e.clientX, e.clientY);
      });
      
      // Touch long-press on content area
      this._contentArea.addEventListener('touchstart', (e) => {
        this._longPressTimer = setTimeout(() => {
          const touch = e.touches[0];
          this._openMenuAt(touch.clientX, touch.clientY);
          // Prevent the click that would follow
          e.preventDefault();
        }, 500);
      }, { passive: false });
      
      this._contentArea.addEventListener('touchend', () => {
        if (this._longPressTimer) {
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }
      });
      
      this._contentArea.addEventListener('touchmove', () => {
        if (this._longPressTimer) {
          clearTimeout(this._longPressTimer);
          this._longPressTimer = null;
        }
      });
      
      // Escape key closes menu
      this._escapeHandler = (e) => {
        if (e.key === 'Escape' && this._menuOpen) {
          this._closeMenu();
        }
      };
      document.addEventListener('keydown', this._escapeHandler);
    }

    _toggleMenu() {
      if (this._menuOpen) {
        this._closeMenu();
      } else {
        this._openMenu();
      }
    }

    _getMenu() {
      return this._menuContainer ? this._menuContainer.querySelector('.drive-item-menu') : null;
    }

    _openMenu() {
      const menu = this._getMenu();
      if (menu) {
        // Re-render menu items (they may change based on status)
        menu.innerHTML = this._buildMenuHTML(this._data);
        menu.classList.add('open');
        this._backdrop.classList.add('active');
        this._menuOpen = true;
      }
    }

    _openMenuAt(x, y) {
      const menu = this._getMenu();
      if (menu) {
        // Re-render menu items
        menu.innerHTML = this._buildMenuHTML(this._data);
        
        // Position menu at cursor/touch point
        menu.style.position = 'fixed';
        menu.style.top = y + 'px';
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - x) + 'px';
        menu.style.transform = 'translateY(0) scale(1)';
        
        menu.classList.add('open');
        this._backdrop.classList.add('active');
        this._menuOpen = true;
      }
    }

    _closeMenu() {
      const menu = this._getMenu();
      if (menu) {
        menu.classList.remove('open');
        // Reset positioning
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.transform = '';
      }
      this._backdrop.classList.remove('active');
      this._menuOpen = false;
    }

    _triggerAction(action) {
      this._emit('action', { action, data: this._data });
      if (this._onAction) {
        this._onAction(action, this._data);
      }
    }

    _showConfirmDialog(action) {
      const menuItem = this._menuItems.find(item => item.id === action);
      const title = menuItem ? menuItem.label : action;
      
      // Create confirm dialog
      const overlay = document.createElement('div');
      overlay.className = 'drive-item-confirm-overlay';
      
      const dialog = document.createElement('div');
      dialog.className = 'drive-item-confirm';
      dialog.innerHTML = `
        <div class="drive-item-confirm-title">${title}?</div>
        <div class="drive-item-confirm-message">Are you sure you want to ${title.toLowerCase()} "${this._data.title}"?</div>
        <div class="drive-item-confirm-buttons">
          <button class="drive-item-confirm-btn cancel">Cancel</button>
          <button class="drive-item-confirm-btn confirm">${title}</button>
        </div>
      `;
      
      document.body.appendChild(overlay);
      document.body.appendChild(dialog);
      
      const closeDialog = () => {
        overlay.remove();
        dialog.remove();
      };
      
      overlay.addEventListener('click', closeDialog);
      dialog.querySelector('.cancel').addEventListener('click', closeDialog);
      dialog.querySelector('.confirm').addEventListener('click', () => {
        closeDialog();
        this._triggerAction(action);
      });
    }
  }

  return DriveItem;
}));
