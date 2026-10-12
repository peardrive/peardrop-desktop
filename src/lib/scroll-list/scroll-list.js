/**
 * ScrollList - Universal Slot-Based Scrolling Container
 * A standalone container that manages slots for child components.
 * ScrollList handles scrolling, ordering, reordering.
 * Child components control their own rendering inside slots.
 * @module ScrollList
 * @version 2.0.0
 * ARCHITECTURE:
 * ScrollList creates empty slot containers
 * Child components mount into slots and own their content
 * "Blocks inside blocks" - each layer controls its own space
 * EXPORTS:
 * ScrollList (class)
 * EVENTS EMITTED:
 * 'slot:created' — { id, slot, index }
 * 'slot:removed' — { id }
 * 'slot:reordered' — { id, fromIndex, toIndex }
 * 'scroll' — { scrollTop, scrollHeight, clientHeight }
 * 'empty' — List became empty
 * DEPENDENCIES: None (pure DOM)
 * USAGE (Slot-based):
 *   const list = new ScrollList(container);
 *   const slot = list.createSlot({ id: 'item_1' });
 *   const item = new DriveItem(slot, { data: {...} });
 * USAGE (Factory-based):
 *   const list = new ScrollList(container, {
 *     itemFactory: (slot, data) => new DriveItem(slot, { data })
 *   });
 *   list.addItem(driveData);
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.ScrollList = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const VERSION = '2.0.0';

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
     * @param {string} options.emptyMessage - Message when list is empty
     * @param {number} options.gap - Gap between slots in pixels (default: 8)
     * @param {number} options.padding - Padding around list in pixels (default: 8)
     * @param {string} options.keyField - Field to use for item identity (default: 'id')
     * @param {Function} options.itemFactory - Optional factory: (slot, data) => component
     * @param {Function} options.onSlotClick - Called when slot is clicked (if no component handles it)
     */
    constructor(container, options = {}) {
      if (typeof container === 'string') {
        this.container = document.querySelector(container);
      } else {
        this.container = container;
      }
      
      if (!this.container) {
        throw new Error('ScrollList: Container element not found');
      }

      this.options = {
        emptyMessage: 'No items',
        gap: 8,
        padding: 8,
        keyField: 'id',
        itemFactory: null,
        onSlotClick: null,
        ...options
      };

      // Slot storage: id → { slot: HTMLElement, component: any, data: any }
      this._slots = new Map();
      this._slotOrder = []; // Array of ids for ordering
      this._events = {};
      
      // Reorder state
      this._reorderMode = false;
      this._dragState = null;

      this._init();
    }

    /**
     * Initialize the component
     */
    _init() {
      this.container.classList.add('scroll-list-container');
      
      // Create wrapper structure
      this._wrapper = document.createElement('div');
      this._wrapper.className = 'scroll-list-wrapper';
      
      this._listElement = document.createElement('div');
      this._listElement.className = 'scroll-list';
      this._listElement.setAttribute('role', 'list');
      this._listElement.style.setProperty('--sl-gap', `${this.options.gap}px`);
      this._listElement.style.setProperty('--sl-padding', `${this.options.padding}px`);
      
      this._emptyElement = document.createElement('div');
      this._emptyElement.className = 'scroll-list-empty';
      this._emptyElement.textContent = this.options.emptyMessage;
      
      this._wrapper.appendChild(this._listElement);
      this._wrapper.appendChild(this._emptyElement);
      this.container.appendChild(this._wrapper);
      
      this._injectStyles();
      this._bindEvents();
      this._updateEmptyState();
    }

    /**
     * Inject component styles
     */
    _injectStyles() {
      if (document.getElementById('scroll-list-styles-v2')) return;
      
      const style = document.createElement('style');
      style.id = 'scroll-list-styles-v2';
      style.textContent = `
        /* ==================== ScrollList Container ==================== */
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
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          scrollbar-gutter: stable;
          
          /* Layout */
          display: flex;
          flex-direction: column;
          gap: var(--sl-gap, 8px);
          padding: var(--sl-padding, 8px);
        }
        
        /* ==================== Scrollbar Styling ==================== */
        .scroll-list::-webkit-scrollbar {
          width: 8px;
        }
        
        .scroll-list::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        
        .scroll-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 4px;
        }
        
        .scroll-list::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.25);
        }
        
        /* Firefox */
        .scroll-list {
          scrollbar-color: rgba(255, 255, 255, 0.15) rgba(255, 255, 255, 0.05);
        }
        
        /* ==================== Slots ==================== */
        .scroll-list-slot {
          position: relative;
          flex-shrink: 0;
          transition: 
            transform 0.2s ease,
            margin 0.2s ease,
            opacity 0.2s ease;
        }
        
        .scroll-list-slot[role="listitem"] {
          /* Accessibility */
        }
        
        /* ==================== Empty State ==================== */
        .scroll-list-empty {
          display: none;
          padding: 32px 16px;
          text-align: center;
          opacity: 0.6;
        }
        
        .scroll-list-empty.visible {
          display: block;
        }
        
        /* ==================== Reorder Mode ==================== */
        @keyframes slot-wiggle-rotate {
          0%, 100% { transform: rotate(-0.5deg); }
          50% { transform: rotate(0.5deg); }
        }
        
        @keyframes slot-wiggle-shift {
          0%, 100% { margin-left: -1px; margin-right: 1px; }
          50% { margin-left: 1px; margin-right: -1px; }
        }
        
        .scroll-list-container.reorder-mode .scroll-list-slot {
          cursor: grab;
          animation: 
            slot-wiggle-rotate 0.375s ease-in-out infinite,
            slot-wiggle-shift 0.5s ease-in-out infinite;
        }
        
        /* Stagger animations for organic feel */
        .scroll-list-container.reorder-mode .scroll-list-slot:nth-child(2n) {
          animation-delay: -0.1s, -0.15s;
        }
        .scroll-list-container.reorder-mode .scroll-list-slot:nth-child(3n) {
          animation-delay: -0.22s, -0.33s;
        }
        .scroll-list-container.reorder-mode .scroll-list-slot:nth-child(4n) {
          animation-delay: -0.07s, -0.4s;
        }
        .scroll-list-container.reorder-mode .scroll-list-slot:nth-child(5n) {
          animation-delay: -0.3s, -0.08s;
        }
        
        .scroll-list-container.reorder-mode .scroll-list-slot:active {
          cursor: grabbing;
          animation: none;
          transform: scale(1.02);
          z-index: 10;
        }
        
        .scroll-list-slot.dragging {
          opacity: 0.5;
          animation: none !important;
          transform: scale(1.02) rotate(2deg);
        }
        
        /* During reorder transition, pause wiggle animation */
        .scroll-list-container.reorder-transitioning .scroll-list-slot {
          animation: none !important;
        }
        
        /* Drop indicator */
        .scroll-list-drop-indicator {
          height: 4px;
          background: #4a9eff;
          border-radius: 2px;
          box-shadow: 
            0 0 8px rgba(74, 158, 255, 0.6),
            0 0 16px rgba(74, 158, 255, 0.4);
          pointer-events: none;
          flex-shrink: 0;
        }
        
        /* Gap markers for drag target */
        .scroll-list-slot.gap-above {
          margin-top: calc(var(--sl-gap, 8px) + 12px);
        }
        
        .scroll-list-slot.gap-below {
          margin-bottom: calc(var(--sl-gap, 8px) + 12px);
        }
        
        /* ==================== Light Mode ==================== */
        .scroll-list-container.light-mode .scroll-list::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.05);
        }
        
        .scroll-list-container.light-mode .scroll-list::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
        }
        
        .scroll-list-container.light-mode .scroll-list::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.25);
        }
        
        .scroll-list-container.light-mode .scroll-list {
          scrollbar-color: rgba(0, 0, 0, 0.15) rgba(0, 0, 0, 0.05);
        }
        
        /* ==================== Touch-friendly ==================== */
        @media (pointer: coarse) {
          .scroll-list-slot {
            min-height: 48px;
          }
        }

        /* ==================== Entrance animation (opt-in via addItem({ animate: true })) ==================== */
        .scroll-list-slot.is-entering {
          overflow: hidden;
          max-height: 0;
          opacity: 0;
          transform: translateX(-110%);
          transition:
            max-height 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
            opacity 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
            transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        .scroll-list-slot.is-entering.is-entered {
          max-height: var(--slot-natural-height, 500px);
          opacity: 1;
          transform: translateX(0);
        }

        /* ==================== Exit animation (opt-in via removeItem(id, { animate: true })) ==================== */
        .scroll-list-slot.is-leaving {
          overflow: hidden;
          max-height: var(--slot-natural-height, 500px);
          opacity: 1;
          transform: translateX(0);
          transition:
            max-height 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
            opacity 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
            transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
          /* Pointer events off during exit so menus/clicks don't trigger on a fading item */
          pointer-events: none;
        }
        .scroll-list-slot.is-leaving.is-left {
          max-height: 0;
          opacity: 0;
          transform: translateX(110%);
        }

        @media (prefers-reduced-motion: reduce) {
          .scroll-list-slot.is-entering,
          .scroll-list-slot.is-entering.is-entered,
          .scroll-list-slot.is-leaving,
          .scroll-list-slot.is-leaving.is-left {
            max-height: none;
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `;
      
      document.head.appendChild(style);
    }

    /**
     * Bind DOM events
     */
    _bindEvents() {
      // Scroll events
      this._listElement.addEventListener('scroll', () => {
        this.emit('scroll', {
          scrollTop: this._listElement.scrollTop,
          scrollHeight: this._listElement.scrollHeight,
          clientHeight: this._listElement.clientHeight
        });
      }, { passive: true });

      // Slot click (only fires if slot content doesn't handle it)
      this._listElement.addEventListener('click', (e) => {
        if (this._reorderMode) return;
        
        const slot = e.target.closest('.scroll-list-slot');
        if (!slot) return;
        
        const id = slot.dataset.id;
        const slotData = this._slots.get(id);
        
        if (slotData && this.options.onSlotClick) {
          this.options.onSlotClick(id, slotData.data, slot);
        }
      });

      // Drag and drop for reorder
      this._listElement.addEventListener('dragstart', (e) => this._handleDragStart(e));
      this._listElement.addEventListener('dragover', (e) => this._handleDragOver(e));
      this._listElement.addEventListener('drop', (e) => this._handleDrop(e));
      this._listElement.addEventListener('dragend', (e) => this._handleDragEnd(e));
    }

    // ==================== SLOT MANAGEMENT ====================

    /**
     * Create a new slot container
     * @param {Object} options - Slot options
     * @param {string} options.id - Unique identifier (required)
     * @param {Object} options.data - Optional data associated with slot
     * @param {boolean} options.prepend - Add to beginning instead of end
     * @returns {HTMLElement} The slot container element
     */
    createSlot(options = {}) {
      const id = options.id;
      if (!id) {
        throw new Error('ScrollList.createSlot: id is required');
      }
      
      if (this._slots.has(id)) {
        console.warn(`ScrollList: Slot "${id}" already exists`);
        return this._slots.get(id).slot;
      }
      
      // Create slot element
      const slot = document.createElement('div');
      slot.className = 'scroll-list-slot';
      slot.dataset.id = id;
      slot.setAttribute('role', 'listitem');
      slot.draggable = this._reorderMode;
      
      // Add to DOM
      if (options.prepend && this._listElement.firstChild) {
        this._listElement.insertBefore(slot, this._listElement.firstChild);
        this._slotOrder.unshift(id);
      } else {
        this._listElement.appendChild(slot);
        this._slotOrder.push(id);
      }
      
      // Store slot data
      this._slots.set(id, {
        slot: slot,
        component: null,
        data: options.data || null
      });
      
      this._updateEmptyState();
      this.emit('slot:created', { id, slot, index: this._slotOrder.indexOf(id) });
      
      return slot;
    }

    /**
     * Get a slot by id
     * @param {string} id
     * @returns {HTMLElement|null}
     */
    getSlot(id) {
      const slotData = this._slots.get(id);
      return slotData ? slotData.slot : null;
    }

    /**
     * Get slot data
     * @param {string} id
     * @returns {Object|null} { slot, component, data }
     */
    getSlotData(id) {
      return this._slots.get(id) || null;
    }

    /**
     * Set the component instance for a slot (for cleanup tracking)
     * @param {string} id
     * @param {Object} component - Component with destroy() method
     */
    setSlotComponent(id, component) {
      const slotData = this._slots.get(id);
      if (slotData) {
        slotData.component = component;
      }
    }

    /**
     * Remove a slot
     * @param {string} id
     */
    removeSlot(id) {
      console.log('[DEBUG] ScrollList.removeSlot called:', {
        id,
        hasSlot: this._slots.has(id),
        slotsCount: this._slots.size,
        slotOrderLength: this._slotOrder.length
      });
      
      const slotData = this._slots.get(id);
      if (!slotData) {
        console.log('[DEBUG] ScrollList.removeSlot - no slot found for id:', id);
        return this;
      }
      
      console.log('[DEBUG] ScrollList.removeSlot - found slot:', {
        hasComponent: !!slotData.component,
        hasDestroyMethod: slotData.component && typeof slotData.component.destroy === 'function',
        hasParentNode: !!slotData.slot.parentNode
      });
      
      // Destroy component if it has destroy method
      if (slotData.component && typeof slotData.component.destroy === 'function') {
        console.log('[DEBUG] ScrollList.removeSlot - calling component.destroy()');
        slotData.component.destroy();
      }
      
      // Remove from DOM
      if (slotData.slot.parentNode) {
        console.log('[DEBUG] ScrollList.removeSlot - removing from DOM');
        slotData.slot.parentNode.removeChild(slotData.slot);
      }
      
      // Remove from tracking
      this._slots.delete(id);
      this._slotOrder = this._slotOrder.filter(i => i !== id);
      
      console.log('[DEBUG] ScrollList.removeSlot - after cleanup:', {
        slotsCount: this._slots.size,
        slotOrderLength: this._slotOrder.length,
        stillHasSlot: this._slots.has(id)
      });
      
      this._updateEmptyState();
      this.emit('slot:removed', { id });
      
      return this;
    }

    /**
     * Reorder a slot to a new position with animation
     * Uses FLIP technique: First, Last, Invert, Play
     * @param {string} id
     * @param {number} toIndex
     * @param {boolean} animate - Whether to animate (default: true)
     */
    reorderSlot(id, toIndex, animate = true) {
      const fromIndex = this._slotOrder.indexOf(id);
      if (fromIndex === -1 || fromIndex === toIndex) return this;
      
      const slotData = this._slots.get(id);
      if (!slotData) return this;
      
      // FLIP Step 1: FIRST - Record current positions of all slots
      const firstPositions = new Map();
      if (animate) {
        for (const [slotId, data] of this._slots) {
          const rect = data.slot.getBoundingClientRect();
          firstPositions.set(slotId, { top: rect.top, left: rect.left });
        }
      }
      
      // Update order array
      this._slotOrder.splice(fromIndex, 1);
      this._slotOrder.splice(toIndex, 0, id);
      
      // Update DOM order
      const referenceSlot = this._slotOrder[toIndex + 1];
      if (referenceSlot) {
        const refElement = this._slots.get(referenceSlot).slot;
        this._listElement.insertBefore(slotData.slot, refElement);
      } else {
        this._listElement.appendChild(slotData.slot);
      }
      
      // FLIP Step 2-4: LAST, INVERT, PLAY
      if (animate) {
        // Pause wiggle animation during transition
        this.container.classList.add('reorder-transitioning');
        
        // Force layout recalc
        this._listElement.offsetHeight;
        
        let animatingCount = 0;
        
        for (const [slotId, data] of this._slots) {
          const first = firstPositions.get(slotId);
          if (!first) continue;
          
          // LAST - Get new position
          const last = data.slot.getBoundingClientRect();
          
          // INVERT - Calculate the delta
          const deltaY = first.top - last.top;
          const deltaX = first.left - last.left;
          
          // Skip if no movement
          if (Math.abs(deltaY) < 1 && Math.abs(deltaX) < 1) continue;
          
          animatingCount++;
          
          // Apply inverted position (makes it appear in old spot)
          data.slot.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
          data.slot.style.transition = 'none';
          
          // Force reflow
          data.slot.offsetHeight;
          
          // PLAY - Animate back to natural position
          data.slot.style.transition = 'transform 0.25s ease-out';
          data.slot.style.transform = '';
          
          // Clean up after animation
          const cleanup = () => {
            data.slot.style.transition = '';
            data.slot.style.transform = '';
            data.slot.removeEventListener('transitionend', cleanup);
            
            // Re-enable wiggle after all animations complete
            animatingCount--;
            if (animatingCount <= 0) {
              this.container.classList.remove('reorder-transitioning');
            }
          };
          data.slot.addEventListener('transitionend', cleanup);
        }
        
        // If nothing animated, remove transitioning class immediately
        if (animatingCount === 0) {
          this.container.classList.remove('reorder-transitioning');
        }
      }
      
      this.emit('slot:reordered', { id, fromIndex, toIndex });
      
      return this;
    }

    // ==================== FACTORY-BASED API ====================

    /**
     * Add an item using the itemFactory
     * @param {Object} data - Data for the item
     * @param {Object} options - Additional options
     * @returns {Object} { id, slot, component }
     */
    addItem(data, options = {}) {
      if (!this.options.itemFactory) {
        throw new Error('ScrollList.addItem requires itemFactory option');
      }

      const id = data[this.options.keyField];
      if (!id) {
        throw new Error(`ScrollList.addItem: data must have ${this.options.keyField} field`);
      }

      const slot = this.createSlot({ id, data, prepend: options.prepend });
      const component = this.options.itemFactory(slot, data);
      this.setSlotComponent(id, component);

      if (options.deferAnimation) {
        // Park the slot in the pre-entrance state. Caller must later call
        // animateSlotEntrance(id) to play the transition (e.g. after a
        // covering modal is dismissed).
        this._parkSlotEntrance(slot);
      } else if (options.animate) {
        this._animateSlotEntrance(slot);
      }

      return { id, slot, component };
    }

    /**
     * Trigger the entrance animation on an existing slot by id.
     * Useful when an item was added silently (e.g., behind a modal) and the
     * animation should play later when the modal closes.
     * @param {string} id
     */
    animateSlotEntrance(id) {
      const slotData = this._slots.get(id);
      if (!slotData || !slotData.slot) return;
      this._animateSlotEntrance(slotData.slot);
    }

    /**
     * Park a slot in the pre-entrance state (invisible, collapsed, off to the
     * left). No transition runs yet — caller must later invoke
     * animateSlotEntrance(id) to play it. Used when an item is added behind
     * a modal: it should stay invisible while the modal is up so the user
     * doesn't see it sitting there before the animation.
     * @private
     */
    _parkSlotEntrance(slot) {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const naturalHeight = slot.scrollHeight;
      if (!naturalHeight) return;

      slot.style.setProperty('--slot-natural-height', naturalHeight + 'px');
      slot.classList.add('is-entering');
      // Intentionally no rAF / no is-entered — animateSlotEntrance plays it later.
    }

    /**
     * Animate a newly inserted slot in from the left, with surrounding items
     * pushed down as the slot's height grows from 0 to its natural size.
     * Handles both the "from scratch" case and the "already parked" case
     * (slot was previously prepared via deferAnimation).
     * No-op if the user has prefers-reduced-motion enabled.
     * @private
     */
    _animateSlotEntrance(slot) {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      // If the slot was already parked in the "entering" state via
      // _parkSlotEntrance, skip the measure step and just play.
      if (!slot.classList.contains('is-entering')) {
        const naturalHeight = slot.scrollHeight;
        if (!naturalHeight) return;
        slot.style.setProperty('--slot-natural-height', naturalHeight + 'px');
        slot.classList.add('is-entering');
      }

      // Double-rAF: commits the "from" state to layout, then flips to "to".
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          slot.classList.add('is-entered');
        });
      });

      const cleanup = (e) => {
        if (e && (e.target !== slot || e.propertyName !== 'max-height')) return;
        slot.classList.remove('is-entering', 'is-entered');
        slot.style.removeProperty('--slot-natural-height');
        slot.removeEventListener('transitionend', cleanup);
      };
      slot.addEventListener('transitionend', cleanup);
      // Safety fallback in case transitionend never fires (e.g., display change)
      setTimeout(() => cleanup(null), 500);
    }

    /**
     * Update an item's data
     * @param {string} id
     * @param {Object} updates
     */
    updateItem(id, updates) {
      const slotData = this._slots.get(id);
      if (!slotData) return this;
      
      // Merge data
      slotData.data = { ...slotData.data, ...updates };
      
      // Call component update if available
      if (slotData.component && typeof slotData.component.update === 'function') {
        slotData.component.update(updates);
      }
      
      return this;
    }

    /**
     * Remove an item by id
     * @param {string} id
     * @param {Object} [options]
     * @param {boolean} [options.animate] — when true, play the exit animation
     *   before removing the slot from the DOM. Returns true synchronously;
     *   the actual removal happens after the transition ends.
     */
    removeItem(id, options = {}) {
      if (!options.animate) {
        return this.removeSlot(id);
      }

      const slotData = this._slots.get(id);
      if (!slotData || !slotData.slot) return this.removeSlot(id);

      // Disconnect from internal tracking immediately so re-adds/lookups don't
      // see a "leaving" entry. The DOM element stays attached until the
      // animation finishes, then we clean it up.
      const slot = slotData.slot;
      this._slots.delete(id);

      // Also drop from _slotOrder if present, so reorder/sort logic stays
      // consistent with what's actually tracked.
      if (Array.isArray(this._slotOrder)) {
        const idx = this._slotOrder.indexOf(id);
        if (idx >= 0) this._slotOrder.splice(idx, 1);
      }

      // Refresh empty-state immediately — when the last item leaves, the
      // pear-sticker placeholder fades in behind it as it slides out.
      this._updateEmptyState();

      this._animateSlotExit(slot, () => {
        if (slot.parentNode) slot.parentNode.removeChild(slot);
      });
      return true;
    }

    /**
     * Animate an existing slot out to the right with its height collapsing
     * to 0, so neighbouring items close the gap. Calls onDone when the
     * transition finishes (or immediately if reduced-motion is on).
     * @private
     */
    _animateSlotExit(slot, onDone) {
      const finish = () => { if (typeof onDone === 'function') onDone(); };

      if (typeof window === 'undefined' || !window.matchMedia) {
        finish();
        return;
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        finish();
        return;
      }

      // Pin the current height as the explicit starting max-height — the
      // class's var() lookup needs a concrete value to transition from.
      const naturalHeight = slot.offsetHeight || slot.scrollHeight;
      slot.style.setProperty('--slot-natural-height', naturalHeight + 'px');
      slot.classList.add('is-leaving');

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          slot.classList.add('is-left');
        });
      });

      const cleanup = (e) => {
        if (e && (e.target !== slot || e.propertyName !== 'max-height')) return;
        slot.removeEventListener('transitionend', cleanup);
        finish();
      };
      slot.addEventListener('transitionend', cleanup);
      setTimeout(() => cleanup(null), 500);
    }

    // ==================== REORDER MODE ====================

    /**
     * Enable/disable reorder mode
     * @param {boolean} enabled
     */
    setReorderMode(enabled) {
      this._reorderMode = enabled;
      this.container.classList.toggle('reorder-mode', enabled);
      
      // Update draggable on all slots
      for (const [id, slotData] of this._slots) {
        slotData.slot.draggable = enabled;
      }
      
      // Create or remove drop indicator
      if (enabled && !this._dropIndicator) {
        this._dropIndicator = document.createElement('div');
        this._dropIndicator.className = 'scroll-list-drop-indicator';
        this._dropIndicator.style.display = 'none';
      } else if (!enabled && this._dropIndicator) {
        if (this._dropIndicator.parentNode) {
          this._dropIndicator.parentNode.removeChild(this._dropIndicator);
        }
        this._dropIndicator = null;
      }
      
      return this;
    }

    /**
     * Check if reorder mode is active
     * @returns {boolean}
     */
    isReorderMode() {
      return this._reorderMode;
    }

    _handleDragStart(e) {
      if (!this._reorderMode) return;
      
      const slot = e.target.closest('.scroll-list-slot');
      if (!slot) return;
      
      this._dragState = {
        id: slot.dataset.id,
        slot: slot,
        startIndex: this._slotOrder.indexOf(slot.dataset.id)
      };
      
      setTimeout(() => slot.classList.add('dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    }

    _handleDragOver(e) {
      if (!this._reorderMode || !this._dragState) return;
      e.preventDefault();
      
      // Clear previous gap classes
      this._listElement.querySelectorAll('.gap-above, .gap-below').forEach(el => {
        el.classList.remove('gap-above', 'gap-below');
      });
      
      // Find drop target
      const slots = Array.from(this._listElement.querySelectorAll('.scroll-list-slot:not(.dragging)'));
      
      for (const slot of slots) {
        const rect = slot.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        
        if (e.clientY < midpoint) {
          // Insert indicator before this slot
          slot.classList.add('gap-above');
          this._dragState.targetIndex = this._slotOrder.indexOf(slot.dataset.id);
          
          // Position drop indicator
          if (this._dropIndicator) {
            this._listElement.insertBefore(this._dropIndicator, slot);
            this._dropIndicator.style.display = 'block';
          }
          return;
        }
      }
      
      // Below all items - insert at end
      if (slots.length > 0) {
        slots[slots.length - 1].classList.add('gap-below');
        this._dragState.targetIndex = this._slotOrder.length - 1;
        
        // Position drop indicator at end
        if (this._dropIndicator) {
          this._listElement.appendChild(this._dropIndicator);
          this._dropIndicator.style.display = 'block';
        }
      }
    }

    _handleDrop(e) {
      if (!this._reorderMode || !this._dragState) return;
      e.preventDefault();
      
      const { id, startIndex } = this._dragState;
      let targetIndex = this._dragState.targetIndex;
      
      if (targetIndex !== undefined && targetIndex !== startIndex) {
        // Adjust for removal
        if (targetIndex > startIndex) targetIndex--;
        this.reorderSlot(id, targetIndex);
      }
      
      this._cleanupDrag();
    }

    _handleDragEnd(e) {
      this._cleanupDrag();
    }

    _cleanupDrag() {
      if (this._dragState && this._dragState.slot) {
        this._dragState.slot.classList.remove('dragging');
      }
      
      this._listElement.querySelectorAll('.gap-above, .gap-below').forEach(el => {
        el.classList.remove('gap-above', 'gap-below');
      });
      
      // Hide drop indicator
      if (this._dropIndicator) {
        this._dropIndicator.style.display = 'none';
      }
      
      this._dragState = null;
    }

    // ==================== UTILITY ====================

    _updateEmptyState() {
      if (this._slots.size === 0) {
        this._emptyElement.classList.add('visible');
        this.emit('empty');
      } else {
        this._emptyElement.classList.remove('visible');
      }
    }

    /**
     * Clear all slots
     */
    clear() {
      for (const id of [...this._slotOrder]) {
        this.removeSlot(id);
      }
      return this;
    }

    /**
     * Get slot count
     * @returns {number}
     */
    getCount() {
      return this._slots.size;
    }

    /**
     * Get ordered list of slot ids
     * @returns {string[]}
     */
    getSlotIds() {
      return [...this._slotOrder];
    }

    /**
     * Check if empty
     * @returns {boolean}
     */
    isEmpty() {
      return this._slots.size === 0;
    }

    /**
     * Scroll to a slot
     * @param {string} id
     */
    scrollToSlot(id) {
      const slotData = this._slots.get(id);
      if (slotData && slotData.slot) {
        slotData.slot.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      return this;
    }

    /**
     * Scroll to top
     */
    scrollToTop() {
      this._listElement.scrollTop = 0;
      return this;
    }

    /**
     * Scroll to bottom
     */
    scrollToBottom() {
      this._listElement.scrollTop = this._listElement.scrollHeight;
      return this;
    }

    /**
     * Set empty message
     * @param {string} message
     */
    setEmptyMessage(message) {
      this.options.emptyMessage = message;
      this._emptyElement.textContent = message;
      return this;
    }

    /**
     * Set gap between slots
     * @param {number} gap - Gap in pixels
     */
    setGap(gap) {
      this.options.gap = gap;
      this._listElement.style.setProperty('--sl-gap', `${gap}px`);
      return this;
    }

    /**
     * Set padding around list
     * @param {number} padding - Padding in pixels
     */
    setPadding(padding) {
      this.options.padding = padding;
      this._listElement.style.setProperty('--sl-padding', `${padding}px`);
      return this;
    }

    /**
     * Set light/dark mode
     * @param {boolean} lightMode
     */
    setLightMode(lightMode) {
      this.container.classList.toggle('light-mode', lightMode);
      return this;
    }

    /**
     * Get the scroll element (for custom scroll handling)
     * @returns {HTMLElement}
     */
    getScrollElement() {
      return this._listElement;
    }

    /**
     * Destroy the component
     */
    destroy() {
      // Destroy all slot components
      for (const [id, slotData] of this._slots) {
        if (slotData.component && typeof slotData.component.destroy === 'function') {
          slotData.component.destroy();
        }
      }
      
      this._slots.clear();
      this._slotOrder = [];
      this.container.innerHTML = '';
      this.container.classList.remove('scroll-list-container', 'reorder-mode', 'light-mode');
      this._events = {};
    }

    /**
     * Get version
     * @returns {string}
     */
    static get version() {
      return VERSION;
    }
  }

  // Mix in EventEmitter
  Object.assign(ScrollList.prototype, EventEmitter);
  
  return ScrollList;
}));
