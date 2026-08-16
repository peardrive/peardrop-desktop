/**
 * VideoPlayer v1.0.0
 * 
 * QuickTime-inspired HTML5 video player with buffer visualization.
 * Zero dependencies, works standalone or embedded.
 * 
 * EXPORTS: VideoPlayer (class)
 * EXTERNAL CALLS: None (pure browser APIs)
 * 
 * FUNCTIONS:
 * - constructor(container, options) — Initialize player
 * - load(src, options) — Load video source
 * - play() — Start playback
 * - pause() — Pause playback
 * - toggle() — Toggle play/pause
 * - seek(time) — Seek to time in seconds
 * - seekPercent(pct) — Seek to percentage (0-1)
 * - setVolume(level) — Set volume (0-1)
 * - setQuality(id) — Switch quality tier
 * - enterFullscreen() — Go fullscreen
 * - exitFullscreen() — Exit fullscreen
 * - destroy() — Clean up
 * 
 * EVENTS EMITTED:
 * - play, pause, ended, timeupdate, progress
 * - quality-change, fullscreen-change, error
 * - buffer-low, buffer-ok (for adaptive streaming)
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    root.VideoPlayer = factory();
  }
})(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  const CSS = `
    .vp-container {
      position: relative;
      width: 100%;
      height: 100%;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      user-select: none;
      border-radius: 8px;
    }

    .vp-video {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
    }

    /* Controls overlay */
    .vp-controls {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: linear-gradient(transparent, rgba(0,0,0,0.7));
      padding: 40px 16px 12px;
      opacity: 0;
      transition: opacity 0.25s ease;
    }

    .vp-container:hover .vp-controls,
    .vp-container.vp-paused .vp-controls,
    .vp-container.vp-controls-visible .vp-controls {
      opacity: 1;
    }

    /* Progress bar container */
    .vp-progress-wrap {
      position: relative;
      height: 20px;
      display: flex;
      align-items: center;
      cursor: pointer;
      margin-bottom: 8px;
    }

    .vp-progress-track {
      position: relative;
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.2);
      border-radius: 2px;
      overflow: hidden;
      transition: height 0.15s ease;
    }

    .vp-progress-wrap:hover .vp-progress-track {
      height: 6px;
    }

    /* Buffer indicator (behind progress) */
    .vp-buffer {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: rgba(255,255,255,0.3);
      border-radius: 2px;
      transition: width 0.1s ease;
    }

    /* Playback progress */
    .vp-progress {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: #fff;
      border-radius: 2px;
      transition: width 0.05s linear;
    }

    /* Scrub handle */
    .vp-scrub-handle {
      position: absolute;
      top: 50%;
      width: 14px;
      height: 14px;
      background: #fff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      opacity: 0;
      transition: opacity 0.15s ease;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }

    .vp-progress-wrap:hover .vp-scrub-handle {
      opacity: 1;
    }

    /* Bottom controls row */
    .vp-controls-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Buttons */
    .vp-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.9;
      transition: opacity 0.15s ease, transform 0.1s ease;
    }

    .vp-btn:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    .vp-btn svg {
      width: 24px;
      height: 24px;
      fill: currentColor;
    }

    /* Time display */
    .vp-time {
      color: rgba(255,255,255,0.9);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      min-width: 90px;
    }

    /* Volume */
    .vp-volume-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .vp-volume-slider {
      width: 60px;
      height: 4px;
      -webkit-appearance: none;
      background: rgba(255,255,255,0.3);
      border-radius: 2px;
      cursor: pointer;
    }

    .vp-volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
    }

    /* Quality selector */
    .vp-quality {
      margin-left: auto;
      position: relative;
    }

    .vp-quality-btn {
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 4px;
      color: #fff;
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .vp-quality-btn:hover {
      background: rgba(255,255,255,0.25);
    }

    .vp-quality-menu {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      background: rgba(30,30,30,0.95);
      backdrop-filter: blur(10px);
      border-radius: 6px;
      padding: 4px 0;
      min-width: 80px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: none;
    }

    .vp-quality-menu.vp-visible {
      display: block;
    }

    .vp-quality-option {
      padding: 6px 12px;
      color: #fff;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.1s ease;
    }

    .vp-quality-option:hover {
      background: rgba(255,255,255,0.1);
    }

    .vp-quality-option.vp-active {
      color: #4af;
    }

    /* Spacer */
    .vp-spacer {
      flex: 1;
    }

    /* Fullscreen button */
    .vp-fullscreen {
      margin-left: auto;
    }

    /* Center play button (big) */
    .vp-center-play {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 72px;
      height: 72px;
      background: rgba(0,0,0,0.6);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.2s ease, transform 0.15s ease;
      pointer-events: none;
    }

    .vp-container.vp-paused .vp-center-play {
      opacity: 1;
      pointer-events: auto;
    }

    .vp-center-play:hover {
      transform: translate(-50%, -50%) scale(1.08);
      background: rgba(0,0,0,0.7);
    }

    .vp-center-play svg {
      width: 32px;
      height: 32px;
      fill: #fff;
      margin-left: 4px;
    }

    /* Buffer spinner */
    .vp-buffering {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 48px;
      height: 48px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }

    .vp-container.vp-buffering-active .vp-buffering {
      opacity: 1;
    }

    .vp-buffering svg {
      width: 100%;
      height: 100%;
      animation: vp-spin 1s linear infinite;
    }

    @keyframes vp-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Fullscreen styles */
    .vp-container.vp-fullscreen {
      border-radius: 0;
    }

    .vp-container.vp-fullscreen .vp-video {
      max-width: none;
      max-height: none;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  `;

  // SVG Icons
  const ICONS = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>',
    volumeHigh: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>',
    volumeMute: '<svg viewBox="0 0 24 24"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>',
    fullscreenExit: '<svg viewBox="0 0 24 24"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>',
    spinner: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2"/><path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>'
  };

  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function injectStyles() {
    if (document.getElementById('video-player-styles')) return;
    const style = document.createElement('style');
    style.id = 'video-player-styles';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  class VideoPlayer {
    constructor(container, options = {}) {
      injectStyles();
      
      this.container = typeof container === 'string' 
        ? document.querySelector(container) 
        : container;
      
      this.options = {
        autoplay: false,
        muted: false,
        loop: false,
        qualities: null, // Array of { id, label, src }
        ...options
      };

      this._listeners = new Map();
      this._qualities = this.options.qualities || [];
      this._currentQuality = null;
      this._controlsTimeout = null;
      this._isFullscreen = false;
      this._isDragging = false;

      this._build();
      this._bindEvents();
    }

    _build() {
      this.el = document.createElement('div');
      this.el.className = 'vp-container vp-paused';

      this.el.innerHTML = `
        <video class="vp-video" playsinline></video>
        
        <div class="vp-center-play">${ICONS.play}</div>
        
        <div class="vp-buffering">${ICONS.spinner}</div>
        
        <div class="vp-controls">
          <div class="vp-progress-wrap">
            <div class="vp-progress-track">
              <div class="vp-buffer"></div>
              <div class="vp-progress"></div>
            </div>
            <div class="vp-scrub-handle"></div>
          </div>
          
          <div class="vp-controls-row">
            <button class="vp-btn vp-play-btn" title="Play/Pause">${ICONS.play}</button>
            
            <div class="vp-volume-wrap">
              <button class="vp-btn vp-volume-btn" title="Mute">${ICONS.volumeHigh}</button>
              <input type="range" class="vp-volume-slider" min="0" max="1" step="0.05" value="1">
            </div>
            
            <span class="vp-time">0:00 / 0:00</span>
            
            <div class="vp-spacer"></div>
            
            ${this._qualities.length > 1 ? `
              <div class="vp-quality">
                <button class="vp-quality-btn">Auto</button>
                <div class="vp-quality-menu"></div>
              </div>
            ` : ''}
            
            <button class="vp-btn vp-fullscreen" title="Fullscreen">${ICONS.fullscreen}</button>
          </div>
        </div>
      `;

      // Cache elements
      this.video = this.el.querySelector('.vp-video');
      this.playBtn = this.el.querySelector('.vp-play-btn');
      this.centerPlay = this.el.querySelector('.vp-center-play');
      this.progressWrap = this.el.querySelector('.vp-progress-wrap');
      this.progressBar = this.el.querySelector('.vp-progress');
      this.bufferBar = this.el.querySelector('.vp-buffer');
      this.scrubHandle = this.el.querySelector('.vp-scrub-handle');
      this.timeDisplay = this.el.querySelector('.vp-time');
      this.volumeBtn = this.el.querySelector('.vp-volume-btn');
      this.volumeSlider = this.el.querySelector('.vp-volume-slider');
      this.fullscreenBtn = this.el.querySelector('.vp-fullscreen');
      this.qualityBtn = this.el.querySelector('.vp-quality-btn');
      this.qualityMenu = this.el.querySelector('.vp-quality-menu');

      // Set initial state
      this.video.muted = this.options.muted;
      this.video.loop = this.options.loop;
      if (this.options.muted) {
        this.volumeSlider.value = 0;
        this.volumeBtn.innerHTML = ICONS.volumeMute;
      }

      this.container.appendChild(this.el);
    }

    _bindEvents() {
      // Video events
      this.video.addEventListener('play', () => {
        this.el.classList.remove('vp-paused');
        this.playBtn.innerHTML = ICONS.pause;
        this._emit('play');
      });

      this.video.addEventListener('pause', () => {
        this.el.classList.add('vp-paused');
        this.playBtn.innerHTML = ICONS.play;
        this._emit('pause');
      });

      this.video.addEventListener('ended', () => {
        this._emit('ended');
      });

      this.video.addEventListener('timeupdate', () => {
        if (!this._isDragging) {
          this._updateProgress();
        }
        this._emit('timeupdate', { 
          currentTime: this.video.currentTime, 
          duration: this.video.duration 
        });
      });

      this.video.addEventListener('progress', () => {
        this._updateBuffer();
        this._emit('progress');
      });

      this.video.addEventListener('waiting', () => {
        this.el.classList.add('vp-buffering-active');
        this._emit('buffer-low');
      });

      this.video.addEventListener('canplay', () => {
        this.el.classList.remove('vp-buffering-active');
        this._emit('buffer-ok');
      });

      this.video.addEventListener('loadedmetadata', () => {
        this._updateProgress();
      });

      this.video.addEventListener('error', (e) => {
        this._emit('error', { error: this.video.error });
      });

      // Play/pause controls
      this.playBtn.addEventListener('click', () => this.toggle());
      this.centerPlay.addEventListener('click', () => this.play());
      this.video.addEventListener('click', () => this.toggle());

      // Progress bar scrubbing
      this.progressWrap.addEventListener('mousedown', (e) => this._startScrub(e));
      document.addEventListener('mousemove', (e) => this._scrub(e));
      document.addEventListener('mouseup', () => this._endScrub());

      // Touch support for scrubbing
      this.progressWrap.addEventListener('touchstart', (e) => this._startScrub(e.touches[0]));
      document.addEventListener('touchmove', (e) => {
        if (this._isDragging) this._scrub(e.touches[0]);
      });
      document.addEventListener('touchend', () => this._endScrub());

      // Volume
      this.volumeBtn.addEventListener('click', () => this._toggleMute());
      this.volumeSlider.addEventListener('input', (e) => {
        this.setVolume(parseFloat(e.target.value));
      });

      // Fullscreen
      this.fullscreenBtn.addEventListener('click', () => this._toggleFullscreen());
      document.addEventListener('fullscreenchange', () => this._onFullscreenChange());
      document.addEventListener('webkitfullscreenchange', () => this._onFullscreenChange());

      // Quality selector
      if (this.qualityBtn) {
        this.qualityBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.qualityMenu.classList.toggle('vp-visible');
        });
        document.addEventListener('click', () => {
          this.qualityMenu?.classList.remove('vp-visible');
        });
      }

      // Keyboard shortcuts
      this.el.addEventListener('keydown', (e) => this._handleKeyboard(e));
      this.el.setAttribute('tabindex', '0');

      // Auto-hide controls
      this.el.addEventListener('mousemove', () => this._showControls());
      this.el.addEventListener('mouseleave', () => this._hideControlsDelayed());
    }

    _updateProgress() {
      const pct = (this.video.currentTime / this.video.duration) * 100 || 0;
      this.progressBar.style.width = pct + '%';
      this.scrubHandle.style.left = pct + '%';
      
      const current = formatTime(this.video.currentTime);
      const duration = formatTime(this.video.duration);
      this.timeDisplay.textContent = `${current} / ${duration}`;
    }

    _updateBuffer() {
      if (this.video.buffered.length > 0) {
        const bufferedEnd = this.video.buffered.end(this.video.buffered.length - 1);
        const pct = (bufferedEnd / this.video.duration) * 100;
        this.bufferBar.style.width = pct + '%';
      }
    }

    _startScrub(e) {
      this._isDragging = true;
      this._scrub(e);
    }

    _scrub(e) {
      if (!this._isDragging) return;
      const rect = this.progressWrap.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.progressBar.style.width = (pct * 100) + '%';
      this.scrubHandle.style.left = (pct * 100) + '%';
      this.video.currentTime = pct * this.video.duration;
    }

    _endScrub() {
      this._isDragging = false;
    }

    _toggleMute() {
      if (this.video.muted || this.video.volume === 0) {
        this.video.muted = false;
        this.setVolume(this._lastVolume || 1);
      } else {
        this._lastVolume = this.video.volume;
        this.setVolume(0);
      }
    }

    _toggleFullscreen() {
      if (this._isFullscreen) {
        this.exitFullscreen();
      } else {
        this.enterFullscreen();
      }
    }

    _onFullscreenChange() {
      this._isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
      this.el.classList.toggle('vp-fullscreen', this._isFullscreen);
      this.fullscreenBtn.innerHTML = this._isFullscreen ? ICONS.fullscreenExit : ICONS.fullscreen;
      this._emit('fullscreen-change', { fullscreen: this._isFullscreen });
    }

    _handleKeyboard(e) {
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          this.toggle();
          break;
        case 'f':
          this._toggleFullscreen();
          break;
        case 'Escape':
          if (this._isFullscreen) this.exitFullscreen();
          break;
        case 'ArrowLeft':
          this.seek(this.video.currentTime - 10);
          break;
        case 'ArrowRight':
          this.seek(this.video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.setVolume(Math.min(1, this.video.volume + 0.1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.setVolume(Math.max(0, this.video.volume - 0.1));
          break;
        case 'm':
          this._toggleMute();
          break;
      }
    }

    _showControls() {
      this.el.classList.add('vp-controls-visible');
      clearTimeout(this._controlsTimeout);
      if (!this.video.paused) {
        this._hideControlsDelayed();
      }
    }

    _hideControlsDelayed() {
      clearTimeout(this._controlsTimeout);
      this._controlsTimeout = setTimeout(() => {
        if (!this.video.paused) {
          this.el.classList.remove('vp-controls-visible');
        }
      }, 2500);
    }

    _buildQualityMenu() {
      if (!this.qualityMenu) return;
      
      this.qualityMenu.innerHTML = this._qualities.map(q => `
        <div class="vp-quality-option${q.id === this._currentQuality ? ' vp-active' : ''}" 
             data-quality="${q.id}">${q.label}</div>
      `).join('');

      this.qualityMenu.querySelectorAll('.vp-quality-option').forEach(opt => {
        opt.addEventListener('click', () => {
          this.setQuality(opt.dataset.quality);
          this.qualityMenu.classList.remove('vp-visible');
        });
      });
    }

    // Public API

    load(src, options = {}) {
      if (typeof src === 'string') {
        this.video.src = src;
      } else if (Array.isArray(src)) {
        this._qualities = src;
        this._buildQualityMenu();
        if (src.length > 0) {
          this._currentQuality = src[0].id;
          this.video.src = src[0].src;
          if (this.qualityBtn) {
            this.qualityBtn.textContent = src[0].label;
          }
        }
      }
      
      if (options.autoplay || this.options.autoplay) {
        this.video.play().catch(() => {});
      }
    }

    play() {
      return this.video.play();
    }

    pause() {
      this.video.pause();
    }

    toggle() {
      if (this.video.paused) {
        this.play();
      } else {
        this.pause();
      }
    }

    seek(time) {
      this.video.currentTime = Math.max(0, Math.min(this.video.duration || 0, time));
    }

    seekPercent(pct) {
      this.video.currentTime = pct * (this.video.duration || 0);
    }

    setVolume(level) {
      this.video.volume = Math.max(0, Math.min(1, level));
      this.video.muted = level === 0;
      this.volumeSlider.value = level;
      this.volumeBtn.innerHTML = level === 0 ? ICONS.volumeMute : ICONS.volumeHigh;
    }

    setQuality(id) {
      const quality = this._qualities.find(q => q.id === id);
      if (!quality) return;

      const currentTime = this.video.currentTime;
      const wasPlaying = !this.video.paused;

      this._currentQuality = id;
      this.video.src = quality.src;
      this.video.currentTime = currentTime;

      if (this.qualityBtn) {
        this.qualityBtn.textContent = quality.label;
      }

      this.qualityMenu?.querySelectorAll('.vp-quality-option').forEach(opt => {
        opt.classList.toggle('vp-active', opt.dataset.quality === id);
      });

      if (wasPlaying) {
        this.video.play().catch(() => {});
      }

      this._emit('quality-change', { quality });
    }

    enterFullscreen() {
      if (this.el.requestFullscreen) {
        this.el.requestFullscreen();
      } else if (this.el.webkitRequestFullscreen) {
        this.el.webkitRequestFullscreen();
      }
    }

    exitFullscreen() {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }

    get currentTime() {
      return this.video.currentTime;
    }

    get duration() {
      return this.video.duration;
    }

    get paused() {
      return this.video.paused;
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
      clearTimeout(this._controlsTimeout);
      this.video.pause();
      this.video.src = '';
      this.el.remove();
      this._listeners.clear();
    }
  }

  return VideoPlayer;
});
