/**
 * PreviewOverlay v1.0.0
 * 
 * Dark modal overlay for media preview. macOS Preview-inspired.
 * Contains content slot for video player, image viewer, etc.
 * 
 * EXPORTS: PreviewOverlay (class)
 * EXTERNAL CALLS: None (pure browser APIs)
 * 
 * FUNCTIONS:
 * - constructor(options) — Initialize overlay (appends to body)
 * - open(options) — Show overlay with content
 * - close() — Hide and clean up
 * - setTitle(title) — Update title bar
 * - getContentSlot() — Get container for mounting content
 * - enterFullscreen() — Expand content to fullscreen
 * - exitFullscreen() — Return to overlay mode
 * - destroy() — Remove from DOM
 * 
 * EVENTS EMITTED:
 * - open, close, fullscreen-change
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.PreviewOverlay = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const CSS = `
    .po-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.25s ease, background 0.25s ease;
    }

    .po-overlay.po-visible {
      opacity: 1;
      visibility: visible;
      background: rgba(0, 0, 0, 0.85);
    }

    .po-overlay.po-fullscreen {
      background: rgba(0, 0, 0, 1);
    }

    /* Container window */
    .po-window {
      position: relative;
      background: #1c1c1e;
      border-radius: 12px;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      max-width: 90vw;
      max-height: 90vh;
      min-width: 400px;
      min-height: 300px;
      overflow: hidden;
      transform: scale(0.95);
      transition: transform 0.25s ease, width 0.3s ease, height 0.3s ease;
    }

    .po-overlay.po-visible .po-window {
      transform: scale(1);
    }

    .po-overlay.po-fullscreen .po-window {
      max-width: 100vw;
      max-height: 100vh;
      width: 100vw;
      height: 100vh;
      border-radius: 0;
    }

    /* Title bar */
    .po-titlebar {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: linear-gradient(to bottom, #3a3a3c, #2c2c2e);
      border-bottom: 1px solid #1a1a1a;
      user-select: none;
      flex-shrink: 0;
    }

    .po-traffic-lights {
      display: flex;
      gap: 8px;
      margin-right: 12px;
    }

    .po-btn-close,
    .po-btn-minimize,
    .po-btn-fullscreen {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      position: relative;
      transition: filter 0.1s ease;
    }

    .po-btn-close {
      background: #ff5f57;
    }

    .po-btn-minimize {
      background: #febc2e;
    }

    .po-btn-fullscreen {
      background: #28c840;
    }

    .po-btn-close:hover,
    .po-btn-minimize:hover,
    .po-btn-fullscreen:hover {
      filter: brightness(1.1);
    }

    /* Show icons on hover */
    .po-traffic-lights:hover .po-btn-close::after {
      content: '×';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 10px;
      font-weight: bold;
      color: #4a0000;
      line-height: 1;
    }

    .po-traffic-lights:hover .po-btn-fullscreen::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 6px;
      height: 6px;
      border: 1px solid #0a4a0a;
      border-radius: 1px;
    }

    .po-title {
      flex: 1;
      text-align: center;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 40px;
    }

    .po-title-meta {
      color: rgba(255, 255, 255, 0.5);
      font-weight: 400;
      margin-left: 8px;
    }

    /* Content area */
    .po-content {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #000;
      position: relative;
    }

    /* Loading state */
    .po-loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: rgba(255, 255, 255, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .po-loading-spinner {
      width: 32px;
      height: 32px;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: #fff;
      border-radius: 50%;
      animation: po-spin 0.8s linear infinite;
    }

    @keyframes po-spin {
      to { transform: rotate(360deg); }
    }

    /* Navigation arrows (for galleries) */
    .po-nav-prev,
    .po-nav-next {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 44px;
      height: 44px;
      background: rgba(0, 0, 0, 0.5);
      border: none;
      border-radius: 50%;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s ease, background 0.15s ease;
    }

    .po-content:hover .po-nav-prev,
    .po-content:hover .po-nav-next {
      opacity: 0.8;
    }

    .po-nav-prev:hover,
    .po-nav-next:hover {
      opacity: 1;
      background: rgba(0, 0, 0, 0.7);
    }

    .po-nav-prev {
      left: 16px;
    }

    .po-nav-next {
      right: 16px;
    }

    .po-nav-prev svg,
    .po-nav-next svg {
      width: 20px;
      height: 20px;
      fill: currentColor;
    }

    /* Info bar (optional) */
    .po-infobar {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      background: #1c1c1e;
      border-top: 1px solid #2c2c2e;
      color: rgba(255, 255, 255, 0.6);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 12px;
      gap: 16px;
      flex-shrink: 0;
    }

    .po-infobar.po-hidden {
      display: none;
    }

    /* Size handle */
    .po-resize-handle {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
    }

    /* Keyboard hint */
    .po-keyboard-hint {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7);
      padding: 8px 16px;
      border-radius: 6px;
      color: rgba(255, 255, 255, 0.7);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 11px;
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }

    .po-keyboard-hint.po-show {
      opacity: 1;
    }

    .po-keyboard-hint kbd {
      background: rgba(255, 255, 255, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
      margin: 0 2px;
      font-family: inherit;
    }
  `;

  const ICONS = {
    chevronLeft: '<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>'
  };

  function injectStyles() {
    if (document.getElementById('preview-overlay-styles')) return;
    const style = document.createElement('style');
    style.id = 'preview-overlay-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  class PreviewOverlay {
    constructor(options = {}) {
      injectStyles();
      
      this.options = {
        showTrafficLights: true,
        showInfoBar: false,
        showNavigation: false,
        closeOnBackdrop: true,
        closeOnEscape: true,
        initialWidth: null,  // Auto-size to content
        initialHeight: null,
        ...options
      };

      this._listeners = new Map();
      this._isOpen = false;
      this._isFullscreen = false;
      this._keyboardHintTimeout = null;

      this._build();
      this._bindEvents();
    }

    _build() {
      this.el = document.createElement('div');
      this.el.className = 'po-overlay';
      this.el.innerHTML = `
        <div class="po-window">
          ${this.options.showTrafficLights ? `
            <div class="po-titlebar">
              <div class="po-traffic-lights">
                <button class="po-btn-close" title="Close"></button>
                <button class="po-btn-minimize" title="Minimize"></button>
                <button class="po-btn-fullscreen" title="Fullscreen"></button>
              </div>
              <span class="po-title"></span>
            </div>
          ` : ''}
          
          <div class="po-content">
            <div class="po-loading">
              <div class="po-loading-spinner"></div>
              <span>Loading...</span>
            </div>
            
            ${this.options.showNavigation ? `
              <button class="po-nav-prev">${ICONS.chevronLeft}</button>
              <button class="po-nav-next">${ICONS.chevronRight}</button>
            ` : ''}
          </div>
          
          <div class="po-infobar${this.options.showInfoBar ? '' : ' po-hidden'}"></div>
          
          <div class="po-keyboard-hint">
            <kbd>Space</kbd> Play/Pause &nbsp;
            <kbd>F</kbd> Fullscreen &nbsp;
            <kbd>Esc</kbd> Close
          </div>
        </div>
      `;

      // Cache elements
      this.window = this.el.querySelector('.po-window');
      this.content = this.el.querySelector('.po-content');
      this.loading = this.el.querySelector('.po-loading');
      this.titleEl = this.el.querySelector('.po-title');
      this.infobar = this.el.querySelector('.po-infobar');
      this.keyboardHint = this.el.querySelector('.po-keyboard-hint');
      this.closeBtn = this.el.querySelector('.po-btn-close');
      this.minimizeBtn = this.el.querySelector('.po-btn-minimize');
      this.fullscreenBtn = this.el.querySelector('.po-btn-fullscreen');
      this.prevBtn = this.el.querySelector('.po-nav-prev');
      this.nextBtn = this.el.querySelector('.po-nav-next');

      // Set initial size if specified
      if (this.options.initialWidth) {
        this.window.style.width = this.options.initialWidth + 'px';
      }
      if (this.options.initialHeight) {
        this.window.style.height = this.options.initialHeight + 'px';
      }

      document.body.appendChild(this.el);
    }

    _bindEvents() {
      // Close button
      this.closeBtn?.addEventListener('click', () => this.close());

      // Minimize (just close for now)
      this.minimizeBtn?.addEventListener('click', () => this.close());

      // Fullscreen
      this.fullscreenBtn?.addEventListener('click', () => this._toggleFullscreen());

      // Backdrop click
      if (this.options.closeOnBackdrop) {
        this.el.addEventListener('click', (e) => {
          if (e.target === this.el) this.close();
        });
      }

      // Escape key
      this._escapeHandler = (e) => {
        if (e.key === 'Escape' && this._isOpen) {
          if (this._isFullscreen) {
            this.exitFullscreen();
          } else if (this.options.closeOnEscape) {
            this.close();
          }
        }
      };
      document.addEventListener('keydown', this._escapeHandler);

      // Navigation
      this.prevBtn?.addEventListener('click', () => this._emit('navigate', { direction: -1 }));
      this.nextBtn?.addEventListener('click', () => this._emit('navigate', { direction: 1 }));
    }

    _toggleFullscreen() {
      if (this._isFullscreen) {
        this.exitFullscreen();
      } else {
        this.enterFullscreen();
      }
    }

    _showKeyboardHint() {
      this.keyboardHint?.classList.add('po-show');
      clearTimeout(this._keyboardHintTimeout);
      this._keyboardHintTimeout = setTimeout(() => {
        this.keyboardHint?.classList.remove('po-show');
      }, 3000);
    }

    // Public API

    open(options = {}) {
      const { title, meta, width, height, showLoading = false } = options;

      if (title) {
        this.setTitle(title, meta);
      }

      if (width) this.window.style.width = width + 'px';
      if (height) this.window.style.height = height + 'px';

      this.loading.style.display = showLoading ? 'flex' : 'none';

      this._isOpen = true;
      this.el.classList.add('po-visible');
      this._showKeyboardHint();
      this._emit('open');

      // Trap focus
      this.el.focus();
    }

    close() {
      this._isOpen = false;
      this._isFullscreen = false;
      this.el.classList.remove('po-visible', 'po-fullscreen');
      this._emit('close');
    }

    setTitle(title, meta = null) {
      if (this.titleEl) {
        this.titleEl.innerHTML = title + (meta ? `<span class="po-title-meta">${meta}</span>` : '');
      }
    }

    setInfo(html) {
      if (this.infobar) {
        this.infobar.innerHTML = html;
        this.infobar.classList.remove('po-hidden');
      }
    }

    hideLoading() {
      this.loading.style.display = 'none';
    }

    showLoading(text = 'Loading...') {
      const span = this.loading.querySelector('span');
      if (span) span.textContent = text;
      this.loading.style.display = 'flex';
    }

    getContentSlot() {
      return this.content;
    }

    setSize(width, height) {
      this.window.style.width = width + 'px';
      this.window.style.height = height + 'px';
    }

    enterFullscreen() {
      this._isFullscreen = true;
      this.el.classList.add('po-fullscreen');
      this._emit('fullscreen-change', { fullscreen: true });
    }

    exitFullscreen() {
      this._isFullscreen = false;
      this.el.classList.remove('po-fullscreen');
      this._emit('fullscreen-change', { fullscreen: false });
    }

    get isOpen() {
      return this._isOpen;
    }

    get isFullscreen() {
      return this._isFullscreen;
    }

    // Event system

    on(event, callback) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, []);
      }
      this._listeners.get(event).push(callback);
      return this;
    }

    off(event, callback) {
      if (!this._listeners.has(event)) return this;
      const callbacks = this._listeners.get(event);
      const idx = callbacks.indexOf(callback);
      if (idx !== -1) callbacks.splice(idx, 1);
      return this;
    }

    _emit(event, data = {}) {
      const callbacks = this._listeners.get(event) || [];
      callbacks.forEach(cb => cb(data));
    }

    destroy() {
      document.removeEventListener('keydown', this._escapeHandler);
      clearTimeout(this._keyboardHintTimeout);
      this.el.remove();
      this._listeners.clear();
    }
  }

  return PreviewOverlay;
});
