/**
 * IntegratedList - ScrollList + DriveItem Integration
 * 
 * Bridges ScrollList (list management) with DriveItem (item rendering).
 * ScrollList handles scrolling/ordering, DriveItem handles display/menus.
 * 
 * @module IntegratedList
 * @version 0.1.0
 * 
 * EXPORTS:
 *   - IntegratedList (class)
 * 
 * DEPENDENCIES:
 *   - ScrollList (../scroll-list/scroll-list.js)
 *   - DriveItem (../drive-item/drive-item.js)
 * 
 * USAGE:
 *   const list = new IntegratedList(container, {
 *     emptyMessage: 'No drives yet',
 *     driveItemOptions: { show: 'compact' },
 *     onAction: (action, data) => console.log(action, data)
 *   });
 *   
 *   list.addDrive({ id: '123', title: 'My File', size: 1024 });
 *   list.updateDrive('123', { progress: 0.5, speed: 50000 });
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['../scroll-list/scroll-list', '../drive-item/drive-item'], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('../scroll-list/scroll-list'),
      require('../drive-item/drive-item')
    );
  } else {
    root.IntegratedList = factory(root.ScrollList, root.DriveItem);
  }
}(typeof self !== 'undefined' ? self : this, function(ScrollList, DriveItem) {
  'use strict';

  const VERSION = '0.1.0';

  /**
   * IntegratedList Class
   */
  class IntegratedList {
    /**
     * @param {HTMLElement|string} container - Container element or selector
     * @param {Object} options - Configuration options
     * @param {string} options.emptyMessage - Message when list is empty
     * @param {Object} options.driveItemOptions - Options passed to DriveItem instances
     * @param {Function} options.onAction - Callback for DriveItem actions
     * @param {Function} options.onClick - Callback for item clicks
     */
    constructor(container, options = {}) {
      if (typeof container === 'string') {
        this.container = document.querySelector(container);
      } else {
        this.container = container;
      }

      if (!this.container) {
        throw new Error('IntegratedList: container not found');
      }

      this.options = {
        emptyMessage: 'No drives',
        driveItemOptions: {},
        onAction: null,
        onClick: null,
        ...options
      };

      // Store DriveItem instances by id
      this._driveItems = new Map();
      this._listeners = {};
      
      // Data array (source of truth)
      this._drives = [];

      this._init();
    }

    // ==================== INITIALIZATION ====================

    _init() {
      this.container.classList.add('integrated-list-container');
      
      // Create list wrapper
      this._listWrapper = document.createElement('div');
      this._listWrapper.className = 'integrated-list-wrapper';
      
      this._scrollArea = document.createElement('div');
      this._scrollArea.className = 'integrated-list-scroll';
      
      this._listElement = document.createElement('div');
      this._listElement.className = 'integrated-list';
      this._listElement.setAttribute('role', 'list');
      
      this._emptyElement = document.createElement('div');
      this._emptyElement.className = 'integrated-list-empty';
      this._emptyElement.textContent = this.options.emptyMessage;
      
      this._scrollArea.appendChild(this._listElement);
      this._listWrapper.appendChild(this._scrollArea);
      this._listWrapper.appendChild(this._emptyElement);
      this.container.appendChild(this._listWrapper);
      
      this._injectStyles();
      this._updateEmptyState();
    }

    _injectStyles() {
      if (document.getElementById('integrated-list-styles')) return;
      
      const style = document.createElement('style');
      style.id = 'integrated-list-styles';
      style.textContent = `
        .integrated-list-container {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        
        .integrated-list-wrapper {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
        }
        
        .integrated-list-scroll {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          scrollbar-width: thin;
        }
        
        .integrated-list-scroll::-webkit-scrollbar {
          width: 6px;
        }
        
        .integrated-list-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .integrated-list-scroll::-webkit-scrollbar-thumb {
          background: rgba(128, 128, 128, 0.4);
          border-radius: 3px;
        }
        
        .integrated-list {
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .integrated-list-item {
          position: relative;
        }
        
        .integrated-list-empty {
          display: none;
          padding: 32px 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
        }
        
        .integrated-list-empty.visible {
          display: block;
        }
      `;
      document.head.appendChild(style);
    }

    // ==================== PUBLIC API ====================

    /**
     * Add a drive to the list
     * @param {Object} data - Drive data
     * @returns {IntegratedList}
     */
    addDrive(data) {
      if (!data.id) {
        data.id = 'drive_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      }
      
      // Check for duplicate
      if (this._driveItems.has(data.id)) {
        console.warn('IntegratedList: Drive already exists:', data.id);
        return this.updateDrive(data.id, data);
      }
      
      // Add to data array
      this._drives.push(data);
      
      // Create DOM container for the DriveItem
      const itemContainer = document.createElement('div');
      itemContainer.className = 'integrated-list-item';
      itemContainer.dataset.id = data.id;
      itemContainer.setAttribute('role', 'listitem');
      this._listElement.appendChild(itemContainer);
      
      // Create DriveItem instance
      const driveItem = new DriveItem(itemContainer, {
        data: data,
        ...this.options.driveItemOptions,
        onAction: (action, itemData) => this._handleAction(action, itemData)
      });
      
      // Listen for DriveItem events
      driveItem.on('click', (itemData) => this._handleClick(itemData));
      driveItem.on('transition-complete', (event) => this._emit('transition', event));
      
      this._driveItems.set(data.id, driveItem);
      this._updateEmptyState();
      this._emit('add', data);
      
      return this;
    }

    /**
     * Add drive to beginning of list
     * @param {Object} data - Drive data
     * @returns {IntegratedList}
     */
    prependDrive(data) {
      if (!data.id) {
        data.id = 'drive_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      }
      
      if (this._driveItems.has(data.id)) {
        return this.updateDrive(data.id, data);
      }
      
      // Add to beginning of data array
      this._drives.unshift(data);
      
      // Create DOM container
      const itemContainer = document.createElement('div');
      itemContainer.className = 'integrated-list-item';
      itemContainer.dataset.id = data.id;
      itemContainer.setAttribute('role', 'listitem');
      
      // Insert at beginning
      if (this._listElement.firstChild) {
        this._listElement.insertBefore(itemContainer, this._listElement.firstChild);
      } else {
        this._listElement.appendChild(itemContainer);
      }
      
      // Create DriveItem
      const driveItem = new DriveItem(itemContainer, {
        data: data,
        ...this.options.driveItemOptions,
        onAction: (action, itemData) => this._handleAction(action, itemData)
      });
      
      driveItem.on('click', (itemData) => this._handleClick(itemData));
      driveItem.on('transition-complete', (event) => this._emit('transition', event));
      
      this._driveItems.set(data.id, driveItem);
      this._updateEmptyState();
      this._emit('add', data);
      
      return this;
    }

    /**
     * Update a drive by id
     * @param {string} id - Drive id
     * @param {Object} updates - Data to merge
     * @returns {IntegratedList}
     */
    updateDrive(id, updates) {
      const driveItem = this._driveItems.get(id);
      if (!driveItem) {
        console.warn('IntegratedList: Drive not found:', id);
        return this;
      }
      
      // Update data array
      const index = this._drives.findIndex(d => d.id === id);
      if (index !== -1) {
        this._drives[index] = { ...this._drives[index], ...updates };
      }
      
      // Update DriveItem
      driveItem.update(updates);
      this._emit('update', driveItem.getData());
      
      return this;
    }

    /**
     * Remove a drive by id
     * @param {string} id - Drive id
     * @returns {IntegratedList}
     */
    removeDrive(id) {
      const driveItem = this._driveItems.get(id);
      if (!driveItem) {
        return this;
      }
      
      // Remove from data array
      this._drives = this._drives.filter(d => d.id !== id);
      
      // Destroy DriveItem
      const data = driveItem.getData();
      driveItem.destroy();
      this._driveItems.delete(id);
      
      // Remove DOM container
      const container = this._listElement.querySelector(`[data-id="${id}"]`);
      if (container) {
        container.remove();
      }
      
      this._updateEmptyState();
      this._emit('remove', data);
      
      return this;
    }

    /**
     * Get drive data by id
     * @param {string} id - Drive id
     * @returns {Object|undefined}
     */
    getDrive(id) {
      const driveItem = this._driveItems.get(id);
      return driveItem ? driveItem.getData() : undefined;
    }

    /**
     * Get all drives
     * @returns {Array}
     */
    getDrives() {
      return this._drives.map(d => ({ ...d }));
    }

    /**
     * Get drive count
     * @returns {number}
     */
    getCount() {
      return this._drives.length;
    }

    /**
     * Clear all drives
     * @returns {IntegratedList}
     */
    clear() {
      for (const [id, driveItem] of this._driveItems) {
        driveItem.destroy();
      }
      this._driveItems.clear();
      this._drives = [];
      this._listElement.innerHTML = '';
      this._updateEmptyState();
      this._emit('clear');
      return this;
    }

    /**
     * Scroll to top
     * @returns {IntegratedList}
     */
    scrollToTop() {
      this._scrollArea.scrollTop = 0;
      return this;
    }

    /**
     * Scroll to bottom
     * @returns {IntegratedList}
     */
    scrollToBottom() {
      this._scrollArea.scrollTop = this._scrollArea.scrollHeight;
      return this;
    }

    /**
     * Scroll to specific drive
     * @param {string} id - Drive id
     * @returns {IntegratedList}
     */
    scrollToDrive(id) {
      const container = this._listElement.querySelector(`[data-id="${id}"]`);
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return this;
    }

    /**
     * Set visibility for all DriveItems
     * @param {Array|string} fields - Visibility preset or field list
     * @returns {IntegratedList}
     */
    setVisibility(fields) {
      for (const driveItem of this._driveItems.values()) {
        driveItem.setVisibility(fields);
      }
      // Update default options for new items
      this.options.driveItemOptions.show = fields;
      return this;
    }

    /**
     * Set theme for all DriveItems
     * @param {string|Object} theme - Theme name or custom properties
     * @returns {IntegratedList}
     */
    setTheme(theme) {
      for (const driveItem of this._driveItems.values()) {
        driveItem.setTheme(theme);
      }
      this.options.driveItemOptions.theme = theme;
      return this;
    }

    /**
     * Add event listener
     * @param {string} event - Event name (add, update, remove, clear, action, click, transition)
     * @param {Function} callback - Event handler
     * @returns {IntegratedList}
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
     * @returns {IntegratedList}
     */
    off(event, callback) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
      }
      return this;
    }

    /**
     * Destroy the component
     */
    destroy() {
      for (const driveItem of this._driveItems.values()) {
        driveItem.destroy();
      }
      this._driveItems.clear();
      this._drives = [];
      this.container.innerHTML = '';
      this.container.classList.remove('integrated-list-container');
      this._listeners = {};
    }

    /**
     * Get version
     * @returns {string}
     */
    static get version() {
      return VERSION;
    }

    // ==================== PRIVATE METHODS ====================

    _updateEmptyState() {
      if (this._drives.length === 0) {
        this._emptyElement.classList.add('visible');
      } else {
        this._emptyElement.classList.remove('visible');
      }
    }

    _handleAction(action, data) {
      this._emit('action', { action, data });
      if (this.options.onAction) {
        this.options.onAction(action, data);
      }
    }

    _handleClick(data) {
      this._emit('click', data);
      if (this.options.onClick) {
        this.options.onClick(data);
      }
    }

    _emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(cb => cb(data));
      }
    }
  }

  return IntegratedList;
}));
