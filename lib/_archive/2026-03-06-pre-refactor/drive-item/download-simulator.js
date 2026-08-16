/**
 * DownloadSimulator - Mimics real Hyperdrive download events
 * 
 * @module DownloadSimulator
 * @version 0.1.0
 * 
 * EXPORTS:
 *   - DownloadSimulator (class) - Simulates download progress
 * 
 * PURPOSE:
 *   Emit identical events to the real ProgressTracker so UI components
 *   can't tell the difference. Swap this out for real Hyperdrive and
 *   everything works the same.
 * 
 * EVENTS EMITTED (matches ProgressTracker):
 *   - 'peer-connected' - { peerId, driveId }
 *   - 'peer-disconnected' - { peerId, driveId }
 *   - 'progress' - { peerId, driveId, bytesTransferred, totalBytes, percent, speed }
 *   - 'complete' - { peerId, driveId, totalBytes, duration }
 * 
 * USAGE:
 *   const sim = new DownloadSimulator();
 *   sim.on('progress', (data) => driveItem.update({ progress: data.percent / 100, speed: data.speed }));
 *   sim.on('complete', (data) => driveItem.update({ status: 'complete', progress: 1, speed: 0 }));
 *   sim.start({ driveId: 'drive_001', totalBytes: 52428800 });
 */

(function(root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DownloadSimulator = factory();
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // Simple EventEmitter for browser
  class EventEmitter {
    constructor() {
      this._events = {};
    }

    on(event, callback) {
      if (!this._events[event]) this._events[event] = [];
      this._events[event].push(callback);
      return this;
    }

    off(event, callback) {
      if (this._events[event]) {
        this._events[event] = this._events[event].filter(cb => cb !== callback);
      }
      return this;
    }

    emit(event, data) {
      if (this._events[event]) {
        this._events[event].forEach(cb => cb(data));
      }
    }
  }

  // Generate realistic peer ID (12 hex chars like real Hyperdrive)
  function generatePeerId() {
    const chars = '0123456789abcdef';
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  }

  // Simulate realistic download speed (with variance)
  function simulateSpeed(baseSpeed) {
    // Add ±30% variance for realism
    const variance = 0.3;
    const factor = 1 + (Math.random() - 0.5) * 2 * variance;
    return Math.floor(baseSpeed * factor);
  }

  class DownloadSimulator extends EventEmitter {
    constructor() {
      super();
      this.running = false;
      this.interval = null;
      this.state = null;
    }

    /**
     * Start simulating a download
     * @param {Object} config
     * @param {string} config.driveId - Drive identifier
     * @param {number} config.totalBytes - Total bytes to "download"
     * @param {number} config.baseSpeed - Base download speed in bytes/sec (default 1MB/s)
     * @param {number} config.updateInterval - Update frequency in ms (default 100)
     * @param {boolean} config.simulatePeers - Simulate peer connections/disconnections
     * @param {number} config.initialDelay - Delay before transfer starts (simulates connecting)
     */
    start(config = {}) {
      if (this.running) this.stop();

      const {
        driveId = 'drive_sim_' + Date.now(),
        totalBytes = 10 * 1024 * 1024, // 10 MB default
        baseSpeed = 1024 * 1024, // 1 MB/s
        updateInterval = 100,
        simulatePeers = true,
        initialDelay = 500
      } = config;

      this.running = true;
      this.state = {
        driveId,
        totalBytes,
        bytesTransferred: 0,
        startTime: null,
        peerId: generatePeerId(),
        baseSpeed,
        updateInterval,
        simulatePeers
      };

      console.log('[DownloadSimulator] Starting', { driveId, totalBytes: this._formatBytes(totalBytes) });

      // Simulate connection delay
      setTimeout(() => {
        if (!this.running) return;

        this.state.startTime = Date.now();

        // Emit peer connected
        this.emit('peer-connected', {
          peerId: this.state.peerId,
          driveId
        });

        console.log('[DownloadSimulator] Peer connected', { peerId: this.state.peerId });

        // Start progress updates
        this.interval = setInterval(() => this._tick(), updateInterval);

      }, initialDelay);
    }

    /**
     * Stop the simulation
     */
    stop() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }

      if (this.state && this.running) {
        this.emit('peer-disconnected', {
          peerId: this.state.peerId,
          driveId: this.state.driveId
        });
        console.log('[DownloadSimulator] Stopped');
      }

      this.running = false;
      this.state = null;
    }

    /**
     * Pause the simulation
     */
    pause() {
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      console.log('[DownloadSimulator] Paused');
    }

    /**
     * Resume the simulation
     */
    resume() {
      if (this.running && !this.interval && this.state) {
        this.interval = setInterval(() => this._tick(), this.state.updateInterval);
        console.log('[DownloadSimulator] Resumed');
      }
    }

    /**
     * Get current state
     */
    getState() {
      if (!this.state) return null;

      const elapsed = (Date.now() - this.state.startTime) / 1000;
      const speed = elapsed > 0 ? this.state.bytesTransferred / elapsed : 0;
      const percent = Math.round((this.state.bytesTransferred / this.state.totalBytes) * 100);

      return {
        driveId: this.state.driveId,
        peerId: this.state.peerId,
        bytesTransferred: this.state.bytesTransferred,
        totalBytes: this.state.totalBytes,
        percent,
        speed,
        elapsed,
        running: this.running
      };
    }

    /**
     * Internal tick - simulate bytes received
     */
    _tick() {
      if (!this.running || !this.state) return;

      const { driveId, totalBytes, baseSpeed, updateInterval, peerId } = this.state;

      // Calculate bytes for this tick (speed adjusted for interval)
      const bytesPerTick = simulateSpeed(baseSpeed) * (updateInterval / 1000);
      this.state.bytesTransferred = Math.min(totalBytes, this.state.bytesTransferred + bytesPerTick);

      const elapsed = (Date.now() - this.state.startTime) / 1000;
      const speed = elapsed > 0 ? this.state.bytesTransferred / elapsed : 0;
      const percent = Math.round((this.state.bytesTransferred / totalBytes) * 100);

      // Emit progress (matches ProgressTracker format exactly)
      this.emit('progress', {
        peerId,
        driveId,
        bytesTransferred: Math.floor(this.state.bytesTransferred),
        totalBytes,
        percent,
        speed
      });

      // Check for completion
      if (this.state.bytesTransferred >= totalBytes) {
        clearInterval(this.interval);
        this.interval = null;

        const duration = Date.now() - this.state.startTime;

        this.emit('complete', {
          peerId,
          driveId,
          totalBytes,
          duration
        });

        console.log('[DownloadSimulator] Complete', {
          driveId,
          totalBytes: this._formatBytes(totalBytes),
          duration: (duration / 1000).toFixed(1) + 's'
        });

        this.running = false;
      }
    }

    _formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
  }

  return DownloadSimulator;
}));
