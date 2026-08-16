/**
 * DriveInfoPanel - macOS-style info panel for drive details
 * @module DriveInfoPanel
 * @version 1.0.0
 * EXPORTS:
 * DriveInfoPanel (class) - Modal info panel
 * showDriveInfo(data) - Quick function to show panel
 * USAGE:
 *   const panel = new DriveInfoPanel();
 *   panel.show({
 *     id: 'drive_123',
 *     title: 'My Files',
 *     size: 1024000,
 *     fileCount: 5,
 *     files: [{name: 'file.txt', size: 1024}],
 *     shareLink: 'peardrop://abc...',
 *     creator: 'npub1...',
 *     createdAt: '2026-03-14T...',
 *     localPath: '/path/to/files'
 *   });
 *   panel.hide();
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define(factory);
  } else {
    const exports = factory();
    root.DriveInfoPanel = exports.DriveInfoPanel;
    root.showDriveInfo = exports.showDriveInfo;
  }
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';

  // ==================== UTILITIES ====================
  // Shared formatting comes from lib/ui-utils.js (window.PearUtils, loaded
  // first). formatDate/truncateKey below are panel-specific and stay local.

  const formatBytes = (bytes) => PearUtils.formatBytes(bytes);

  function formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function truncateKey(key, len = 8) {
    if (!key) return '';
    if (key.length <= len * 2 + 3) return key;
    return key.slice(0, len) + '...' + key.slice(-len);
  }

  const escapeHtml = (text) => PearUtils.escapeHtml(text);
  const getFileIcon = (filename) => PearUtils.getFileIcon(filename);

  // ==================== STYLES ====================

  const STYLES = `
    .drive-info-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s ease, visibility 0.2s ease;
    }
    
    .drive-info-overlay.visible {
      opacity: 1;
      visibility: visible;
    }
    
    .drive-info-panel {
      width: 340px;
      max-height: 80vh;
      background: rgba(40, 40, 50, 0.95);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      box-shadow:
        0 20px 60px rgba(0, 0, 0, 0.5),
        0 0 0 1px rgba(255, 255, 255, 0.05) inset;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transform: scale(0.95) translateY(-10px);
      transition: transform 0.2s ease;
    }
    
    .drive-info-overlay.visible .drive-info-panel {
      transform: scale(1) translateY(0);
    }
    
    /* Close button */
    .drive-info-close-x {
      position: absolute;
      top: 12px;
      left: 12px;
      width: 24px;
      height: 24px;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      color: rgba(255, 255, 255, 0.6);
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      z-index: 10;
    }
    
    .drive-info-close-x:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
    }
    
    /* Header with preview */
    .drive-info-header {
      position: relative;
      padding: 20px;
      padding-top: 24px;
      text-align: center;
      background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      flex-shrink: 0;
    }
    
    .drive-info-icon {
      width: 80px;
      height: 80px;
      margin: 0 auto 12px;
      border-radius: 16px;
      background: linear-gradient(135deg, #4a9eff 0%, #7c3aed 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
      box-shadow: 0 4px 12px rgba(74, 158, 255, 0.3);
    }
    
    .drive-info-icon img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 16px;
    }
    
    .drive-info-title {
      font-size: 16px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 4px;
      word-break: break-word;
    }
    
    .drive-info-subtitle {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
    }
    
    /* Content sections */
    .drive-info-content {
      padding: 16px 20px;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
    }
    
    .drive-info-section {
      margin-bottom: 16px;
    }
    
    .drive-info-section:last-child {
      margin-bottom: 0;
    }
    
    .drive-info-section-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 8px;
    }
    
    .drive-info-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    
    .drive-info-row:last-child {
      border-bottom: none;
    }
    
    .drive-info-label {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      flex-shrink: 0;
      margin-right: 12px;
    }
    
    .drive-info-value {
      font-size: 12px;
      color: #fff;
      text-align: right;
      word-break: break-all;
      max-width: 180px;
    }
    
    .drive-info-value.mono {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.8);
    }
    
    .drive-info-value.link {
      color: #4a9eff;
      cursor: pointer;
    }
    
    .drive-info-value.link:hover {
      text-decoration: underline;
    }
    
    /* Creator section */
    .drive-info-creator {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 8px;
    }
    
    .drive-info-creator-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    
    .drive-info-creator-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }
    
    .drive-info-creator-details {
      flex: 1;
      min-width: 0;
    }
    
    .drive-info-creator-name {
      font-size: 13px;
      font-weight: 500;
      color: #fff;
    }
    
    .drive-info-creator-key-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .drive-info-creator-key {
      font-size: 10px;
      font-family: 'SF Mono', Monaco, monospace;
      color: rgba(255, 255, 255, 0.5);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .drive-info-copy-key {
      padding: 2px 4px;
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.4);
      font-size: 10px;
      cursor: pointer;
      border-radius: 3px;
      transition: background 0.15s, color 0.15s;
    }
    
    .drive-info-copy-key:hover {
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.8);
    }
    
    /* Zap button */
    .drive-info-zap {
      width: 32px;
      height: 32px;
      border: none;
      background: linear-gradient(135deg, #f7931a 0%, #ffb347 100%);
      border-radius: 50%;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 2px 8px rgba(247, 147, 26, 0.3);
    }
    
    .drive-info-zap:hover {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(247, 147, 26, 0.4);
    }
    
    .drive-info-zap:active {
      transform: scale(0.95);
    }
    
    .drive-info-zap.disabled {
      background: rgba(255, 255, 255, 0.1);
      box-shadow: none;
      cursor: not-allowed;
      opacity: 0.5;
    }
    
    .drive-info-zap.disabled:hover {
      transform: none;
    }
    
    /* Share link section */
    .drive-info-share-link {
      padding: 10px;
      background: rgba(74, 158, 255, 0.1);
      border: 1px solid rgba(74, 158, 255, 0.2);
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .drive-info-share-link-text {
      flex: 1;
      font-size: 10px;
      font-family: 'SF Mono', Monaco, monospace;
      color: #4a9eff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .drive-info-share-link-copy {
      padding: 4px 8px;
      background: rgba(74, 158, 255, 0.2);
      border: none;
      border-radius: 4px;
      color: #4a9eff;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s;
    }
    
    .drive-info-share-link-copy:hover {
      background: rgba(74, 158, 255, 0.3);
    }
    
    /* Files list */
    .drive-info-files {
      max-height: 120px;
      overflow-y: auto;
    }
    
    .drive-info-file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.03);
      border-radius: 6px;
      margin-bottom: 4px;
    }
    
    .drive-info-file:last-child {
      margin-bottom: 0;
    }
    
    .drive-info-file-icon {
      font-size: 14px;
    }
    
    .drive-info-file-name {
      flex: 1;
      font-size: 11px;
      color: #fff;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    
    .drive-info-file-size {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.5);
    }
    
    /* Footer */
    .drive-info-footer {
      padding: 12px 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: center;
      flex-shrink: 0;
    }
    
    .drive-info-close {
      padding: 8px 24px;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    
    .drive-info-close:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    
    /* Scrollbar */
    .drive-info-content::-webkit-scrollbar,
    .drive-info-files::-webkit-scrollbar {
      width: 6px;
    }
    
    .drive-info-content::-webkit-scrollbar-track,
    .drive-info-files::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .drive-info-content::-webkit-scrollbar-thumb,
    .drive-info-files::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 3px;
    }
  `;

  // ==================== DRIVEINFOPANEL CLASS ====================

  class DriveInfoPanel {
    constructor() {
      this._overlay = null;
      this._panel = null;
      this._data = null;
      this._onClose = null;
      this._injectStyles();
    }

    /**
     * Show the info panel with drive data
     * @param {Object} data - Drive data
     * @param {Function} onClose - Optional callback when closed
     */
    show(data, onClose) {
      this._data = data;
      this._onClose = onClose;
      
      if (!this._overlay) {
        this._createPanel();
      }
      
      this._updateContent();
      
      // Show with animation
      requestAnimationFrame(() => {
        this._overlay.classList.add('visible');
      });
    }

    /**
     * Hide the panel
     */
    hide() {
      if (this._overlay) {
        this._overlay.classList.remove('visible');
        
        // Cleanup after animation
        setTimeout(() => {
          if (this._onClose) this._onClose();
        }, 200);
      }
    }

    /**
     * Destroy the panel
     */
    destroy() {
      if (this._overlay && this._overlay.parentNode) {
        this._overlay.parentNode.removeChild(this._overlay);
      }
      this._overlay = null;
      this._panel = null;
    }

    // ==================== PRIVATE METHODS ====================

    _injectStyles() {
      if (document.getElementById('drive-info-panel-styles')) return;
      
      const style = document.createElement('style');
      style.id = 'drive-info-panel-styles';
      style.textContent = STYLES;
      document.head.appendChild(style);
    }

    _createPanel() {
      // Create overlay
      this._overlay = document.createElement('div');
      this._overlay.className = 'drive-info-overlay';
      
      // Create panel
      this._panel = document.createElement('div');
      this._panel.className = 'drive-info-panel';
      
      this._overlay.appendChild(this._panel);
      document.body.appendChild(this._overlay);
      
      // Close on overlay click
      this._overlay.addEventListener('click', (e) => {
        if (e.target === this._overlay) {
          this.hide();
        }
      });
      
      // Close on Escape
      this._escHandler = (e) => {
        if (e.key === 'Escape') this.hide();
      };
      document.addEventListener('keydown', this._escHandler);
    }

    _updateContent() {
      const data = this._data;
      
      // Determine icon
      const iconContent = data.thumbnail 
        ? `<img src="${escapeHtml(data.thumbnail)}" alt="">`
        : getFileIcon(data.title || data.files?.[0]?.name);
      
      // Format share link
      const shareLink = data.shareLink || (data.key ? `peardrop://${data.key}` : null);
      
      // Build files list
      let filesHtml = '';
      if (data.files && data.files.length > 0) {
        filesHtml = `
          <div class="drive-info-section">
            <div class="drive-info-section-title">Files</div>
            <div class="drive-info-files">
              ${data.files.slice(0, 20).map(f => `
                <div class="drive-info-file">
                  <span class="drive-info-file-icon">${getFileIcon(f.name)}</span>
                  <span class="drive-info-file-name">${escapeHtml(f.name)}</span>
                  <span class="drive-info-file-size">${formatBytes(f.size)}</span>
                </div>
              `).join('')}
              ${data.files.length > 20 ? `
                <div class="drive-info-file" style="justify-content: center; opacity: 0.5;">
                  +${data.files.length - 20} more files
                </div>
              ` : ''}
            </div>
          </div>
        `;
      }
      
      // Build creator section
      const creatorName = data.creatorName || 'Unknown';
      const creatorKey = data.creator || data.creatorId || data.key || '';
      const creatorAvatar = data.creatorAvatar 
        ? `<img src="${escapeHtml(data.creatorAvatar)}" alt="">`
        : '👤';
      
      // Check if tip/zap is available
      const hasTipAddress = !!(data.tipAddress || data.lightningAddress || data.lnurl);
      
      this._panel.innerHTML = `
        <div class="drive-info-header">
          <button class="drive-info-close-x" aria-label="Close">✕</button>
          <div class="drive-info-icon">${iconContent}</div>
          <div class="drive-info-title">${escapeHtml(data.title || data.name || 'Untitled')}</div>
          <div class="drive-info-subtitle">${formatBytes(data.size || data.totalBytes)} • ${data.fileCount || data.files?.length || 1} file${(data.fileCount || data.files?.length || 1) !== 1 ? 's' : ''}</div>
        </div>
        
        <div class="drive-info-content">
          <!-- General Info -->
          <div class="drive-info-section">
            <div class="drive-info-section-title">General</div>
            <div class="drive-info-row">
              <span class="drive-info-label">Status</span>
              <span class="drive-info-value">${escapeHtml(data.status || 'Unknown')}</span>
            </div>
            <div class="drive-info-row">
              <span class="drive-info-label">Type</span>
              <span class="drive-info-value">${data.type === 'upload' || data.isUpload ? 'Shared' : 'Downloaded'}</span>
            </div>
            ${data.createdAt ? `
              <div class="drive-info-row">
                <span class="drive-info-label">Created</span>
                <span class="drive-info-value">${formatDate(data.createdAt)}</span>
              </div>
            ` : ''}
            ${data.localPath ? `
              <div class="drive-info-row">
                <span class="drive-info-label">Location</span>
                <span class="drive-info-value link drive-info-location" data-path="${escapeHtml(data.localPath)}" title="Open in Finder">${escapeHtml(data.localPath.split('/').slice(-2).join('/'))}</span>
              </div>
            ` : ''}
          </div>
          
          <!-- Creator -->
          <div class="drive-info-section">
            <div class="drive-info-section-title">Creator</div>
            <div class="drive-info-creator">
              <div class="drive-info-creator-avatar">${creatorAvatar}</div>
              <div class="drive-info-creator-details">
                <div class="drive-info-creator-name">${escapeHtml(creatorName)}</div>
                <div class="drive-info-creator-key-row">
                  <span class="drive-info-creator-key">${truncateKey(creatorKey, 12)}</span>
                  ${creatorKey ? `<button class="drive-info-copy-key" data-key="${escapeHtml(creatorKey)}" title="Copy public key">📋</button>` : ''}
                </div>
              </div>
              <button class="drive-info-zap ${hasTipAddress ? '' : 'disabled'}" 
                      data-tip="${escapeHtml(data.tipAddress || data.lightningAddress || data.lnurl || '')}"
                      title="${hasTipAddress ? 'Send tip via Lightning' : 'No tip address available'}">⚡</button>
            </div>
          </div>
          
          <!-- Share Link -->
          ${shareLink ? `
            <div class="drive-info-section">
              <div class="drive-info-section-title">Share Link</div>
              <canvas class="drive-info-qr" width="160" height="160" style="display:none; margin: 0 auto 10px; border-radius: 8px;"></canvas>
              <div class="drive-info-share-link">
                <span class="drive-info-share-link-text">${escapeHtml(shareLink)}</span>
                <button class="drive-info-share-link-copy" data-link="${escapeHtml(shareLink)}">Copy</button>
              </div>
            </div>
          ` : ''}
          
          <!-- Files -->
          ${filesHtml}
          
          <!-- Technical -->
          <div class="drive-info-section">
            <div class="drive-info-section-title">Technical</div>
            <div class="drive-info-row">
              <span class="drive-info-label">Drive ID</span>
              <span class="drive-info-value mono">${truncateKey(data.id, 10)}</span>
            </div>
            ${data.key ? `
              <div class="drive-info-row">
                <span class="drive-info-label">Public Key</span>
                <span class="drive-info-value mono">${truncateKey(data.key, 10)}</span>
              </div>
            ` : ''}
            ${data.peers !== undefined ? `
              <div class="drive-info-row">
                <span class="drive-info-label">Peers</span>
                <span class="drive-info-value">${data.peers}</span>
              </div>
            ` : ''}
          </div>
        </div>
        
        <div class="drive-info-footer">
          <button class="drive-info-close">Done</button>
        </div>
      `;
      
      // Bind events
      
      // Close X button
      const closeX = this._panel.querySelector('.drive-info-close-x');
      if (closeX) {
        closeX.addEventListener('click', () => this.hide());
      }
      
      // Done button
      this._panel.querySelector('.drive-info-close').addEventListener('click', () => this.hide());
      
      // Copy share link button
      const copyBtn = this._panel.querySelector('.drive-info-share-link-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', async (e) => {
          const link = e.target.dataset.link;
          try {
            await navigator.clipboard.writeText(link);
            e.target.textContent = 'Copied!';
            setTimeout(() => {
              e.target.textContent = 'Copy';
            }, 1500);
          } catch (err) {
            console.error('Copy failed:', err);
          }
        });
      }
      
      // Copy public key button
      const copyKeyBtn = this._panel.querySelector('.drive-info-copy-key');
      if (copyKeyBtn) {
        copyKeyBtn.addEventListener('click', async (e) => {
          const key = e.target.dataset.key;
          try {
            await navigator.clipboard.writeText(key);
            e.target.textContent = '✓';
            setTimeout(() => {
              e.target.textContent = '📋';
            }, 1500);
          } catch (err) {
            console.error('Copy failed:', err);
          }
        });
      }
      
      // Location click - open in Finder
      const locationEl = this._panel.querySelector('.drive-info-location');
      if (locationEl) {
        locationEl.addEventListener('click', () => {
          const path = locationEl.dataset.path;
          if (path && window.electronAPI?.showFileInFolder) {
            window.electronAPI.showFileInFolder(path);
          } else if (path && window.require) {
            // Fallback for Electron context
            const { shell } = window.require('electron');
            shell.showItemInFolder(path);
          }
        });
      }
      
      // Zap/tip button
      const zapBtn = this._panel.querySelector('.drive-info-zap');
      if (zapBtn && !zapBtn.classList.contains('disabled')) {
        zapBtn.addEventListener('click', (e) => {
          const tipAddress = e.target.dataset.tip;
          if (tipAddress) {
            // Emit event for parent to handle (open Lightning wallet, etc.)
            console.log('[DriveInfoPanel] Zap requested:', tipAddress);
            
            // Try to open lightning: URL if it looks like one
            if (tipAddress.startsWith('lnurl') || tipAddress.includes('@')) {
              // For LNURL or Lightning Address, try to open
              const lightningUrl = tipAddress.startsWith('lightning:') 
                ? tipAddress 
                : `lightning:${tipAddress}`;
              window.open(lightningUrl, '_blank');
            } else if (tipAddress.startsWith('lnbc')) {
              // It's an invoice
              window.open(`lightning:${tipAddress}`, '_blank');
            } else {
              // Copy to clipboard as fallback
              navigator.clipboard.writeText(tipAddress);
              e.target.textContent = '✓';
              setTimeout(() => {
                e.target.textContent = '⚡';
              }, 1500);
            }
          }
        });
      }

      // Generate QR code for share link
      const qrCanvas = this._panel.querySelector('.drive-info-qr');
      if (qrCanvas && shareLink && window.electronAPI?.generateQr) {
        window.electronAPI.generateQr(shareLink).then(dataUrl => {
          const img = new Image();
          img.onload = () => {
            const ctx = qrCanvas.getContext('2d');
            ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
            ctx.drawImage(img, 0, 0, qrCanvas.width, qrCanvas.height);
            qrCanvas.style.display = 'block';
          };
          img.src = dataUrl;
        }).catch(() => {
          qrCanvas.style.display = 'none';
        });
      }
    }
  }

  // Quick function to show panel
  function showDriveInfo(data, onClose) {
    const panel = new DriveInfoPanel();
    panel.show(data, onClose);
    return panel;
  }

  return {
    DriveInfoPanel,
    showDriveInfo
  };
}));
