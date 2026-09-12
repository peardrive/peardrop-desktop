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
    share: ['title', 'size', 'fileCount', 'peers', 'progress', 'status'],
    shareCompact: ['title', 'size', 'fileCount', 'peers', 'progress', 'statusIcon'],
    // Full view
    full: ['title', 'thumbnail', 'size', 'fileCount', 'status', 'progress', 'speed', 'peers', 'creator', 'tipAddress']
  };

  // Status labels, colors, and compact icons
  const STATUS_CONFIG = {
    sharing: { 
      label: 'Sharing', 
      color: 'var(--di-status-sharing, #22c55e)',
      // Desktop v2 (Figma): an active share is conveyed by the green
      // status text, not a pulsing arrow badge. `icon: null` makes the
      // compact renderer skip the badge entirely (it guards on
      // `config.icon`). Keep the key so the shape matches the other
      // STATUS_CONFIG entries.
      icon: null,
      animate: null
    },
    downloading: { 
      label: 'Downloading', 
      color: 'var(--di-status-downloading, #3b82f6)',
      // No badge: the status text and progress bar already say this, and a
      // bouncing blue arrow on every downloading row was pure noise.
      icon: null,
      animate: null
    },
    // NOTE: there is deliberately no `paused` entry. 'paused' is an engine
    // state; the UI collapses it into `inactive`, because a share the user
    // stopped and a share that failed to come back are the same thing from
    // the card's point of view — it isn't running, and Resume is the fix for
    // both. renderer.js maps it before the status ever reaches here.
    // The drive's data is gone from disk — deleted by hand, or on a volume
    // that is no longer attached. "Missing" was ambiguous (missing peer?
    // missing link?); this says which.
    // Files gone from disk. Card stays visually normal like every other
    // state — only the status text is red. The data can be fetched again
    // from the peer, so this is recoverable, not a tombstone.
    missing: { 
      label: 'Files removed', 
      color: 'var(--di-status-missing, #ef4444)',
      icon: null,
      animate: null,
      dimItem: false
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
      icon: null,
      animate: null
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
    // Figma: an inactive card looks EXACTLY like an active one — same
    // colours, same thumbnail, same layout. The only difference is the
    // status text, which turns red. No badge glyph, no dimming, no
    // desaturation; those were carried over from the old UI.
    inactive: {
      label: 'Inactive',
      color: 'var(--di-status-inactive, #ef4a5f)',
      icon: null,
      animate: null,
      dimItem: false
    },
    // A download that started and stopped: the sender went offline, or the
    // app was closed part-way. Handled as an ordinary status rather than an
    // overlay panel — the card keeps its normal appearance and only the
    // status text changes, exactly like `inactive` and `missing`. The row
    // carries BOTH actions: Resume (continue from where it stopped) and the
    // cancel X (give up and discard).
    // A share that is open locally but whose DHT topic has not been announced
    // yet, so nobody holding the link can reach it. Real, and previously
    // invisible: the announce lags the drive opening by up to ~11s, and the
    // card claimed "Active" for that whole window.
    initiating: {
      label: 'Initiating',
      color: 'var(--di-status-initiating, #f0b840)',
      icon: null,
      animate: null,
      dimItem: false
    },
    // The announce never landed. The files are fine and still local; what
    // failed is discoverability, so the honest word is about reach, not error.
    unreachable: {
      label: 'Not reachable',
      color: 'var(--di-status-unreachable, #ef4a5f)',
      icon: null,
      animate: null,
      dimItem: false
    },
    // The drive's own Corestore folder is gone from ~/peardrop/drives. Its
    // Hyperdrive data and its KEY died with it, so the peardrop:// link is
    // permanently dead and re-sharing would mint a new one.
    //
    // Deliberately NOT called "Files removed": the user's actual files are
    // usually untouched on disk — verified on three real cases where all
    // eight source files existed and opened fine. Only the share is lost.
    lost: {
      label: 'Share lost',
      color: 'var(--di-status-lost, #ef4a5f)',
      icon: null,
      animate: null,
      dimItem: false
    },
    interrupted: {
      label: 'Interrupted',
      color: 'var(--di-status-interrupted, #eab308)',
      icon: null,
      animate: null,
      dimItem: false
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
    // Sits where the old `edit` item was (Figma #18). "Rename" rather than
    // "Edit" or "Edit Alias": the card represents a SHARE, whose name has
    // always been a display string, so renaming it is exactly what happens —
    // no file on disk is touched. ("Alias" also means symlink on macOS, which
    // is the wrong idea entirely.) The disk-vs-display distinction is spelled
    // out in the modal, where the user is about to commit to it.
    { id: 'rename',      label: 'Rename' },
    { id: 'properties',  label: 'Properties' },
    { id: 'show-files',  label: 'Show Files', showWhen: (data) => Array.isArray(data.files) && data.files.length > 1 },
    { id: 'divider' },
    { id: 'resume',      label: 'Resume seeding', icon: '▶',
      showWhen: (data) => data.status === 'error' || data.status === 'inactive' },
    { id: 'pause',       label: 'Stop sharing',   danger: true,
      showWhen: (data) => data.status === 'downloading' || data.status === 'sharing' },
    // confirm: false — renderer.js owns this confirmation now. It shows the
    // app's frosted-glass dialog with the "also delete the file" checkbox;
    // the library's built-in _showConfirmDialog is a plain grey box with no
    // checkbox, and having both meant two dialogs for one action.
    { id: 'remove',      label: 'Remove', danger: true, confirm: false }
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
      const prevData = this._data;
      this._data = this._normalizeData(merged, data.status);

      // A transfer emits progress many times a second, and a full _render()
      // rewrites _contentArea.innerHTML — destroying and rebuilding the row
      // action button each time. A click needs mousedown AND mouseup on the
      // SAME element, so the Cancel button was being replaced mid-click and
      // the browser never fired one. When only the moving numbers changed,
      // patch them in place and leave the DOM alone.
      if (this._element && this._canPatchInPlace(prevData, this._data)) {
        this._patchProgressInPlace();
      } else {
        this._render();
      }
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
     * Priority: explicit inactive/missing/interrupted > inferred from activity
     *           > explicit status > sharing
     */
    _deriveStatus(data, explicitStatus) {
      let derived = 'sharing';

      // Inactive, missing and interrupted are explicit states the host sets
      // deliberately, so they outrank anything inferred below. `inactive`
      // REPLACED `paused` here and the swap is load-bearing: a stopped share
      // usually has progress >= 1, so without this guard the "Complete" branch
      // would win and a card the user just stopped would come back green.
      //
      // `interrupted` needs the same protection for the opposite reason: a
      // dropped download has progress between 0 and 1 and no peers, which is
      // character-for-character the "Connecting" branch below. Without this
      // line an interrupted card silently renders as "Connecting" — with the
      // cancel X and no Resume, since 'connecting' counts as in-progress.
      // 'initiating' and 'unreachable' join the guard for the same reason as
      // the others: a completed share sits at progress >= 1, which the
      // "Complete" branch below would claim, and neither state is inferable
      // from the data — only the engine's announce signal decides them.
      if (explicitStatus === 'inactive'
        || explicitStatus === 'missing'
        || explicitStatus === 'lost'
        || explicitStatus === 'interrupted'
        || explicitStatus === 'initiating'
        || explicitStatus === 'unreachable') {
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
        
        /* Dimmed state — driven by STATUS_CONFIG's dimItem, which today only
           'error' sets. Was .is-paused, from when a stopped share was its own
           status; that state is gone (see the STATUS_CONFIG note), so the
           name now says what it does rather than which status happened to
           use it first.
           NOTE: this whole block lives inside a JS template literal — no
           backticks in these comments, they terminate the string. */
        .drive-item.is-dimmed .drive-item-inner {
          opacity: 0.6;
          filter: saturate(0.3);
        }
        
        .drive-item.is-dimmed .drive-item-title {
          opacity: 0.7;
        }
        
        .drive-item.is-dimmed .drive-item-progress-fill {
          background: var(--di-status-error, #ef4444);
          opacity: 0.5;
        }
        
        /* Menu button stays fully active when dimmed - ALWAYS clickable */
        .drive-item.is-dimmed .drive-item-menu-container {
          opacity: 1 !important;
          filter: none !important;
          pointer-events: auto !important;
        }
        
        .drive-item.is-dimmed .drive-item-menu-btn {
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
        /* App-wide iOS-frosted-glass, matching .confirm-dialog and .modal.
           Was a solid var(--di-menu-bg, #333) box, which stood out as the
           one un-glassed surface in the app. */
        .drive-item-confirm {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(180, 184, 195, 0.22);
          backdrop-filter: blur(6px) saturate(150%);
          -webkit-backdrop-filter: blur(6px) saturate(150%);
          border: 1px solid rgba(255, 255, 255, 0.10);
          border-radius: 16px;
          padding: 20px;
          min-width: 320px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
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

        /* Scrim only — no backdrop-filter. Blurring here would leave the
           dialog's own blur nothing meaningful to work with. */
        .drive-item-confirm-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.60);
          z-index: 10000;
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

    /**
     * True when the only differences between two states are the values that
     * move during a transfer. Anything structural — status, file count,
     * title, thumbnail — still needs a full re-render.
     */
    _canPatchInPlace(prev, next) {
      if (!prev || !next) return false;
      if (prev.status !== next.status) return false;
      const structural = ['id', 'title', 'size', 'fileCount', 'thumbnail', 'type', 'favorite', 'shareLink'];
      for (const key of structural) {
        if (prev[key] !== next[key]) return false;
      }
      // Only reachable if progress/speed/peers moved, which is exactly the
      // case this exists for.
      return true;
    }

    /** Update the moving parts directly, without touching the DOM tree. */
    _patchProgressInPlace() {
      const data = this._data;
      const el = this._element;
      if (!el) return;

      const percent = data.progress != null ? Math.round(data.progress * 100) : null;

      const fill = el.querySelector('.drive-item-progress-fill');
      if (fill && percent != null) fill.style.width = percent + '%';

      const label = el.querySelector('.drive-item-status-label');
      if (label && percent != null) {
        if (data.status === 'downloading') label.textContent = `Downloading (${percent}%)`;
        else if (data.status === 'sharing' && percent < 100) label.textContent = `Sharing (${percent}%)`;
      }

      const speedEl = el.querySelector('.drive-item-status-speed');
      const dashEl = el.querySelector('.drive-item-status-dash');
      // Same rule as the renderer: an idle share shows no rate, however
      // recently it was transferring.
      const _movingNow = data.status === 'downloading'
        || (data.status === 'sharing' && percent != null && percent < 100);
      const hasSpeed = _movingNow && data.speed > 0;

      // Repaint the rate at most once a second. Progress events arrive many
      // times a second and the raw figure swings with every chunk, so an
      // unthrottled number is an unreadable blur. The percentage and bar
      // still update at full rate — only this text is held back.
      // Appearing or disappearing bypasses the throttle, so the dash never
      // lags behind the value it belongs to.
      const now = Date.now();
      const wasShowing = this._speedShowing === true;
      const dueForRepaint = !this._lastSpeedPaintAt || (now - this._lastSpeedPaintAt) >= 1000;

      if (speedEl && (dueForRepaint || wasShowing !== hasSpeed)) {
        speedEl.textContent = hasSpeed ? formatSpeed(data.speed) : '';
        if (dashEl) dashEl.style.display = hasSpeed ? '' : 'none';
        this._lastSpeedPaintAt = now;
        this._speedShowing = hasSpeed;
      }

      const peersEl = el.querySelector('.drive-item-peers');
      if (peersEl && data.peers != null) {
        const n = data.peers || 0;
        const dot = peersEl.querySelector('.drive-item-peers-dot');
        peersEl.textContent = n > 0 ? `${n} peer${n !== 1 ? 's' : ''}` : 'Waiting for peers';
        if (dot) peersEl.insertBefore(dot, peersEl.firstChild);
      }
    }

    _render() {
      // A full render replaces the status line, so the throttle's record of
      // what is on screen no longer applies.
      this._lastSpeedPaintAt = 0;
      this._speedShowing = undefined;

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
      
      // Dimming, for the few statuses that opt in via dimItem (error only,
      // at present). Inactive deliberately does NOT — per the Figma a
      // stopped card looks identical to a running one apart from its status
      // text.
      const statusConfig = STATUS_CONFIG[data.status];
      if (statusConfig && statusConfig.dimItem) {
        this._element.classList.add('is-dimmed');
      } else {
        this._element.classList.remove('is-dimmed');
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
        } else if (data.status === 'interrupted') {
          // How far it got is the whole decision the user is making here —
          // resume this, or throw it away. Carrying the percentage in the
          // status text is what the old overlay's "Stopped at 42%" line was
          // for; inline, it costs no extra row.
          _statusText = _percent != null ? `Disconnected at ${_percent}%` : 'Disconnected';
        }

        const _isGroup = Array.isArray(data.files) && data.files.length > 1;
        const _paperSvg = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z"/></svg>';

        // Prefix decision — "Picture • Completed" pattern from Figma.
        // Skip for in-progress transfers, failed downloads, and inactive
        // drives; those states already carry the meaning on their own.
        const _showPrefix = data.status === 'sharing'
          || data.status === 'complete';
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

        // Transfer rate, dash-separated after the status. Only while data is
        // actually moving — a dash trailing a completed or stopped item
        // would be noise.
        // Emit these for ANY moving transfer, even at speed 0. They used to
        // be conditional on speed > 0, but a transfer always starts at 0 —
        // so the spans were never created, and _patchProgressInPlace (which
        // updates the numbers without rebuilding the DOM) then had nothing
        // to write into. The speed silently never appeared.
        // Empty text + a hidden dash is the "no reading yet" state.
        // Only while data is genuinely moving. `status === 'sharing'` stays
        // true for a share that has finished serving and is simply seeding,
        // so keying off it left a stale rate sitting next to "Active" — the
        // share reads as busy when nothing is happening.
        // 'sharing-progress' is set above only when the percentage is < 100.
        const _isMoving = data.status === 'downloading'
          || _dataStatus === 'sharing-progress';
        if (_isMoving) {
          const _hasSpeed = data.speed > 0;
          _lineParts.push(`<span class="drive-item-status-dash" aria-hidden="true"${_hasSpeed ? '' : ' style="display:none"'}>&ndash;</span>`);
          _lineParts.push(`<span class="drive-item-status-speed">${_hasSpeed ? formatSpeed(data.speed) : ''}</span>`);
        }

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
      //   everything else       → GREEN Open pill (shared / completed)
      // "Everything else" catches all drives with a local file — matches
      // Amir's intent that every openable row has an Open button.
      const _percentForBtn = data.progress != null ? Math.round(data.progress * 100) : null;
      const _isInProgress = (data.status === 'downloading' || data.status === 'connecting')
        || (data.status === 'sharing' && _percentForBtn != null && _percentForBtn < 100);
      // 'missing' IS here: the local file is gone, but the share link still
      // is not — so Retry means "download it again from the peer", which is
      // the one useful action on such a row. (An earlier version left it
      // out on the reasoning that a resume cannot work; correct about
      // resume, wrong about what the button should do.)
      // A SHARE the user stopped is NOT a failure, so it gets no Retry.
      // Stopped shares and unresumable downloads both carry
      // `status: 'inactive'` since `paused` was folded into it, but they mean
      // opposite things: "something went wrong" versus "you turned this off".
      // Offering Retry on the second reads as an error report for the user's
      // own action. Excluded here so it falls through to the ordinary
      // Open/folder handling below — the files are still on disk and still
      // openable. Re-starting the share lives in the 3-dot menu, which is
      // where a deliberate state change belongs.
      const _isStoppedShare = data.status === 'inactive' && data.type !== 'download';
      // 'missing' means two different things depending on direction:
      //
      //   DOWNLOAD -> the downloaded file was deleted from disk, but the share
      //       link still works. Retry re-fetches it from the peer. Useful.
      //
      //   SHARE    -> this drive's own storage is gone. It can never announce
      //       or serve again, and re-sharing the source files would mint a
      //       NEW key, so the old link is dead whatever we do. Retry has
      //       nothing to retry; the only honest action is to clear the row.
      const _isDeadShare = data.status === 'lost';
      // 'unreachable' IS a failure worth retrying — re-announcing is exactly
      // what Retry does for it. 'initiating' is not: it is still in progress,
      // and gets the ordinary Open/folder treatment below.
      const _isFailed = !_isStoppedShare && !_isDeadShare && (
        data.status === 'error'
        || data.status === 'inactive'
        || data.status === 'missing'
        || data.status === 'unreachable');
      // 'missing' keeps Retry: for a download whose file was deleted, the
      // share link still works and Retry genuinely re-fetches it. Nothing
      // sets that status today (see statusForResumeError in renderer.js) —
      // re-sourcing it from a real file-existence check is step 2.
      const _isGroupBtn = Array.isArray(data.files) && data.files.length > 1;
      // Interrupted is the one state with TWO actions, so it is checked
      // first: Resume to continue from where it stopped, and the same cancel
      // X an in-flight transfer gets, to discard it. Rendered inline on the
      // row like every other action — this state used to be an overlay panel
      // covering the card, which hid the very information (name, size, how
      // far it got) the user needs to decide between the two.
      if (data.status === 'interrupted') {
        // Two icon buttons, same circle as the in-flight cancel: a play
        // triangle to resume, an X to discard. Icons rather than a "Resume"
        // pill so the pair reads as one control group and the row keeps the
        // width for the filename.
        // The triangle is a filled path with a rounded join, nudged 1px right
        // of centre — a play glyph centred on its bounding box always looks
        // left-heavy, because its visual mass sits toward the flat edge.
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-resume" data-row-action="resume" aria-label="Resume"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 6.5l8.5 5.5L9 17.5z"/></svg></button>`);
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-cancel" data-row-action="remove" aria-label="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/></svg></button>`);
      } else if (_isInProgress) {
        // SVG cross, not '&times;'. A glyph sits wherever the font's
        // metrics put it — flex centring aligns the text BOX, not the mark
        // inside it, which left the X sitting low in the circle.
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-cancel" data-row-action="remove" aria-label="Cancel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7.5 7.5l9 9M16.5 7.5l-9 9"/></svg></button>`);
      } else if (_isFailed) {
        // "Resume" for a download that was interrupted — the engine really
        // does continue from where it stopped, so "Retry" would understate it
        // and suggest starting over. "Retry" stays for a file that is gone
        // from disk or a drive that errored, where it genuinely re-fetches.
        const _isPartialDownload = data.type === 'download' && data.status === 'inactive';
        const _retryLabel = _isPartialDownload ? 'Resume' : 'Retry';
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-retry" data-row-action="resume" aria-label="${_retryLabel}">${_retryLabel}</button>`);
      } else if (_isDeadShare) {
        // Two actions, because the files are usually still on disk: rebuild
        // the share from them (a NEW link — the old key died with the
        // Corestore), or clear the dead row away.
        // Share first: it is the constructive one, and Clear is irreversible.
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-open" data-row-action="reshare" aria-label="Share again">Share</button>`);
        // `remove` runs the ordinary removal flow, which for a share never
        // touches real files.
        parts.push(`<button type="button" class="drive-item-row-action drive-item-row-action-retry" data-row-action="remove" aria-label="Clear">Clear</button>`);
      } else if (_isGroupBtn) {
        // Folders (multi-file drives) get "View files" where a single
        // file gets "Open". Folders get NO button — clicking the card
        // itself opens the contents modal (Figma screen #22), which is
        // affordance enough. Desktop uses a modal rather than an inline
        // expand because the list is a 2-column CSS grid: expanding one
        // card stretches its row-sibling to match and shoves every row
        // below it down. The inline expand machinery is untouched and
        // still drives the mobile (single-column) layout.
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

        // Folders (multi-file drives): desktop opens the contents modal,
        // mobile keeps the inline expand. Gated on the same 600px
        // breakpoint the desktop layout uses — the 2-column grid can't
        // take an inline expand, the single-column mobile list can.
        if (this._data.files && this._data.files.length > 1) {
          if (window.innerWidth >= 600) {
            this._triggerAction('view-files');
          } else {
            this._toggleExpand();
          }
          return;
        }

        // Regular click (single-file items)
        this._emit('click', this._data);
      });
      
      // Right-click context menu on the entire element.
      // `showMenu: false` has to suppress this too — it used to hide only the
      // kebab button, so right-click (and the long-press below) still opened
      // the very menu the caller had asked not to exist. Both routes go
      // through _openMenuAt, which now refuses when the menu is off.
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

    /**
     * Only ONE drive-item menu may be open at a time. Each DriveItem owns
     * its own menu element, so without this every kebab/right-click left
     * the previous menu on screen. Tracked on the constructor so it's
     * shared across every instance.
     */
    _dismissOtherMenus() {
      const ctor = this.constructor;
      if (ctor._openInstance && ctor._openInstance !== this) {
        try { ctor._openInstance._closeMenu(); } catch (_) {}
      }
      ctor._openInstance = this;
    }

    _openMenu() {
      const menu = this._getMenu();
      const btn = this._menuContainer ? this._menuContainer.querySelector('.drive-item-menu-btn') : null;
      if (!menu || !btn) return;
      this._dismissOtherMenus();

      // Re-render menu items (they may change based on status)
      menu.innerHTML = this._buildMenuHTML(this._data);

      // Move menu to body so it escapes all overflow/stacking contexts
      const rect = btn.getBoundingClientRect();
      document.body.appendChild(menu);
      menu.style.position = 'fixed';
      menu.style.transform = 'translateY(0) scale(1)';
      menu.style.opacity = '1';
      menu.style.visibility = 'visible';
      menu.classList.add('open');

      // Measure, then place. Same clamp as the right-click path so the
      // menu can never leave the window on either axis.
      menu.style.right = 'auto';
      menu.style.left = '0px';
      menu.style.top = '0px';
      const anchorY = (window.innerHeight - rect.bottom) < (menu.offsetHeight + 8)
        ? rect.top - menu.offsetHeight - 4      // flip above the button
        : rect.bottom + 4;
      const placed = this._clampToViewport(menu, { x: rect.right, y: anchorY });
      menu.style.left = placed.left + 'px';
      menu.style.top = placed.top + 'px';

      this._element.classList.add('menu-open');
      this._menuOpen = true;
    }

    /**
     * Clamp a fixed-position menu so it stays fully inside the window.
     * Returns {left, top} in viewport pixels.
     *
     * `preferAbove` flips the menu above the anchor when it won't fit
     * below; the final min/max still guarantees it lands on screen even
     * if it fits in neither direction (a menu taller than the window
     * pins to the top edge rather than hanging off the bottom).
     */
    _clampToViewport(menu, { x, y, preferRightEdge = true }) {
      const MARGIN = 8;
      const mw = menu.offsetWidth;
      const mh = menu.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: default is the menu's RIGHT edge at the anchor
      // (menus hang leftward from the kebab). If that would push it off
      // the left edge, hang rightward from the anchor instead.
      let left = preferRightEdge ? x - mw : x;
      if (left < MARGIN) left = x;
      left = Math.min(left, vw - mw - MARGIN);
      left = Math.max(MARGIN, left);

      // Vertical: below the anchor, flipping above when short on room.
      let top = y;
      if (top + mh + MARGIN > vh) {
        const above = y - mh;
        top = above >= MARGIN ? above : vh - mh - MARGIN;
      }
      top = Math.max(MARGIN, top);

      return { left, top };
    }

    _openMenuAt(x, y) {
      // Single choke point for every way the menu can open — kebab click,
      // right-click, and touch long-press. `showMenu: false` means no menu,
      // by any route.
      if (!this._showMenu) return;
      const menu = this._getMenu();
      if (!menu) return;
      this._dismissOtherMenus();

      // Re-render menu items
      menu.innerHTML = this._buildMenuHTML(this._data);

      // Move menu to body, make it measurable, THEN position it. Setting
      // top/right straight from the cursor let the menu hang outside the
      // window — right-clicking the last row put half the menu below the
      // bottom edge.
      document.body.appendChild(menu);
      menu.style.position = 'fixed';
      menu.style.right = 'auto';
      menu.style.left = '0px';
      menu.style.top = '0px';
      menu.style.transform = 'translateY(0) scale(1)';
      menu.style.opacity = '1';
      menu.style.visibility = 'visible';
      menu.classList.add('open');

      const { left, top } = this._clampToViewport(menu, { x, y });
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';

      this._element.classList.add('menu-open');
      this._menuOpen = true;
    }

    _closeMenu() {
      if (this.constructor._openInstance === this) this.constructor._openInstance = null;
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
