/**
 * PeerPreview v1.0.0
 * 
 * Universal media previewer for PearDrive files.
 * Supports video, audio, images. Streams from Hyperdrive.
 * 
 * EXPORTS: PeerPreview (class)
 * EXTERNAL CALLS: VideoPlayer, PreviewOverlay, ImageViewer (bundled)
 * 
 * FUNCTIONS:
 * - constructor(options) — Initialize previewer
 * - open(source, options) — Preview a file/URL/Hyperdrive entry
 * - close() — Close preview
 * - destroy() — Clean up everything
 * 
 * STATIC:
 * - PeerPreview.canPreview(filename) — Check if file type is supported
 * - PeerPreview.getType(filename) — Get media type (video/audio/image/unknown)
 * 
 * EVENTS EMITTED:
 * - open, close, error
 * - play, pause, ended (video/audio)
 * - quality-change, buffer-low, buffer-ok
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    // CommonJS - need to require dependencies
    const VideoPlayer = require('./video-player.js');
    const PreviewOverlay = require('./preview-overlay.js');
    module.exports = factory(VideoPlayer, PreviewOverlay);
  } else if (typeof define === 'function' && define.amd) {
    define(['./video-player', './preview-overlay'], factory);
  } else {
    // Browser globals - expect them to be loaded
    root.PeerPreview = factory(root.VideoPlayer, root.PreviewOverlay);
  }
})(typeof self !== 'undefined' ? self : this, function(VideoPlayer, PreviewOverlay) {
  'use strict';

  // File type detection
  const EXTENSIONS = {
    video: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv'],
    audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
    image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
  };

  const MIME_TYPES = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml'
  };

  function getExtension(filename) {
    const match = filename?.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
  }

  function getType(filename) {
    const ext = getExtension(filename);
    for (const [type, exts] of Object.entries(EXTENSIONS)) {
      if (exts.includes(ext)) return type;
    }
    return 'unknown';
  }

  function canPreview(filename) {
    return getType(filename) !== 'unknown';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  // Image Viewer (inline, simple)
  const IMAGE_VIEWER_CSS = `
    .pp-image-wrap {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: auto;
      cursor: grab;
    }

    .pp-image-wrap.pp-dragging {
      cursor: grabbing;
    }

    .pp-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      user-select: none;
      transition: transform 0.15s ease;
    }

    .pp-image.pp-zoomed {
      max-width: none;
      max-height: none;
      cursor: zoom-out;
    }

    .pp-zoom-controls {
      position: absolute;
      bottom: 16px;
      right: 16px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .pp-image-wrap:hover .pp-zoom-controls {
      opacity: 1;
    }

    .pp-zoom-btn {
      width: 32px;
      height: 32px;
      background: rgba(0, 0, 0, 0.6);
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease;
    }

    .pp-zoom-btn:hover {
      background: rgba(0, 0, 0, 0.8);
    }
  `;

  function injectImageStyles() {
    if (document.getElementById('pp-image-styles')) return;
    const style = document.createElement('style');
    style.id = 'pp-image-styles';
    style.textContent = IMAGE_VIEWER_CSS;
    document.head.appendChild(style);
  }

  class ImageViewer {
    constructor(container) {
      injectImageStyles();
      this.container = container;
      this._zoom = 1;
      this._pan = { x: 0, y: 0 };
      this._isDragging = false;
      this._build();
    }

    _build() {
      this.el = document.createElement('div');
      this.el.className = 'pp-image-wrap';
      this.el.innerHTML = `
        <img class="pp-image" draggable="false">
        <div class="pp-zoom-controls">
          <button class="pp-zoom-btn pp-zoom-out">−</button>
          <button class="pp-zoom-btn pp-zoom-reset">○</button>
          <button class="pp-zoom-btn pp-zoom-in">+</button>
        </div>
      `;

      this.img = this.el.querySelector('.pp-image');
      this.zoomIn = this.el.querySelector('.pp-zoom-in');
      this.zoomOut = this.el.querySelector('.pp-zoom-out');
      this.zoomReset = this.el.querySelector('.pp-zoom-reset');

      // Click to toggle zoom
      this.img.addEventListener('click', () => {
        if (this._zoom > 1) {
          this.resetZoom();
        } else {
          this.setZoom(2);
        }
      });

      // Zoom buttons
      this.zoomIn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setZoom(this._zoom * 1.5);
      });

      this.zoomOut.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setZoom(this._zoom / 1.5);
      });

      this.zoomReset.addEventListener('click', (e) => {
        e.stopPropagation();
        this.resetZoom();
      });

      // Mouse wheel zoom
      this.el.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        this.setZoom(this._zoom * delta);
      });

      // Pan when zoomed
      this.el.addEventListener('mousedown', (e) => {
        if (this._zoom > 1) {
          this._isDragging = true;
          this._dragStart = { x: e.clientX - this._pan.x, y: e.clientY - this._pan.y };
          this.el.classList.add('pp-dragging');
        }
      });

      document.addEventListener('mousemove', (e) => {
        if (this._isDragging) {
          this._pan.x = e.clientX - this._dragStart.x;
          this._pan.y = e.clientY - this._dragStart.y;
          this._applyTransform();
        }
      });

      document.addEventListener('mouseup', () => {
        this._isDragging = false;
        this.el.classList.remove('pp-dragging');
      });

      this.container.appendChild(this.el);
    }

    load(src) {
      return new Promise((resolve, reject) => {
        this.img.onload = () => {
          this.resetZoom();
          resolve({ width: this.img.naturalWidth, height: this.img.naturalHeight });
        };
        this.img.onerror = reject;
        this.img.src = src;
      });
    }

    setZoom(level) {
      this._zoom = Math.max(0.5, Math.min(5, level));
      this.img.classList.toggle('pp-zoomed', this._zoom > 1);
      this._applyTransform();
    }

    resetZoom() {
      this._zoom = 1;
      this._pan = { x: 0, y: 0 };
      this.img.classList.remove('pp-zoomed');
      this._applyTransform();
    }

    _applyTransform() {
      this.img.style.transform = `translate(${this._pan.x}px, ${this._pan.y}px) scale(${this._zoom})`;
    }

    destroy() {
      this.el.remove();
    }
  }

  // Audio Player (wraps video player with visualization)
  const AUDIO_CSS = `
    .pp-audio-wrap {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      box-sizing: border-box;
    }

    .pp-audio-art {
      width: 200px;
      height: 200px;
      background: linear-gradient(135deg, #2c2c2e 0%, #1c1c1e 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }

    .pp-audio-art svg {
      width: 64px;
      height: 64px;
      fill: rgba(255, 255, 255, 0.3);
    }

    .pp-audio-title {
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 18px;
      font-weight: 500;
      margin-bottom: 8px;
      text-align: center;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pp-audio-player {
      width: 100%;
      max-width: 400px;
      margin-top: 24px;
    }
  `;

  function injectAudioStyles() {
    if (document.getElementById('pp-audio-styles')) return;
    const style = document.createElement('style');
    style.id = 'pp-audio-styles';
    style.textContent = AUDIO_CSS;
    document.head.appendChild(style);
  }

  const AUDIO_ICON = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';

  class AudioPlayer {
    constructor(container) {
      injectAudioStyles();
      this.container = container;
      this._listeners = new Map();
      this._build();
    }

    _build() {
      this.el = document.createElement('div');
      this.el.className = 'pp-audio-wrap';
      this.el.innerHTML = `
        <div class="pp-audio-art">${AUDIO_ICON}</div>
        <div class="pp-audio-title"></div>
        <div class="pp-audio-player"></div>
      `;

      this.titleEl = this.el.querySelector('.pp-audio-title');
      this.playerContainer = this.el.querySelector('.pp-audio-player');

      // Use VideoPlayer for controls (it handles audio fine)
      this.player = new VideoPlayer(this.playerContainer);

      // Forward events
      ['play', 'pause', 'ended', 'timeupdate', 'error'].forEach(evt => {
        this.player.on(evt, (data) => this._emit(evt, data));
      });

      this.container.appendChild(this.el);
    }

    load(src, title = '') {
      this.titleEl.textContent = title;
      this.player.load(src);
    }

    play() { this.player.play(); }
    pause() { this.player.pause(); }
    toggle() { this.player.toggle(); }

    on(event, callback) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(callback);
      return this;
    }

    _emit(event, data = {}) {
      (this._listeners.get(event) || []).forEach(cb => cb(data));
    }

    destroy() {
      this.player.destroy();
      this.el.remove();
    }
  }

  // Main PeerPreview class
  class PeerPreview {
    constructor(options = {}) {
      this.options = {
        defaultWidth: 800,
        defaultHeight: 600,
        ...options
      };

      this._listeners = new Map();
      this._overlay = null;
      this._currentPlayer = null;
      this._currentType = null;
    }

    _ensureOverlay() {
      if (!this._overlay) {
        this._overlay = new PreviewOverlay({
          showTrafficLights: true,
          closeOnBackdrop: true,
          closeOnEscape: true
        });

        this._overlay.on('close', () => {
          this._cleanup();
          this._emit('close');
        });
      }
      return this._overlay;
    }

    _cleanup() {
      if (this._currentPlayer) {
        this._currentPlayer.destroy();
        this._currentPlayer = null;
      }
      this._currentType = null;
    }

    /**
     * Open preview for a file
     * @param {string|object} source - URL string or { url, filename, size, qualities }
     * @param {object} options - Additional options
     */
    open(source, options = {}) {
      const overlay = this._ensureOverlay();
      this._cleanup();

      // Normalize source
      let url, filename, size, qualities;
      if (typeof source === 'string') {
        url = source;
        filename = source.split('/').pop().split('?')[0];
      } else {
        url = source.url;
        filename = source.filename || source.name || url?.split('/').pop();
        size = source.size;
        qualities = source.qualities;
      }

      const type = options.type || getType(filename);
      this._currentType = type;

      // Set up overlay
      const meta = size ? formatFileSize(size) : null;
      overlay.open({
        title: filename,
        meta: meta,
        width: options.width || this.options.defaultWidth,
        height: options.height || this.options.defaultHeight,
        showLoading: true
      });

      const slot = overlay.getContentSlot();

      // Create appropriate player
      switch (type) {
        case 'video':
          this._openVideo(slot, url, qualities, filename);
          break;
        case 'audio':
          this._openAudio(slot, url, filename);
          break;
        case 'image':
          this._openImage(slot, url, filename);
          break;
        default:
          overlay.showLoading('Unsupported file type');
          this._emit('error', { message: 'Unsupported file type', filename });
      }

      this._emit('open', { type, filename, url });
    }

    _openVideo(slot, url, qualities, filename) {
      const player = new VideoPlayer(slot, {
        qualities: qualities
      });

      player.load(qualities || url);
      this._overlay.hideLoading();

      // Forward events
      ['play', 'pause', 'ended', 'buffer-low', 'buffer-ok', 'quality-change'].forEach(evt => {
        player.on(evt, (data) => this._emit(evt, data));
      });

      // Handle fullscreen through overlay
      player.on('fullscreen-change', ({ fullscreen }) => {
        if (fullscreen) {
          this._overlay.enterFullscreen();
        } else {
          this._overlay.exitFullscreen();
        }
      });

      this._currentPlayer = player;
    }

    _openAudio(slot, url, filename) {
      const player = new AudioPlayer(slot);
      player.load(url, filename);
      this._overlay.hideLoading();

      ['play', 'pause', 'ended'].forEach(evt => {
        player.on(evt, (data) => this._emit(evt, data));
      });

      this._currentPlayer = player;
    }

    async _openImage(slot, url, filename) {
      const viewer = new ImageViewer(slot);
      
      try {
        const { width, height } = await viewer.load(url);
        this._overlay.hideLoading();
        
        // Resize window to fit image (with limits)
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.9;
        const titleBarHeight = 44;
        
        let w = Math.min(width, maxW);
        let h = Math.min(height + titleBarHeight, maxH);
        
        // Maintain aspect ratio
        const ratio = width / height;
        if (w / (h - titleBarHeight) > ratio) {
          w = (h - titleBarHeight) * ratio;
        } else {
          h = w / ratio + titleBarHeight;
        }
        
        this._overlay.setSize(Math.max(400, w), Math.max(300, h));
      } catch (err) {
        this._overlay.showLoading('Failed to load image');
        this._emit('error', { message: 'Failed to load image', error: err });
      }

      this._currentPlayer = viewer;
    }

    close() {
      if (this._overlay?.isOpen) {
        this._overlay.close();
      }
    }

    // Event system
    on(event, callback) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
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
      (this._listeners.get(event) || []).forEach(cb => cb(data));
    }

    destroy() {
      this._cleanup();
      this._overlay?.destroy();
      this._overlay = null;
      this._listeners.clear();
    }

    // Static helpers
    static canPreview(filename) {
      return canPreview(filename);
    }

    static getType(filename) {
      return getType(filename);
    }
  }

  return PeerPreview;
});
