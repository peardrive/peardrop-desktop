/**
 * DriveItem - Standalone drive display component
 * @module DriveItem
 * @version 1.0.0
 * EXPORTS:
 * DriveItem (class) - Main component class
 * DEPENDENCIES:
 * None (zero external dependencies)
 * Optional: ProgressBar module for download progress
 * EVENTS EMITTED (subscribe via item.on(event, handler)):
 * 'click' - Single-file item clicked. Payload: drive data.
 * 'action' - Menu action chosen. Payload: { action, data }.
 * 'expand' - Expandable item toggled. Payload: { expanded, data }.
 * 'fileClick' - Child file row in the expanded list clicked.
 *                   Payload: { file, index, data }.
 * USAGE:
 *   const item = new DriveItem(container, {
 *     data: { title: 'My Drive', size: 1024000, ... },
 *     show: ['title', 'size', 'status', 'progress'],
 *     theme: 'dark'
 *   });
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

  const VERSION = '1.0.0';

  // All available fields
  const FIELDS = [
    'title',
    'size',
    'fileCount',
    'files',       // Expandable file list [{name, size}]
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
  // UPLOAD vs DOWNLOAD display rules:
  // DOWNLOADS: Show progress bar, speed, peers
  // UPLOADS: Show peers, upload bandwidth — NO progress bar
  //   (uploader doesn't track what downloader needs, just serves requests)
  const PRESETS = {
    all: FIELDS.filter(f => f !== 'path' && f !== 'statusIcon'), // path hidden by default
    minimal: ['title', 'status'],
    minimalCompact: ['title', 'statusIcon'],
    // Generic compact - includes progress (only renders for downloads with progress value)
    compact: ['title', 'size', 'progress', 'status'],
    compactIcon: ['title', 'size', 'progress', 'statusIcon'],
    // Download-specific - progress bar + speed
    download: ['title', 'size', 'progress', 'speed', 'status'],
    downloadCompact: ['title', 'size', 'progress', 'speed', 'statusIcon'],
    // Upload/Share-specific - peers + bandwidth, NO progress
    share: ['title', 'size', 'fileCount', 'peers', 'status'],
    shareCompact: ['title', 'size', 'fileCount', 'peers', 'statusIcon'],
    // Full view
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
    },
    error: {
      label: 'Error',
      color: 'var(--di-status-error, #ef4444)',
      icon: '⚠',
      animate: null,
      dimItem: true
    },
    // Drive is not currently active (e.g. failed to resume at boot). Neutral
    // grey + dimmed to say "nothing is happening" without alarming; not
    // "error" because the failure is usually transient and the manifest
    // state is untouched. Retry is user-initiated via the Resume menu item.
    inactive: {
      label: 'Inactive',
      color: 'var(--di-status-inactive, #94a3b8)',
      icon: '◯',
      animate: null,
      dimItem: true
    }
  };

  // Default menu items — matches Desktop Redesign v2 Figma spec #18.
  // The order below is the order the user reads top-to-bottom in the menu.
  // Labels/handling for the app-specific actions (favorite, copy-link,
  // show-qr, edit, properties) live in renderer.js; the library only emits
  // the action id and lets the host decide.
  //
  // dynamicLabel(data)  — optional; returns the string shown to the user
  //                       (used by `favorite` to swap Add/Remove).
  const DEFAULT_MENU_ITEMS = [
    { id: 'favorite',
      dynamicLabel: (data) => data.favorite ? 'Remove from Favorites' : 'Add to Favorites' },
    { id: 'copy-link',   label: 'Copy Link', showWhen: (data) => !!data.shareLink },
    { id: 'show-qr',     label: 'Show QR',   showWhen: (data) => !!data.shareLink },
    { id: 'edit',        label: 'Edit' },
    { id: 'properties',  label: 'Properties' },
    { id: 'show-files',  label: 'Show Files', showWhen: (data) => Array.isArray(data.files) && data.files.length > 1 },
    { id: 'divider' },
    { id: 'resume',      label: 'Resume seeding', icon: '▶',
      showWhen: (data) => data.status === 'paused' || data.status === 'error' || data.status === 'inactive' },
    { id: 'pause',       label: 'Stop sharing',   danger: true,
      showWhen: (data) => data.status === 'downloading' || data.status === 'sharing' },
    { id: 'remove',      label: 'Remove', danger: true, confirm: true }
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
  // Shared formatting lives in lib/ui-utils.js (window.PearUtils), loaded first
  // in index.html. These thin forwarders keep call sites unchanged while the
  // logic stays single-source — see CLAUDE.md "Unified Progress UI".

  const formatBytes = (bytes) => PearUtils.formatBytes(bytes);
  const formatSpeed = (bytesPerSec) => PearUtils.formatSpeed(bytesPerSec);
  const escapeHtml = (text) => PearUtils.escapeHtml(text);
  const truncateMiddle = (str, maxLen) => PearUtils.truncateMiddle(str, maxLen);
  const getFileIcon = (filename) => PearUtils.getFileIcon(filename);
  const getFileType = (filename) => PearUtils.getFileType && PearUtils.getFileType(filename);
  const getFileIconSvg = (filename) => PearUtils.getFileIconSvg && PearUtils.getFileIconSvg(filename);

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
      this._expanded = false; // File list expand state

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
      
      // Transition: download complete → ready to share (upload type, sharing when peers connect)
      this._data = {
        ...this._data,
        type: 'upload',
        status: 'sharing', // Ready to share (no inactive state needed)
        progress: null,
        speed: 0,
        peers: 0
      };
      
      this._render();
      this._emit('transition-complete', { type: 'download-to-share', data: this._data });
      
      // Start cache clear timer now that we're sharing
      this._startClearCacheTimer();
    }


    /**
     * Start the cache clear timer (after going inactive)
     */
    _startClearCacheTimer() {
      if (!this._autoClearCache) return;
      
      this._cancelClearCacheTimer();
      
      this._clearCacheTimer = setTimeout(() => {
        // Emit event for parent app to handle the actual clearing
        // Parent would call: hyperdriveManager.removeDriveEntry(id, { deleteStorage: true, deleteFiles: false })
        // Or a dedicated: hyperdriveManager.clearCache(id)
        this._emit('clear-cache', { 
          data: this._data,
          reason: 'inactivity-timeout',
          // Suggested API call:
          api: {
            method: 'hyperdriveManager.removeDriveEntry',
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
      console.log('[DEBUG] DriveItem.destroy() called for:', this._data?.id || 'unknown');
      
      if (this._element && this._element.parentNode) {
        console.log('[DEBUG] DriveItem.destroy() - removing element from DOM');
        this._element.parentNode.removeChild(this._element);
      } else {
        console.log('[DEBUG] DriveItem.destroy() - no element or parent to remove');
      }
      if (this._longPressTimer) {
        clearTimeout(this._longPressTimer);
      }
      if (this._transitionTimer) {
        clearTimeout(this._transitionTimer);
      }
      if (this._clearCacheTimer) {
        clearTimeout(this._clearCacheTimer);
      }
      if (this._escapeHandler) {
        document.removeEventListener('keydown', this._escapeHandler);
      }
      if (this._documentClickHandler) {
        document.removeEventListener('click', this._documentClickHandler, true);
      }
      if (this._menuClickHandler) {
        document.removeEventListener('click', this._menuClickHandler);
      }
      // If menu is on body, clean it up
      const orphanMenu = document.querySelector('.drive-item-menu.open');
      if (orphanMenu && orphanMenu.parentNode === document.body) {
        orphanMenu.remove();
      }
      this._listeners = {};
      this._element = null;
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
        type: data.type || 'download', // download | upload
        files: Array.isArray(data.files) ? data.files : [], // [{name, size}]
        // Optional app-level fields — passed through untouched. Kept in the
        // normalized shape so menu items' showWhen/dynamicLabel callbacks
        // can rely on them without the host having to re-inject data.
        shareLink: data.shareLink || null,
        favorite: !!data.favorite
      };

      // Use explicit status if provided, otherwise use data.status
      const statusHint = explicitStatus !== undefined ? explicitStatus : data.status;
      
      // Auto-determine status from data
      normalized.status = this._deriveStatus(normalized, statusHint);
      
      return normalized;
    }

    /**
     * Automatically derive status from data state
     * Priority: explicit paused/missing > inferred from activity > explicit status > sharing
     */
    _deriveStatus(data, explicitStatus) {
      let derived = 'sharing';
      
      // Paused and missing are explicit states - user has to set them
      if (explicitStatus === 'paused' || explicitStatus === 'missing') {
        derived = explicitStatus;
      }
      // Complete: progress is 100%
      else if (data.progress != null && data.progress >= 1) {
        derived = 'complete';
      }
      // Actively downloading: download type with speed OR peers connected
      // (progress >= 0 is valid - just started downloading)
      else if (data.type === 'download' && (
        data.speed > 0 || 
        (data.peers > 0 && data.progress != null && data.progress < 1)
      )) {
        derived = 'downloading';
      }
      // Connecting: download with progress initialized but no peers yet
      else if (data.type === 'download' && data.progress != null && data.progress >= 0 && data.progress < 1) {
        derived = 'connecting';
      }
      // Sharing: upload type with peers connected
      else if (data.type === 'upload' && data.peers > 0) {
        derived = 'sharing';
      }
      // Use explicit status if provided
      else if (explicitStatus) {
        derived = explicitStatus;
      }
      
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
          align-items: flex-start;
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

        /* Desktop v2 status line + row action button + favorite star —
           hidden by default so mobile is unchanged; index.html reveals
           them on the ≥600px breakpoint. */
        .drive-item-status-line {
          display: none;
        }
        .drive-item-row-action {
          display: none;
        }
        .drive-item-fav-star {
          display: none;
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
          margin-top: 6px;
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
          margin-top: 8px;
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
          position: relative;
          z-index: 1;
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
          z-index: 10000;
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
          z-index: 2;
          margin-top: 6px;
        }
        
        /* 
         * STACKING CONTEXT SOLUTION:
         * When menu is open, elevate the ENTIRE DriveItem above siblings.
         * This ensures the menu appears above other DriveItems' buttons.
         * Without this, later DOM siblings would stack above earlier ones' menus.
         * See ARCHITECTURE.md for full explanation.
         */
        .drive-item.menu-open {
          position: relative;
          z-index: 1000;
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
          z-index: 10001;
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
        
        /* Expandable file list */
        .drive-item-expand-toggle {
          cursor: pointer;
          user-select: none;
        }

        .drive-item-expand-arrow {
          flex-shrink: 0;
          font-size: 16px;
          transition: transform 0.2s ease;
          opacity: 0.4;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          line-height: 1;
          margin-top: 6px;
        }

        .drive-item-expand-arrow:hover {
          opacity: 0.8;
          background: rgba(255, 255, 255, 0.08);
        }

        .drive-item.is-expanded .drive-item-expand-arrow {
          transform: rotate(90deg);
          opacity: 0.7;
        }

        .drive-item-files {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.25s ease, opacity 0.2s ease;
          opacity: 0;
          margin-top: 0;
          width: auto;
          margin-left: -52px;
          margin-right: -105px;
        }

        .drive-item.is-expanded .drive-item-files {
          max-height: 320px;
          opacity: 1;
          margin-top: 6px;
          overflow-y: auto;
        }

        .drive-item-file {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.04);
          margin-bottom: 4px;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.08s ease;
        }

        .drive-item-file:hover {
          background: rgba(255, 255, 255, 0.09);
        }

        .drive-item-file:active {
          transform: scale(0.99);
        }

        .drive-item-file:last-child {
          margin-bottom: 0;
        }

        /* Thumb container — fits emoji fallback, file-type icon, or image preview */
        .drive-item-file-thumb {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.05);
          font-size: 18px;
        }

        .drive-item-file-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        /* Legacy class kept for any external CSS that targets it */
        .drive-item-file-icon {
          font-size: 18px;
          flex-shrink: 0;
        }

        .drive-item-file-name {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          color: var(--di-text);
          opacity: 0.85;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .drive-item-file-size {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--di-text-secondary);
        }

        .drive-item-file-open {
          flex-shrink: 0;
          opacity: 0;
          transition: opacity 0.15s ease;
          font-size: 14px;
          color: var(--di-text-secondary);
        }

        .drive-item-file:hover .drive-item-file-open {
          opacity: 0.7;
        }

        /* Scrollbar for file list */
        .drive-item-files::-webkit-scrollbar {
          width: 4px;
        }

        .drive-item-files::-webkit-scrollbar-track {
          background: transparent;
        }

        .drive-item-files::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 2px;
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
        this._contentArea.style.cssText = 'display: flex; align-items: flex-start; gap: 12px; flex: 1; min-width: 0;';
        
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

      // Preserve expand state across re-renders
      if (this._expanded) {
        this._element.classList.add('is-expanded');
      } else {
        this._element.classList.remove('is-expanded');
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

      // Thumbnail. Grouped drives (multi-file shares) always render as
      // a chunky filled teal folder icon per Desktop v2 Figma — even if
      // a composited group-preview thumbnail was set by the renderer,
      // the icon takes precedence for visual consistency across all
      // folder-style shares. Single-file drives keep the existing
      // "image if we have one, else download/upload emoji" fallback.
      // Folder SVG: solid-filled body with a visible top-left tab, no
      // stroke — matches the plump iOS-style folder in the example.
      const _isGroupThumb = Array.isArray(data.files) && data.files.length > 1;
      // iOS Files.app style folder — chunky filled body with a
      // distinct top-LEFT tab. Two overlapping paths: a small tab
      // rectangle and a rounded main body that starts slightly below
      // and to the right of the tab. Matches the reference Amir sent.
      const _folderSvg = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3.4 4h4.2a1.6 1.6 0 0 1 1.13.47L10 5.5h-7V5.6A1.6 1.6 0 0 1 3.4 4z"/><path d="M2 8.4a1.6 1.6 0 0 1 1.6-1.6h16.8A1.6 1.6 0 0 1 22 8.4v10.2A1.4 1.4 0 0 1 20.6 20H3.4A1.4 1.4 0 0 1 2 18.6z"/></svg>';
      let thumbContent;
      let thumbExtraClass = '';
      if (_isGroupThumb) {
        thumbContent = `<span class="drive-item-thumb-folder" aria-hidden="true">${_folderSvg}</span>`;
        thumbExtraClass = ' is-folder';
      } else if (data.thumbnail) {
        thumbContent = `<img src="${escapeHtml(data.thumbnail)}" alt="">`;
      } else {
        // No real preview → category-tinted SVG icon (photo / video /
        // audio / doc / archive / code / …). Matches the folder icon
        // treatment; category color is set via inline `color:` so the
        // SVG's `fill="currentColor"` picks it up. Falls back to a
        // send/receive emoji if the icon set isn't loaded.
        const _fileIcon = getFileIconSvg ? getFileIconSvg(data.title) : null;
        if (_fileIcon) {
          thumbContent = `<span class="drive-item-thumb-fileicon" aria-hidden="true" style="color:${_fileIcon.color}">${_fileIcon.svg}</span>`;
          thumbExtraClass = ' is-fileicon';
        } else {
          thumbContent = data.type === 'upload' ? '📤' : '⬇️';
        }
      }
      parts.push(`<div class="drive-item-thumb${thumbExtraClass}">${thumbContent}</div>`);
      
      // Content area
      const contentParts = [];
      
      // Row 1: Title (always). On Desktop v2 the header also carries the
      // gold favorite star (hidden by default via the library's injected
      // rule; revealed by index.html for favorited drives on ≥600px).
      const isExpandable = data.files && data.files.length > 1;
      if (show.includes('title')) {
        // Gold star — always in the DOM so favoriting/unfavoriting only
        // toggles CSS visibility (no re-render race). Uses currentColor
        // + gold fill via CSS so it can be re-themed.
        const _starSvg = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M12 2.5l2.9 6.4 7 .7-5.3 4.8 1.6 6.9L12 17.9l-6.2 3.4 1.6-6.9L2.1 9.6l7-.7z"/></svg>';
        contentParts.push(`<div class="drive-item-header"><div class="drive-item-title">${escapeHtml(data.title)}</div><span class="drive-item-fav-star" aria-hidden="true" data-fav="${data.favorite ? 'true' : 'false'}">${_starSvg}</span></div>`);

        // Row 1.5 — Desktop v2 "status line" under the title. Always
        // emitted; the desktop CSS shows it, mobile CSS hides it (via
        // `.drive-item-status-line { display:none }` in the base injected
        // styles below). For groups it also shows a small paper icon +
        // "N Files" before the status text; for single files it shows a
        // file-type prefix like "Picture • Completed" — but ONLY for
        // healthy states (Sharing/Complete). Failure/inactive states
        // show status alone to keep the emphasis on the problem.
        // Colored via [data-status] attribute in index.html.
        const _cfg = STATUS_CONFIG[data.status] || STATUS_CONFIG.sharing;
        const _percent = data.progress != null ? Math.round(data.progress * 100) : null;
        let _statusText = _cfg.label;
        // `_dataStatus` overrides `data.status` when we need CSS to color
        // an in-progress share differently from an idle "Active" share
        // (both have data.status === 'sharing').
        let _dataStatus = data.status;
        if (data.status === 'downloading' && _percent != null) {
          _statusText = `Downloading (${_percent}%)`;
        } else if (data.status === 'sharing' && _percent != null && _percent < 100) {
          _statusText = `Sharing (${_percent}%)`;
          _dataStatus = 'sharing-progress';
        } else if (data.status === 'sharing') {
          _statusText = 'Active';
        } else if (data.status === 'complete') {
          _statusText = 'Completed';
        } else if (data.status === 'error') {
          _statusText = 'Failed';
        }

        const _isGroup = Array.isArray(data.files) && data.files.length > 1;
        const _paperSvg = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>';

        // Prefix decision — "Picture • Completed" pattern from Figma.
        // Skip for in-progress transfers, failed downloads, and inactive
        // drives; those states already carry the meaning on their own.
        const _showPrefix = data.status === 'sharing'
          || data.status === 'complete'
          || data.status === 'paused';
        const _fileType = !_isGroup && _showPrefix ? getFileType(data.title) : null;

        const _lineParts = [];
        if (_isGroup) {
          _lineParts.push(`<span class="drive-item-status-count"><span class="drive-item-status-count-icon" aria-hidden="true">${_paperSvg}</span>${data.fileCount || data.files.length} File${(data.fileCount || data.files.length) !== 1 ? 's' : ''}</span>`);
          _lineParts.push(`<span class="drive-item-status-dot" aria-hidden="true">•</span>`);
        } else if (_fileType) {
          _lineParts.push(`<span class="drive-item-status-type">${_fileType}</span>`);
          _lineParts.push(`<span class="drive-item-status-dot" aria-hidden="true">•</span>`);
        }
        _lineParts.push(`<span class="drive-item-status-label">${_statusText}</span>`);

        contentParts.push(`<div class="drive-item-status-line" data-status="${_dataStatus}">${_lineParts.join('')}</div>`);
      }
      
      // Determine view mode
      const isExpanded = show.includes('size') || show.includes('fileCount');
      const hasActiveProgress = show.includes('progress') && data.progress != null && data.progress < 1;
      const isDownloading = data.type === 'download' && (data.status === 'downloading' || data.status === 'connecting');
      const isComplete = data.status === 'complete';
      const isActiveUpload = data.type === 'upload' && (data.peers > 0 || data.speed > 0);
      const isSharing = data.status === 'sharing' || (!isDownloading && !isComplete && !isActiveUpload);
      
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
      // COMPLETE or INACTIVE (2 rows): Size • files [• peers]
      else {
        const metaParts = [];
        if (show.includes('size') && data.size > 0) {
          metaParts.push(`<span class="drive-item-meta-item">${formatBytes(data.size)}</span>`);
        }
        if (show.includes('fileCount') && data.fileCount > 0) {
          metaParts.push(`<span class="drive-item-meta-item">${data.fileCount} file${data.fileCount !== 1 ? 's' : ''}</span>`);
        }
        // Peer visibility for idle shares: even when nothing is actively
        // transferring, an upload/share should show whether peers are connected
        // (or that it's waiting). Previously peers only rendered during an
        // active upload, so a seeding share looked "dead" in the GUI.
        if (data.type === 'upload' && show.includes('peers')) {
          const n = data.peers || 0;
          metaParts.push(n > 0
            ? `<span class="drive-item-peers"><span class="drive-item-peers-dot"></span>${n} peer${n !== 1 ? 's' : ''}</span>`
            : `<span class="drive-item-peers"><span class="drive-item-peers-dot offline"></span>Waiting for peers</span>`);
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
      
      // Expandable file list (for multi-file items). Each row is a clickable
      // target — the renderer turns the click into a "fileClick" emission
      // (handled by the app to open the file). data-file-index is the lookup
      // key so we don't have to encode paths into HTML attributes.
      if (isExpandable) {
        const filesHtml = data.files.map((f, idx) => `
          <div class="drive-item-file" data-file-index="${idx}" role="button" tabindex="0">
            <span class="drive-item-file-thumb">${getFileIcon(f.name)}</span>
            <span class="drive-item-file-name">${escapeHtml(f.name)}</span>
            <span class="drive-item-file-size">${formatBytes(f.size)}</span>
            <span class="drive-item-file-open" aria-hidden="true">↗</span>
          </div>
        `).join('');
        contentParts.push(`<div class="drive-item-files">${filesHtml}</div>`);
      }

      if (contentParts.length > 0) {
        parts.push(`<div class="drive-item-content">${contentParts.join('')}</div>`);
      }

      // Expand arrow (right side, vertically centered with thumb)
      if (isExpandable) {
        parts.push(`<span class="drive-item-expand-arrow drive-item-expand-toggle">▶</span>`);
      }

      // Desktop v2 (Figma) row action button — Open / Retry / Cancel-X
      // rendered right of the row, before the kebab. Hidden by default
      // via the library's injected `.drive-item-row-action { display:
      // none }` rule; index.html reveals it on the ≥600px breakpoint.
      // The library just emits the button; renderer.js already handles
      // `open`, `resume`, and `remove` actions (remove triggers undo).
      //
      // Priority:
      //   in-progress transfer  → RED  X  (cancel)
      //   error / missing       → RED  Retry pill
      //   inactive              → RED  Retry pill (user re-tries to activate)
      //   everything else       → GREEN Open pill (shared / completed / paused)
      // "Everything else" catches all drives with a local file — matches
      // Amir's intent that every openable row has an Open button.
      const _percentForBtn = data.progress != null ? Math.round(data.progress * 100) : null;
      const _isInProgress = (data.status === 'downloading' || data.status === 'connecting')
        || (data.status === 'sharing' && _percentForBtn != null && _percentForBtn < 100);
      const _isFailed = data.status === 'error' || data.status === 'missing' || data.status === 'inactive';
      const _isGroupBtn = Array.isArray(data.files) && data.files.length > 1;
      if (_isInProgress) {
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-cancel" data-row-action="remove" aria-label="Cancel">&times;</button>`);
      } else if (_isFailed) {
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-retry" data-row-action="resume" aria-label="Retry">Retry</button>`);
      } else if (_isGroupBtn) {
        // Folders (multi-file drives) don't get an Open button — the
        // whole row is clickable and expands the file list. Only
        // single-file rows show Open.
      } else {
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-open" data-row-action="open" aria-label="Open">Open</button>`);
      }

      // Right side - status badge (expanded text or compact icon)
      if (show.includes('status') && data.status) {
        // Expanded view - full text badge
        const config = STATUS_CONFIG[data.status] || STATUS_CONFIG.sharing;
        parts.push(`
          <span class="drive-item-status" style="background: ${config.color}20; color: ${config.color}">
            ${config.label}
          </span>
        `);
      } else if (show.includes('statusIcon') && data.status) {
        // Compact view - icon badge
        const config = STATUS_CONFIG[data.status] || STATUS_CONFIG.sharing;

        // Show icon based on status
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
          // dynamicLabel(data) lets an item's text depend on drive state
          // (e.g. favorite ↔ un-favorite). Falls back to item.label otherwise.
          const rawLabel = typeof item.dynamicLabel === 'function'
            ? item.dynamicLabel(data)
            : item.label;
          const label = item.icon ? `${item.icon} ${rawLabel}` : rawLabel;
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
      // Use document click handler to close menu (instead of backdrop element)
      // This avoids stacking context issues - see ARCHITECTURE.md
      this._documentClickHandler = (e) => {
        if (!this._menuOpen) return;
        // Menu may be on document.body, so check both the container and the menu itself
        const menu = document.querySelector('.drive-item-menu.open');
        const clickedInMenu = menu && menu.contains(e.target);
        const clickedInContainer = this._menuContainer && this._menuContainer.contains(e.target);
        if (!clickedInMenu && !clickedInContainer) {
          this._closeMenu();
        }
      };
      // Use capture phase to catch clicks before they bubble
      document.addEventListener('click', this._documentClickHandler, true);
      
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
        
        // Menu item clicks — use document-level delegation since menu moves to body
        this._menuClickHandler = (e) => {
          const menuItem = e.target.closest('.drive-item-menu-item');
          if (menuItem && this._menuOpen) {
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
        };
        document.addEventListener('click', this._menuClickHandler);
      }
      
      // Content area click (not menu)
      this._contentArea.addEventListener('click', (e) => {
        // Don't trigger click if menu is open
        if (this._menuOpen) {
          this._closeMenu();
          return;
        }

        // Row action button (Desktop v2 Open/Retry/Cancel) — routes
        // to the same 'action' event the kebab menu uses so renderer.js
        // handles it via the existing DriveActions pipeline.
        const rowAction = e.target.closest('.drive-item-row-action');
        if (rowAction && this._contentArea.contains(rowAction)) {
          e.stopPropagation();
          this._triggerAction(rowAction.dataset.rowAction);
          return;
        }

        // Clicking a file row inside the expanded list opens that file —
        // does NOT collapse the parent. Emit and stop.
        const fileRow = e.target.closest('.drive-item-file');
        if (fileRow && this._contentArea.contains(fileRow)) {
          const idx = parseInt(fileRow.dataset.fileIndex, 10);
          const file = this._data.files && this._data.files[idx];
          if (file) {
            this._emit('fileClick', { file, index: idx, data: this._data });
          }
          return;
        }

        // Expandable items: any other click toggles the file list
        if (this._data.files && this._data.files.length > 1) {
          this._toggleExpand();
          return;
        }

        // Regular click (single-file items)
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
      const btn = this._menuContainer ? this._menuContainer.querySelector('.drive-item-menu-btn') : null;
      if (!menu || !btn) return;

      // Re-render menu items (they may change based on status)
      menu.innerHTML = this._buildMenuHTML(this._data);

      // Move menu to body so it escapes all overflow/stacking contexts
      const rect = btn.getBoundingClientRect();
      document.body.appendChild(menu);
      menu.style.position = 'fixed';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left = 'auto';
      menu.style.transform = 'translateY(0) scale(1)';
      menu.style.opacity = '1';
      menu.style.visibility = 'visible';
      menu.classList.add('open');

      // Measure the menu, then decide: open below (default) or flip above
      const menuHeight = menu.offsetHeight;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      if (spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow) {
        // Not enough room below — open above
        menu.style.top = (rect.top - menuHeight - 4) + 'px';
      } else {
        menu.style.top = (rect.bottom + 4) + 'px';
      }

      this._element.classList.add('menu-open');
      this._menuOpen = true;
    }

    _openMenuAt(x, y) {
      const menu = this._getMenu();
      if (!menu) return;

      // Re-render menu items
      menu.innerHTML = this._buildMenuHTML(this._data);

      // Move menu to body
      document.body.appendChild(menu);
      menu.style.position = 'fixed';
      menu.style.top = y + 'px';
      menu.style.left = 'auto';
      menu.style.right = (window.innerWidth - x) + 'px';
      menu.style.transform = 'translateY(0) scale(1)';
      menu.style.opacity = '1';
      menu.style.visibility = 'visible';
      menu.classList.add('open');

      this._element.classList.add('menu-open');
      this._menuOpen = true;
    }

    _closeMenu() {
      const menu = document.querySelector('.drive-item-menu.open') || this._getMenu();
      if (menu) {
        menu.classList.remove('open');
        // Reset inline styles
        menu.style.position = '';
        menu.style.top = '';
        menu.style.left = '';
        menu.style.right = '';
        menu.style.transform = '';
        menu.style.opacity = '';
        menu.style.visibility = '';
        // Move menu back into its container
        if (this._menuContainer && menu.parentNode === document.body) {
          this._menuContainer.appendChild(menu);
        }
      }
      // Remove elevation
      this._element.classList.remove('menu-open');
      this._menuOpen = false;
    }

    _toggleExpand() {
      this._expanded = !this._expanded;
      if (this._element) {
        this._element.classList.toggle('is-expanded', this._expanded);
      }
      this._emit('expand', { expanded: this._expanded, data: this._data });
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
