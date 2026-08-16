/**
 * ScrollList - Universal Scrolling List Component
 * 
 * A standalone, portable scrolling list that works on any platform.
 * No dependencies. Pure DOM. Touch and mouse ready.
 * 
 * @module ScrollList
 * @version 1.0.0
 * 
 * EXPORTS:
 *   - ScrollList (class)     — Main component class
 *   - createScrollList (fn)  — Factory function
 * 
 * EVENTS EMITTED:
 *   - 'item:click'    — { item, index, element }
 *   - 'item:action'   — { item, index, action, element }
 *   - 'scroll'        — { scrollTop, scrollHeight, clientHeight }
 *   - 'empty'         — List became empty
 *   - 'update'        — List data changed
 * 
 * DEPENDENCIES: None (pure DOM)
 * 
 * USAGE:
 *   const list = new ScrollList(container, {
 *     renderItem: (item) => `<div>${item.name}</div>`,
 *     emptyMessage: 'No items',
 *     onItemClick: (item, index) => console.log(item)
 *   });
 *   list.setItems([{id: 1, name: 'Test'}]);
 */

(function(root, factory) {
  // Universal Module Definition (UMD)
  // Works in Node, AMD, and browser globals
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ScrollList = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  /**
   * Default item renderer
   * Override this via options.renderItem
   */
  function defaultRenderItem(item, index) {
    const id = item.id || item.driveId || index;
    const name = item.name || item.label || `Item ${index + 1}`;
    const status = item.status || '';
    
    return `
      <div class="scroll-list-item" data-index="${index}" data-id="${id}">
        <div class="scroll-list-item-content">
          <span class="scroll-list-item-name">${escapeHtml(name)}</span>
          ${status ? `<span class="scroll-list-item-status">${escapeHtml(status)}</span>` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    if (text == null) return '';
    const str = String(text);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Simple event emitter mixin
   */
  const EventEmitter = {
    _events: null,
    
    on(event, callback) {
      if (!this._events) this._events = {};
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(callback);
      return this;
    },
    
    off(event, callback) {
      if (!this._events || !this._events[event]) return this;
      if (!callback) {
        this._events[event] = [];
      } else {
        this._events[event] = this._events[event].filter(cb => cb !== callback);
      }
      return this;
    },
    
    emit(event, data) {
      if (!this._events || !this._events[event]) return this;
      this._events[event].forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`ScrollList event error [${event}]:`, err);
        }
      });
      return this;
    }
  };

  /**
   * ScrollList Class
   */
  class ScrollList {
    /**
     * @param {HTMLElement|string} container - Container element or selector
     * @param {Object} options - Configuration options
     * @param {Function} options.renderItem - Function to render each item (item, index) => HTML string
     * @param {string} options.emptyMessage - Message when list is empty
     * @param {Function} options.onItemClick - Callback when item is clicked
     * @param {Function} options.onItemAction - Callback when item action button is clicked
     * @param {string} options.itemClass - Additional class for items
     * @param {boolean} options.showActions - Show action buttons on items
     */
    constructor(container, options = {}) {
      // Resolve container
      if (typeof container === 'string') {
        this.container = document.querySelector(container);
      } else {
        this.container = container;
      }
      
      if (!this.container) {
        throw new Error('ScrollList: Container element not found');
      }

      // Options with defaults
      this.options = {
        renderItem: defaultRenderItem,
        emptyMessage: 'No items',
        itemClass: '',
        showActions: false,
        keyField: 'id', // Field to use for item identity
        ...options
      };

      // State
      this.items = [];
      this._events = {};
      
      // Initialize
      this._init();
    }

    /**
     * Initialize the component
     */
    _init() {
      // Add base class
      this.container.classList.add('scroll-list-container');
      
      // Create wrapper structure
      this.wrapper = document.createElement('div');
      this.wrapper.className = 'scroll-list-wrapper';
      
      this.listElement = document.createElement('div');
      this.listElement.className = 'scroll-list';
      this.listElement.setAttribute('role', 'list');
      
      this.emptyElement = document.createElement('div');
      this.emptyElement.className = 'scroll-list-empty';
      this.emptyElement.textContent = this.options.emptyMessage;
      
      this.wrapper.appendChild(this.listElement);
      this.wrapper.appendChild(this.emptyElement);
      this.container.appendChild(this.wrapper);
      
      // Inject styles if not already present
      this._injectStyles();
      
      // Bind events
      this._bindEvents();
      
      // Initial render
      this._render();
    }

    /**
     * Inject component styles (once per page)
     */
    _injectStyles() {
      if (document.getElementById('scroll-list-styles')) return;
      
      const style = document.createElement('style');
      style.id = 'scroll-list-styles';
      style.textContent = `
        /* ScrollList Component Styles */
        .scroll-list-container {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
        }
        
        .scroll-list-wrapper {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          overflow: hidden;
        }
        
        .scroll-list {
          height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          -webkit-overflow-scrolling: touch; /* Smooth iOS scrolling */
          overscroll-behavior: contain; /* Prevent scroll chaining */
          scrollbar-width: thin;
        }
        
        /* Custom scrollbar for webkit */
        .scroll-list::-webkit-scrollbar {
          width: 6px;
        }
        
        .scroll-list::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .scroll-list::-webkit-scrollbar-thumb {
          background: rgba(128, 128, 128, 0.4);
          border-radius: 3px;
        }
        
        .scroll-list::-webkit-scrollbar-thumb:hover {
          background: rgba(128, 128, 128, 0.6);
        }
        
        .scroll-list-item {
          position: relative;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(128, 128, 128, 0.2);
          cursor: pointer;
          user-select: none;
          -webkit-user-select: none;
          transition: background-color 0.15s ease;
        }
        
        .scroll-list-item:hover {
          background: rgba(128, 128, 128, 0.1);
        }
        
        .scroll-list-item:active {
          background: rgba(128, 128, 128, 0.2);
        }
        
        .scroll-list-item:last-child {
          border-bottom: none;
        }
        
        .scroll-list-item-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        
        .scroll-list-item-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .scroll-list-item-status {
          font-size: 0.85em;
          opacity: 0.7;
        }
        
        .scroll-list-item-actions {
          display: flex;
          gap: 4px;
        }
        
        .scroll-list-item-action {
          padding: 4px 8px;
          border: none;
          background: rgba(128, 128, 128, 0.2);
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.85em;
        }
        
        .scroll-list-item-action:hover {
          background: rgba(128, 128, 128, 0.3);
        }
        
        .scroll-list-empty {
          display: none;
          padding: 32px 16px;
          text-align: center;
          opacity: 0.6;
        }
        
        .scroll-list-empty.visible {
          display: block;
        }
        
        /* Touch-friendly sizing for mobile */
        @media (pointer: coarse) {
          .scroll-list-item {
            padding: 16px;
            min-height: 48px;
          }
          
          .scroll-list-item-action {
            padding: 8px 12px;
            min-height: 36px;
          }
        }
      `;
      
      document.head.appendChild(style);
    }

    /**
     * Bind DOM events
     */
    _bindEvents() {
      // Click handling with event delegation
      this.listElement.addEventListener('click', (e) => {
        const item = e.target.closest('.scroll-list-item');
        if (!item) return;
        
        const index = parseInt(item.dataset.index, 10);
        const itemData = this.items[index];
        
        // Check if action button was clicked
        const action = e.target.closest('.scroll-list-item-action');
        if (action) {
          const actionName = action.dataset.action;
          this.emit('item:action', { item: itemData, index, action: actionName, element: item });
          if (this.options.onItemAction) {
            this.options.onItemAction(itemData, index, actionName);
          }
          return;
        }
        
        // Regular item click
        this.emit('item:click', { item: itemData, index, element: item });
        if (this.options.onItemClick) {
          this.options.onItemClick(itemData, index);
        }
      });

      // Scroll events
      this.listElement.addEventListener('scroll', () => {
        this.emit('scroll', {
          scrollTop: this.listElement.scrollTop,
          scrollHeight: this.listElement.scrollHeight,
          clientHeight: this.listElement.clientHeight
        });
      }, { passive: true });
    }

    /**
     * Render the list
     */
    _render() {
      if (this.items.length === 0) {
        this.listElement.innerHTML = '';
        this.emptyElement.classList.add('visible');
        this.emit('empty');
        return;
      }
      
      this.emptyElement.classList.remove('visible');
      
      const html = this.items.map((item, index) => {
        return this.options.renderItem(item, index);
      }).join('');
      
      this.listElement.innerHTML = html;
      
      // Add role attributes for accessibility
      const itemElements = this.listElement.querySelectorAll('.scroll-list-item');
      itemElements.forEach(el => el.setAttribute('role', 'listitem'));
    }

    // ==================== PUBLIC API ====================

    /**
     * Set all items (replaces existing)
     * @param {Array} items - Array of item data
     */
    setItems(items) {
      this.items = Array.isArray(items) ? [...items] : [];
      this._render();
      this.emit('update', { items: this.items, count: this.items.length });
      return this;
    }

    /**
     * Get all items
     * @returns {Array}
     */
    getItems() {
      return [...this.items];
    }

    /**
     * Get item count
     * @returns {number}
     */
    getCount() {
      return this.items.length;
    }

    /**
     * Add item to end
     * @param {Object} item
     */
    addItem(item) {
      this.items.push(item);
      this._render();
      this.emit('update', { items: this.items, count: this.items.length });
      return this;
    }

    /**
     * Add item to beginning
     * @param {Object} item
     */
    prependItem(item) {
      this.items.unshift(item);
      this._render();
      this.emit('update', { items: this.items, count: this.items.length });
      return this;
    }

    /**
     * Remove item by index
     * @param {number} index
     */
    removeAt(index) {
      if (index >= 0 && index < this.items.length) {
        this.items.splice(index, 1);
        this._render();
        this.emit('update', { items: this.items, count: this.items.length });
      }
      return this;
    }

    /**
     * Remove item by key field match
     * @param {*} value - Value to match against keyField
     */
    removeByKey(value) {
      const keyField = this.options.keyField;
      const index = this.items.findIndex(item => item[keyField] === value);
      if (index !== -1) {
        this.removeAt(index);
      }
      return this;
    }

    /**
     * Update item by index
     * @param {number} index
     * @param {Object} updates - Properties to merge
     */
    updateAt(index, updates) {
      if (index >= 0 && index < this.items.length) {
        this.items[index] = { ...this.items[index], ...updates };
        this._render();
        this.emit('update', { items: this.items, count: this.items.length });
      }
      return this;
    }

    /**
     * Update item by key field match
     * @param {*} value - Value to match against keyField
     * @param {Object} updates - Properties to merge
     */
    updateByKey(value, updates) {
      const keyField = this.options.keyField;
      const index = this.items.findIndex(item => item[keyField] === value);
      if (index !== -1) {
        this.updateAt(index, updates);
      }
      return this;
    }

    /**
     * Find item by key
     * @param {*} value
     * @returns {Object|undefined}
     */
    findByKey(value) {
      const keyField = this.options.keyField;
      return this.items.find(item => item[keyField] === value);
    }

    /**
     * Clear all items
     */
    clear() {
      this.items = [];
      this._render();
      this.emit('update', { items: this.items, count: 0 });
      this.emit('empty');
      return this;
    }

    /**
     * Scroll to top
     */
    scrollToTop() {
      this.listElement.scrollTop = 0;
      return this;
    }

    /**
     * Scroll to bottom
     */
    scrollToBottom() {
      this.listElement.scrollTop = this.listElement.scrollHeight;
      return this;
    }

    /**
     * Scroll to specific item
     * @param {number} index
     */
    scrollToIndex(index) {
      const item = this.listElement.querySelector(`[data-index="${index}"]`);
      if (item) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return this;
    }

    /**
     * Set empty message
     * @param {string} message
     */
    setEmptyMessage(message) {
      this.options.emptyMessage = message;
      this.emptyElement.textContent = message;
      return this;
    }

    /**
     * Force re-render
     */
    refresh() {
      this._render();
      return this;
    }

    /**
     * Destroy the component
     */
    destroy() {
      this.container.innerHTML = '';
      this.container.classList.remove('scroll-list-container');
      this._events = {};
      this.items = [];
    }
  }

  // Mix in EventEmitter
  Object.assign(ScrollList.prototype, EventEmitter);

  /**
   * Factory function for convenience
   */
  function createScrollList(container, options) {
    return new ScrollList(container, options);
  }

  // Export both
  ScrollList.create = createScrollList;
  
  return ScrollList;
}));
