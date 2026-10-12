/**
 * MODULE: lib/ui-utils.js
 * PURPOSE: Single source of truth for pure UI formatting helpers shared by the
 *          browser-side components (renderer, drive-item, drive-info-panel,
 *          qr-scanner). Eliminates the previous 3-4x duplication of these
 *          functions, which was the exact "copy-paste then diverge" failure
 *          mode CLAUDE.md warns about.
 * LOAD ORDER: must be the FIRST <script> in index.html, before any component
 *          that delegates to it (scroll-list, drive-item, etc.).
 * EXPORTS (via window.PearUtils, also module.exports for Node unit tests):
 * formatBytes(bytes) - "1.5 MB"
 * formatSpeed(bytesPerSec) - "1.5 MB/s" (UI-tuned precision; '' for 0)
 * getFileIcon(filename) - emoji for a file extension
 * escapeHtml(text) - HTML-escape (also escapes quotes -> safe in
 *                                 attribute contexts, unlike the old DOM impl)
 * truncateMiddle(str, max) - "long…name"
 * KEY STATE: none (pure functions)
 */
(function (root) {
  'use strict';

  function formatBytes(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatSpeed(bytesPerSec) {
    if (bytesPerSec == null || bytesPerSec === 0) return '';
    const k = 1024;
    // Bytes - rare but handle it
    if (bytesPerSec < k) {
      return Math.round(bytesPerSec) + ' B/s';
    }
    // KB range
    const kb = bytesPerSec / k;
    if (kb < 100) return kb.toFixed(1) + ' KB/s';
    if (kb < 1000) return Math.round(kb) + ' KB/s';
    // MB range
    const mb = bytesPerSec / (k * k);
    if (mb < 10) return mb.toFixed(2) + ' MB/s';
    if (mb < 100) return mb.toFixed(1) + ' MB/s';
    return Math.round(mb) + ' MB/s';
  }

  const FILE_ICONS = {
    // Images
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
    // Video
    mp4: '🎬', mov: '🎬', avi: '🎬', mkv: '🎬', webm: '🎬',
    // Audio
    mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵', m4a: '🎵',
    // Documents
    pdf: '📕', doc: '📘', docx: '📘', txt: '📄', md: '📝',
    // Archives
    zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦',
    // Code
    js: '⚙️', ts: '⚙️', py: '🐍', html: '🌐', css: '🎨', json: '📋'
  };

  function getFileIcon(filename) {
    if (!filename) return '📄';
    const ext = filename.split('.').pop()?.toLowerCase();
    return FILE_ICONS[ext] || '📄';
  }

  // Human-readable file category from extension — used for the
  // "Picture • Completed" style prefix in Desktop v2 drive rows.
  // Returns null if the extension is unknown or the filename is missing
  // (caller should skip the prefix in that case).
  const FILE_CATEGORIES = {
    // Images
    jpg: 'Picture', jpeg: 'Picture', png: 'Picture', gif: 'Picture',
    webp: 'Picture', svg: 'Picture', bmp: 'Picture', tiff: 'Picture', tif: 'Picture', heic: 'Picture',
    // Video
    mp4: 'Video', mov: 'Video', avi: 'Video', mkv: 'Video', webm: 'Video', m4v: 'Video',
    // Audio
    mp3: 'Music', wav: 'Music', ogg: 'Music', flac: 'Music', m4a: 'Music', aac: 'Music',
    // Documents
    pdf: 'Document', doc: 'Document', docx: 'Document', txt: 'Document',
    md: 'Document', rtf: 'Document', pages: 'Document',
    // Archives
    zip: 'Archive', rar: 'Archive', '7z': 'Archive', tar: 'Archive', gz: 'Archive'
  };
  function getFileType(filename) {
    if (!filename) return null;
    const ext = filename.split('.').pop()?.toLowerCase();
    return FILE_CATEGORIES[ext] || null;
  }

  // ==================== SVG FILE-TYPE ICONS ====================
  // Beautiful category-tinted icons for the drive-item thumbnail slot
  // when the file has no real preview thumbnail (audio, docs, code,
  // etc.). Icons drawn with `fill="currentColor"` for the base shape
  // so callers can theme them via CSS `color:` / inline style, plus
  // baked semi-transparent black overlays for depth (fill=rgba(0,0,0,x)
  // reads as a darker shading against the coloured base regardless of
  // page background).
  //
  // Extension → category → icon (svg + color). Coverage: 90+ file
  // extensions across 17 categories + a generic fallback.
  const FILE_TYPE_ICONS = {
    image: {
      color: '#4a9eff',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.5" cy="9" r="1.6" fill="rgba(0,0,0,0.35)"/><path d="M4 18l4.5-5 3 3 3.5-4 5 6z" fill="rgba(0,0,0,0.35)"/></svg>'
    },
    video: {
      color: '#ff5e5e',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9l6 3-6 3z" fill="rgba(0,0,0,0.4)"/></svg>'
    },
    audio: {
      color: '#c67cff',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 4v10.3a3.5 3.5 0 1 1-2-3.15V7l-6 1.5v9.8a3.5 3.5 0 1 1-2-3.15V5.6z"/></svg>'
    },
    pdf: {
      color: '#ff5e5e',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><path d="M7 14h10M7 17h7" stroke="rgba(0,0,0,0.4)" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>'
    },
    word: {
      color: '#3b7cd4',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><path d="M7 13h10M7 16h10M7 19h6" stroke="rgba(0,0,0,0.4)" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>'
    },
    excel: {
      color: '#4dc07a',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><path d="M6 13h12M6 16h12M6 19h12M10 12v9M14 12v9" stroke="rgba(0,0,0,0.4)" stroke-width="0.9" fill="none"/></svg>'
    },
    ppt: {
      color: '#e88536',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><rect x="7" y="15" width="2" height="4" fill="rgba(0,0,0,0.4)"/><rect x="11" y="12" width="2" height="7" fill="rgba(0,0,0,0.4)"/><rect x="15" y="14" width="2" height="5" fill="rgba(0,0,0,0.4)"/></svg>'
    },
    text: {
      color: '#9aa0aa',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><path d="M7 12h10M7 15h10M7 18h7" stroke="rgba(0,0,0,0.4)" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>'
    },
    archive: {
      color: '#d1a05b',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3z"/><path d="M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><rect x="10.5" y="12" width="3" height="5" rx="0.6" fill="rgba(0,0,0,0.4)"/></svg>'
    },
    code: {
      color: '#f5c93a',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><path d="M10.5 12L7 15l3.5 3M13.5 12L17 15l-3.5 3" stroke="rgba(0,0,0,0.45)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    },
    web: {
      color: '#ff9f0a',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a12 12 0 0 1 0 18M12 3a12 12 0 0 0 0 18" stroke="rgba(0,0,0,0.4)" stroke-width="1.2" fill="none"/></svg>'
    },
    data: {
      color: '#af52de',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/><path d="M11 12c-1.5 0-2 1-2 2s-1 1.5-2 1.5c1 0 2 .5 2 1.5s.5 2 2 2M13 12c1.5 0 2 1 2 2s1 1.5 2 1.5c-1 0-2 .5-2 1.5s-.5 2-2 2" stroke="rgba(0,0,0,0.45)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    },
    design: {
      color: '#ff6b8b',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3a9 9 0 0 0 0 18c1.1 0 1.7-.9 1.7-1.8 0-.5-.3-.9-.3-1.4 0-.6.5-1 1-1h1.6a4 4 0 0 0 4-4C20 7.3 16.4 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="rgba(0,0,0,0.4)"/><circle cx="10" cy="7" r="1.2" fill="rgba(0,0,0,0.4)"/><circle cx="14" cy="7" r="1.2" fill="rgba(0,0,0,0.4)"/><circle cx="17" cy="10.5" r="1.2" fill="rgba(0,0,0,0.4)"/></svg>'
    },
    executable: {
      color: '#8a9199',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/><circle cx="12" cy="12" r="3" fill="rgba(0,0,0,0.45)"/></svg>'
    },
    book: {
      color: '#a67c52',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v18H5.5A1.5 1.5 0 0 1 4 19.5z"/><path d="M13 3h5.5A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5H13z"/></svg>'
    },
    iso: {
      color: '#5ac8fa',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="rgba(0,0,0,0.55)"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>'
    },
    database: {
      color: '#3d6dc7',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><ellipse cx="12" cy="5" rx="8" ry="2.5"/><path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" stroke="currentColor" stroke-width="1" fill="currentColor"/><path d="M4 12v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" stroke="currentColor" stroke-width="1" fill="currentColor"/></svg>'
    },
    default: {
      color: '#8a9199',
      svg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="rgba(0,0,0,0.18)"/></svg>'
    }
  };

  // Extension → icon-category map. Order matters when an extension
  // could belong to multiple buckets (e.g. `dmg` is both an installer
  // and a disk image — we place it under `executable` because that's
  // how users encounter it in practice).
  const EXT_TO_CATEGORY = {
    // Images (also get real thumbnails, this is the fallback)
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image',
    webp: 'image', svg: 'image', bmp: 'image',
    tiff: 'image', tif: 'image', heic: 'image', avif: 'image',
    // Video
    mp4: 'video', mov: 'video', avi: 'video', mkv: 'video',
    webm: 'video', m4v: 'video', flv: 'video', wmv: 'video',
    // Audio
    mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
    m4a: 'audio', aac: 'audio', wma: 'audio', opus: 'audio',
    // PDF
    pdf: 'pdf',
    // Word processor
    doc: 'word', docx: 'word', pages: 'word', odt: 'word',
    // Spreadsheet
    xls: 'excel', xlsx: 'excel', numbers: 'excel',
    csv: 'excel', ods: 'excel', tsv: 'excel',
    // Presentation
    ppt: 'ppt', pptx: 'ppt', key: 'ppt', odp: 'ppt',
    // Text
    txt: 'text', md: 'text', rtf: 'text', log: 'text', tex: 'text',
    // Archive
    zip: 'archive', rar: 'archive', '7z': 'archive',
    tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive',
    // Code
    js: 'code', ts: 'code', jsx: 'code', tsx: 'code', mjs: 'code', cjs: 'code',
    py: 'code', rb: 'code', php: 'code', sh: 'code', bat: 'code', ps1: 'code',
    java: 'code', c: 'code', cpp: 'code', cc: 'code', h: 'code', hpp: 'code',
    cs: 'code', go: 'code', rs: 'code', swift: 'code', kt: 'code', dart: 'code',
    vue: 'code', svelte: 'code', lua: 'code',
    // Web
    html: 'web', htm: 'web', css: 'web', scss: 'web', sass: 'web', less: 'web',
    // Data
    json: 'data', yaml: 'data', yml: 'data', xml: 'data',
    toml: 'data', ini: 'data', env: 'data',
    // Design
    psd: 'design', ai: 'design', sketch: 'design', fig: 'design', xd: 'design',
    afphoto: 'design', afdesign: 'design',
    // Executable / installer (dmg lives here, not under iso)
    exe: 'executable', dmg: 'executable', app: 'executable',
    msi: 'executable', deb: 'executable', apk: 'executable',
    appimage: 'executable', pkg: 'executable',
    // Book
    epub: 'book', mobi: 'book', azw: 'book', azw3: 'book',
    // Disk image (excluding dmg — handled above)
    iso: 'iso', img: 'iso',
    // Database
    sql: 'database', db: 'database', sqlite: 'database', mdb: 'database'
  };

  // Get the SVG icon + tint for a filename. Always returns a valid
  // object — falls back to the generic file icon for unknown types.
  function getFileIconSvg(filename) {
    if (!filename) return FILE_TYPE_ICONS.default;
    const ext = filename.split('.').pop()?.toLowerCase();
    const category = EXT_TO_CATEGORY[ext] || 'default';
    return FILE_TYPE_ICONS[category] || FILE_TYPE_ICONS.default;
  }

  // Regex-based escape: also escapes quotes, so it is correct in BOTH element
  // text and attribute contexts (the old DOM-innerHTML impl left quotes raw).
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(text) {
    if (text == null) return '';
    return String(text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

  function truncateMiddle(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    const half = Math.floor((maxLen - 3) / 2);
    return str.slice(0, half) + '...' + str.slice(-half);
  }

  const PearUtils = { formatBytes, formatSpeed, getFileIcon, getFileIconSvg, getFileType, escapeHtml, truncateMiddle };

  if (typeof module === 'object' && module.exports) module.exports = PearUtils;
  if (root) root.PearUtils = PearUtils;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
