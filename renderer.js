/**
 * MODULE: renderer.js (PearDrop v2)
 * PURPOSE: PearDrop UI - Integrated ScrollList + DriveItem with PearCore backend
 * VERSION: 0.27.0
 * 
 * ARCHITECTURE:
 *   - Uses ScrollList v2 slot-based system
 *   - DriveItem components mount into slots
 *   - DriveActions module handles menu action → API calls
 *   - Same PearCore backend (IPC unchanged)
 *   - Modular, standalone components
 * 
 * EXPORTS: None (DOM script)
 *
 * WINDOW-EXPOSED MODAL OPENERS (called from the DriveItem action
 * handler, which is defined before the controllers run):
 *   - openInfoModal / closeInfoModal     — File Info (screen #19)
 *   - openFolderModal / closeFolderModal — Folder contents (screen #22)
 *   - openSendModal / closeSendModal     — Send modal (screen #14)
 *   - openRenameModal / closeRenameModal — Rename (local alias)
 *
 * WINDOW-EXPOSED CONTROLLERS:
 *   - shareProgress { begin, finish, fail } — drives Send-modal State C
 *     and the bottom-right pill from the 'share-progress' IPC event
 * 
 * LAYOUT:
 *   - Header: Profile icon (top-left)
 *   - Drop zone: Compact file drop area
 *   - List: ScrollList with DriveItem slots
 *   - Input: Paste peardrop:// links
 *   - Actions: Share + Download buttons
 * 
 * EXTERNAL MODULES:
 *   - ScrollList (lib/scroll-list/scroll-list.js)
 *   - DriveItem (lib/drive-item/drive-item.js)
 *   - DriveActions (lib/drive-actions.js)
 *   - QrScanner (lib/qr-scanner/qr-scanner.js) — window.openQrScanner
 * 
 * IPC CALLS (via window.electronAPI):
 *   - hyperdriveShare, hyperdriveOpen, hyperdriveDownload
 *   - drivesList, drivesPause, drivesResume, drivesRemove, driveGet
 *   - openDownloads, openFile, showFileInFolder, getFilesStats
 *   - getDebug, setDebug
 * 
 * IPC LISTENERS:
 *   - onPeerConnected, onPeerDisconnected
 *   - onUploadProgress, onFilesDownloaded, onDrivesUpdated
 * 
 * DEBUG:
 *   In DevTools console:
 *   - peardrop.debug()      — Check if debug logging is enabled
 *   - peardrop.setDebug(true/false) — Toggle debug logging
 */

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const dropZone = document.getElementById('dropZone');
const dropContent = document.getElementById('dropContent');
const filePreview = document.getElementById('filePreview');
const fileIcon = document.getElementById('fileIcon');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const clearBtn = document.getElementById('clearBtn');
const shareBtn = document.getElementById('shareBtn');
const downloadBtn = document.getElementById('downloadBtn');
const linkInput = document.getElementById('linkInput');
const listContainer = document.getElementById('listContainer');
const shareModal = document.getElementById('shareModal');
const shareLinkDisplay = document.getElementById('shareLinkDisplay');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const closeShareBtn = document.getElementById('closeShareBtn');
const toast = document.getElementById('toast');
const profileIcon = document.getElementById('profileIcon');
const tabShares = document.getElementById('tabShares');
const listMenuBtn = document.getElementById('listMenuBtn');
const listMenuDropdown = document.getElementById('listMenuDropdown');
const sortByTrigger = document.getElementById('sortByTrigger');
const sortSubmenu = document.getElementById('sortSubmenu');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmTitle = document.getElementById('confirmTitle');
const confirmMessage = document.getElementById('confirmMessage');
const confirmButtons = document.getElementById('confirmButtons');
const qrUploadBtn = document.getElementById('qrUploadBtn');

// ============================================================================
// STATE
// ============================================================================

let initialized = false;        // Guard against double init
let activeFiles = [];           // Files selected for sharing
let currentShareLink = null;    // Active share link
let pendingShareAnimationId = null; // Drive added silently behind share modal — animate on close
let driveActions = null;        // DriveActions instance (set in init)
let currentDriveId = null;      // Active drive ID
let drives = [];                // All drives from HyperdriveManager
let driveItems = new Map();     // driveId -> DriveItem instance
let scrollList = null;          // ScrollList instance

// Sort state
let sortField = 'recent';       // recent | status | size | custom
let sortDirection = 'desc';     // desc (default) | asc
let isReorderMode = false;      // Manual reorder mode active

// View state
let isExpandedView = false;     // false = compact, true = expanded

// Active page (mirrored across mobile-UI tabs + desktop-UI sidebar).
// 'share'    → drop zone on top, only type:'share' drives visible
// 'receive'  → paste-link on top, only type:'download' drives visible
let currentPage = 'share';

// File thumbnail cache for the expanded drive-item child rows.
// Keyed by absolute file path → { kind: 'image' | 'icon' | 'none', src: string|null }.
// Lives for the session; cleared on app restart. Avoids re-IPC on re-expand.
const fileThumbnailCache = new Map();
// Cache successes forever, failures never. A video grab that times out
// while the app is still booting (10 drives resuming, swarm bootstrapping)
// used to poison the cache with { kind:'none' } for the whole session —
// which is why thumbnails only appeared after a manual refresh. Retrying
// later is cheap; a permanently wrong icon is not.
// Re-attempt any drive still without a real thumbnail, once the app has
// stopped competing with itself for the decoder.
let _thumbRetryTimer = null;
function scheduleThumbnailRetry() {
    if (_thumbRetryTimer) clearTimeout(_thumbRetryTimer);
    _thumbRetryTimer = setTimeout(() => {
        _thumbRetryTimer = null;
        const run = () => {
            for (const d of drives) {
                try {
                    loadSingleFileThumbnail(d.id);
                    loadGroupThumbnail(d.id);
                } catch (_) { /* one bad drive shouldn't stop the pass */ }
            }
        };
        if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
        else run();
    }, 4000);
}

// Disk-backed so thumbnails survive a restart — previously the Map was
// in-memory only, so every cold start re-decoded every video from scratch.
// Only successful IMAGE results are persisted; OS icons are cheap to
// refetch and failures must stay retryable.
// v2: v1 entries were written before the cover-art extractor was fixed and
// can contain truncated (broken) image data URLs. Bumping the key discards
// them — a persisted bad thumbnail survives restarts and would otherwise
// mask the fix forever.
const THUMB_CACHE_KEY = 'peardrop.thumbcache.v3';
const THUMB_CACHE_STALE_KEYS = ['peardrop.thumbcache.v1', 'peardrop.thumbcache.v2'];
const THUMB_CACHE_MAX = 300;          // ~3KB each -> comfortably under quota

function loadThumbCache() {
    // Reclaim the space old versions were using.
    for (const k of THUMB_CACHE_STALE_KEYS) {
        try { localStorage.removeItem(k); } catch (_) {}
    }
    try {
        const raw = localStorage.getItem(THUMB_CACHE_KEY);
        if (!raw) return;
        const obj = JSON.parse(raw);
        for (const [path, v] of Object.entries(obj)) {
            if (!v || v.kind !== 'image' || !v.src) continue;
            // A data: URL must carry a real payload and a plausible image
            // mime. Cheap string check — decoding every entry at startup
            // would be slower than regenerating the rare bad one.
            if (v.src.startsWith('data:')) {
                if (!/^data:image\/(jpeg|png|gif);base64,[A-Za-z0-9+/=]{200,}$/.test(v.src)) continue;
            }
            fileThumbnailCache.set(path, v);
        }
    } catch (_) { /* corrupt or unavailable — start empty */ }
}

let _thumbSaveTimer = null;
function saveThumbCacheSoon() {
    if (_thumbSaveTimer) return;
    _thumbSaveTimer = setTimeout(() => {
        _thumbSaveTimer = null;
        try {
            const out = {};
            // Map preserves insertion order, so the tail is the most recent.
            const entries = [...fileThumbnailCache.entries()]
                .filter(([, v]) => v && v.kind === 'image' && v.src)
                .slice(-THUMB_CACHE_MAX);
            for (const [k, v] of entries) out[k] = v;
            localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(out));
        } catch (_) {
            // Over quota — drop the persisted copy rather than throwing.
            try { localStorage.removeItem(THUMB_CACHE_KEY); } catch (__) {}
        }
    }, 1500);
}

function cacheThumbResult(path, value) {
    const v = value || { kind: 'none', src: null };
    if (v.kind && v.kind !== 'none') {
        fileThumbnailCache.set(path, v);
        if (v.kind === 'image') saveThumbCacheSoon();
    }
    return v;
}

loadThumbCache();
// Tracks paths currently being fetched so we don't kick off duplicate IPCs.
const fileThumbnailPending = new Map();
// driveIds for which we've already set the main thumbnail (single-file drives).
// Prevents re-fetching the same thumbnail on every drive-data update.
const singleFileDriveThumbsLoaded = new Set();
// Same idea but for multi-file ("group") drives — first-file preview + count badge.
const groupDriveThumbsLoaded = new Set();

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
    if (initialized) return;
    initialized = true;

    // Initialize DriveActions with electronAPI
    driveActions = new DriveActions(window.electronAPI);

    // Initialize ScrollList with DriveItem factory
    scrollList = new ScrollList(listContainer, {
        emptyMessage: 'No transfers yet — drop files above or paste a link to start',
        gap: 8,
        padding: 12,
        keyField: 'id',
        itemFactory: (slot, data) => {
            const item = new DriveItem(slot, {
                data: data,
                show: getPresetForDrive(data),
                theme: 'dark',
                // Demo rows are UI scaffolding, not drives. Every menu action
                // would act on an id no backend has ever heard of — Rename
                // would write a permanent alias for a card that vanishes on
                // reload, Remove/Stop sharing would call IPC with a bogus id.
                // No kebab, no right-click, no long-press.
                showMenu: data.isDemo !== true
            });
            
            // Handle DriveItem actions via DriveActions module
            item.on('action', async (event) => {
                // ─── Demo rows short-circuit here ────────────────────
                // They have no drive behind them, so every action below
                // would reach IPC with an id the engine has never seen —
                // and `remove` deletes files for the id it is given.
                // Handle the two the interrupted card offers, drop the rest.
                if (event.data && event.data.isDemo) {
                    const demoId = event.data.id;
                    if (event.action === 'resume') {
                        updateDriveInList({ id: demoId, status: 'downloading', speed: 0 });
                        _demoRunProgress(demoId);
                    } else if (event.action === 'remove') {
                        const t = _demoTimers.get(demoId);
                        if (t) { clearInterval(t); _demoTimers.delete(demoId); }
                        removeDriveFromList(demoId, { animate: true });
                        showToast('Download cancelled');
                    }
                    return;
                }

                // ─── New Desktop v2 menu actions (Figma screen #18) ──
                // These live entirely in the renderer and don't hit
                // DriveActions / the backend. `properties` opens the new
                // canonical File Info modal (Figma screen #19).
                if (event.action === 'view-files') {
                    // Folder card "View files" -> folder contents modal
                    // (Figma screen #22). Desktop only; mobile still uses
                    // the inline expand.
                    const stored = drives.find(d => d.id === event.data.id);
                    window.openFolderModal?.({ ...(stored || {}), ...event.data });
                    return;
                }
                if (event.action === 'favorite') {
                    const nowFav = toggleFavorite(event.data.id);
                    updateDriveInList({ id: event.data.id, favorite: nowFav });
                    // Keep the slot's filter attribute in step, so a drive
                    // un-starred while the Favorites tab is open disappears
                    // from it immediately.
                    const slot = scrollList?._slots?.get(event.data.id)?.slot;
                    if (slot) slot.dataset.fav = nowFav ? 'true' : 'false';
                    reindexVisibleSlots();
                    showToast(nowFav ? 'Added to Favorites' : 'Removed from Favorites');
                    return;
                }
                if (event.action === 'copy-link') {
                    const link = event.data.shareLink
                        || drives.find(d => d.id === event.data.id)?.shareLink;
                    if (!link) return showToast('No share link yet', 'error');
                    try {
                        await navigator.clipboard.writeText(link);
                        showToast('Link copied');
                    } catch (_) {
                        showToast('Failed to copy', 'error');
                    }
                    return;
                }
                if (event.action === 'show-qr') {
                    const link = event.data.shareLink
                        || drives.find(d => d.id === event.data.id)?.shareLink;
                    if (!link) return showToast('No share link yet', 'error');
                    showShareModal(link);
                    return;
                }
                if (event.action === 'rename') {
                    // Stored drive FIRST so its originalTitle/alias survive —
                    // event.data is the item's own copy and may predate them.
                    const storedDrive = drives.find(d => d.id === event.data.id);
                    window.openRenameModal?.({ ...event.data, ...(storedDrive || {}) });
                    return;
                }
                if (event.action === 'properties') {
                    const storedDrive = drives.find(d => d.id === event.data.id);
                    // openInfoModal lives inside the desktop top-bar IIFE that
                    // runs later; it exposes itself on window at that time.
                    window.openInfoModal?.({ ...event.data, ...(storedDrive || {}) });
                    return;
                }

                // Handle more-info specially - show info panel
                if (event.action === 'more-info') {
                    const result = await driveActions.handle(event.action, event.data);
                    // Merge stored drive data with fetched info
                    const storedDrive = drives.find(d => d.id === event.data.id);
                    const fullData = {
                        ...event.data,
                        ...storedDrive,
                        ...(result.success ? result.drive : {})
                    };
                    showDriveInfo(fullData);
                    return;
                }
                
                console.log('[DEBUG] DriveActions - calling action:', event.action, 'for drive:', event.data.id);

                // Remove flow: start a 5s undo countdown. Backend isn't called
                // until the timer expires. Undo cancels the timer and restores
                // the drive UI — no rollback needed because nothing ran yet.
                // Retry on a "Files removed" row means FETCH IT AGAIN, not
                // resume. drives-resume reopens existing local storage, and
                // for this row that storage is exactly what is gone — it
                // would fail every time. The share link survives, so the
                // useful action is the normal download flow.
                // Rebuild a lost share from its source files.
                //
                // The Corestore is gone, so the old key and its peardrop://
                // link are dead for good — this creates a genuinely NEW share
                // from the same files, and says so rather than pretending the
                // old link came back.
                if (event.action === 'reshare') {
                    const d = drives.find(x => x.id === event.data.id) || event.data;
                    const files = (d.files || []).filter(f => f && f.path);
                    if (!files.length) {
                        showToast('No file paths recorded for this share', 'error');
                        return;
                    }

                    // Check before promising. The whole premise is that the
                    // files survived the Corestore; if they did not, say so
                    // instead of failing halfway through a rebuild.
                    let present = files;
                    try {
                        const exists = await window.electronAPI.filesExist(files.map(f => f.path));
                        present = files.filter(f => exists?.[f.path] !== false);
                    } catch (_) { /* check unavailable — attempt anyway */ }

                    if (!present.length) {
                        showToast('Those files are no longer on this computer', 'error');
                        return;
                    }
                    const missingCount = files.length - present.length;

                    showToast(missingCount
                        ? `Re-sharing ${present.length} of ${files.length} files…`
                        : 'Re-sharing…');
                    try {
                        const shareName = present.length === 1 ? present[0].name : 'Folder';
                        const result = await window.electronAPI.hyperdriveShare({
                            files: present.map(f => ({ name: f.name, size: f.size, path: f.path })),
                            options: { name: shareName }
                        });
                        if (!result?.success) {
                            showToast(result?.error || 'Could not re-share', 'error');
                            return;
                        }
                        // Only drop the dead row once the new share exists —
                        // a failure part-way through must not lose the record
                        // of what these files were.
                        await window.electronAPI.drivesRemove({
                            id: event.data.id, deleteFiles: false });
                        removeDriveFromList(event.data.id);

                        addDriveToList({
                            id: result.driveId,
                            title: shareName,
                            size: present.reduce((n, f) => n + (f.size || 0), 0),
                            fileCount: present.length,
                            files: present.map(f => ({ name: f.name, size: f.size, path: f.path })),
                            status: announcedDrives.has(result.driveId) ? 'sharing' : 'initiating',
                            peers: 0,
                            type: 'share',
                            shareLink: result.shareLink
                        }, { animate: true });
                        showToast('Shared again — this is a new link');
                    } catch (err) {
                        showToast('Could not re-share: ' + (err.message || 'unknown'), 'error');
                    }
                    return;
                }

                // Resume on an INTERRUPTED download continues the transfer.
                // drives-resume is the wrong call here: it reopens a drive for
                // seeding. What this row needs is the download loop re-entered,
                // which main resumes into the same files via resumePaths.
                if (event.action === 'resume' && event.data.status === 'interrupted') {
                    const link = event.data.shareLink
                        || drives.find(d => d.id === event.data.id)?.shareLink;
                    if (!link) {
                        showToast('No share link for this download', 'error');
                        return;
                    }
                    // Deliberately not pre-checking whether the peer is back:
                    // rejoining the swarm and waiting IS how you find out.
                    // Say what is happening so the row is not silently frozen.
                    updateDriveInList({ id: event.data.id, status: 'connecting', speed: 0 });
                    showToast('Reconnecting to sender…');
                    userStartedDownloads.add(event.data.id);
                    if (typeof handleDownload === 'function') handleDownload(event.data.id, link);
                    return;
                }

                if (event.action === 'resume' && event.data.status === 'missing') {
                    const link = event.data.shareLink
                        || drives.find(d => d.id === event.data.id)?.shareLink;
                    if (!link) {
                        showToast('No share link — this drive cannot be recovered', 'error');
                        return;
                    }
                    // Drop the dead row first: startDownload creates a fresh
                    // one, and leaving this would show the file twice.
                    removeDriveFromList(event.data.id);
                    if (linkInput) linkInput.value = link;
                    showToast('Downloading again…');
                    if (typeof startDownload === 'function') startDownload();
                    return;
                }

                if (event.action === 'remove') {
                    const d = event.data;
                    const pct = d.progress != null ? Math.round(d.progress * 100) : null;
                    // The X on a transferring row emits 'remove' too, but
                    // "cancel this transfer" and "remove a finished item"
                    // are different questions and deserve different wording.
                    // 'interrupted' belongs here: the X on a dropped download
                    // means "cancel this transfer and discard the partials",
                    // not "remove a finished item from the list". Without it
                    // the X ran the 5s undo-remove flow instead, which asks a
                    // different question and leaves the download registered.
                    const inFlight = d.status === 'downloading'
                        || d.status === 'connecting'
                        || d.status === 'interrupted'
                        || (d.status === 'sharing' && pct != null && pct < 100);

                    if (inFlight) {
                        const isDown = d.status !== 'sharing';
                        // CANCELLING IS NOT REMOVING. One plain question, no
                        // checkbox and no undo window — those belong to
                        // removing an item that is already sitting in the
                        // list. Cancelling acts immediately.
                        showConfirm({
                            title: isDown ? 'Cancel this download?' : 'Cancel this share?',
                            message: (d.title || 'This transfer')
                                + (pct != null ? ` — currently at ${pct}%` : ''),
                            buttons: [
                                { label: isDown ? 'Keep downloading' : 'Keep sharing', class: 'secondary' },
                                { label: 'Cancel transfer', class: 'danger', action: async () => {
                                    // Freeze the UI immediately — the backend
                                    // takes a moment to unwind, and a bar
                                    // still climbing after you pressed Cancel
                                    // reads as the button having done nothing.
                                    cancellingDrives.add(d.id);
                                    showCancellingOverlay(d.id);

                                    // STOP THE TRANSFER FIRST. Removing the
                                    // drive entry does not interrupt the
                                    // download loop — without this the file
                                    // carried on and finished anyway.
                                    if (isDown) {
                                        await window.electronAPI.hyperdriveDownloadCancel?.(d.id);
                                    } else {
                                        await window.electronAPI.hyperdriveShareCancel?.(d.id);
                                    }
                                    // For a DOWNLOAD, main owns the rest:
                                    // it stops the loop, deletes the files,
                                    // removes the entry and emits
                                    // 'drives-updated { removed }' which
                                    // takes the row out. Calling remove from
                                    // here as well tore the drive storage out
                                    // from under the running loop, which made
                                    // it fail in a way that skipped cleanup
                                    // entirely — the file then survived.
                                    if (!isDown) {
                                        const result = await driveActions.handle('remove', d, { deleteFiles: false });
                                        if (!result.success && result.error) {
                                            clearCancellingOverlay(d.id);
                                            showToast('Cancel failed: ' + result.error, 'error');
                                            return;
                                        }
                                    }
                                    showToast(isDown ? 'Download cancelled' : 'Share cancelled');
                                } }
                            ]
                        });
                        return;
                    }

                    // `type` alone is not dependable here: the drive-item
                    // library defaults it to 'download' when absent, and a
                    // restored drive carries `isUpload` instead. Check every
                    // signal so the checkbox can't silently disappear.
                    const isDownload = d.type === 'download'
                        || d.isUpload === false
                        || !!d.localPath;
                    showConfirm({
                        title: 'Remove from list?',
                        message: event.data.title || 'This share',
                        // Only downloads have a local file worth offering to
                        // delete; a share's file belongs to the user and
                        // lives wherever they picked it from.
                        checkbox: isDownload ? {
                            label: 'Also delete the downloaded file',
                            sub: 'Permanently removes it from your downloads folder.',
                            checked: false
                        } : null,
                        buttons: [
                            { label: 'Cancel', class: 'secondary' },
                            { label: 'Remove', class: 'danger', action: ({ checked }) => {
                                startRemoveCountdown(event.data, checked);
                            } }
                        ]
                    });
                    return;
                }

                const result = await driveActions.handle(event.action, event.data);

                console.log('[DEBUG] DriveActions - result:', {
                    action: event.action,
                    driveId: event.data.id,
                    success: result.success,
                    error: result.error
                });

                // Update UI based on action result
                if (result.success) {
                    if (event.action === 'pause') {
                        // Stopped seeding: it is no longer announced, and a
                        // pending watchdog must not later mark it unreachable.
                        announcedDrives.delete(event.data.id);
                        clearInitiatingWatchdog(event.data.id);
                        updateDriveInList({ id: event.data.id, status: 'inactive' });
                    } else if (event.action === 'resume') {
                        // Reaching here means RESUME SEEDING, for either
                        // direction. drives-resume re-opens the Corestore,
                        // rejoins the swarm and re-announces — it never
                        // starts a transfer, so "downloading" would describe
                        // an operation that did not happen.
                        //
                        // This used to branch on `type === 'share'` and send
                        // everything else to 'downloading'. But `type`
                        // records where a file CAME FROM, not what the drive
                        // is doing: a completed download stays type
                        // 'download' forever, so every re-seeded download was
                        // labelled "Downloading" — with a cancel X offering
                        // to stop a transfer that did not exist.
                        //
                        // The genuinely-unfinished case never gets here: it
                        // is caught earlier by the `status === 'interrupted'`
                        // branch, which calls handleDownload and correctly
                        // says downloading. By this point the drive has its
                        // files, and seeding is the only thing resume means.
                        announcedDrives.delete(event.data.id);
                        updateDriveInList({ id: event.data.id, status: 'initiating' });
                        armInitiatingWatchdog(event.data.id);
                    }
                }
            });
            // Single-file drive click → open the file directly (matches the
            // per-file click behavior in the multi-file expanded list).
            item.on('click', async (data) => {
                log('Drive clicked:', data.id);
                const file = Array.isArray(data.files) && data.files.length === 1
                    ? data.files[0]
                    : null;
                if (!file || !file.path) return;
                try {
                    const result = await window.electronAPI.openFile(file.path);
                    if (!result || result.success === false) {
                        // `missing` means the file is gone from disk, which
                        // deserves plainer wording than a generic failure.
                        showToast(result?.missing
                            ? 'That file was removed from your disk'
                            : (result?.error || 'Could not open file'), 'error');
                        // Free, authoritative signal: the OS just told us the
                        // file is gone. Re-check the affected drives rather
                        // than leaving a card claiming to share something it
                        // cannot open.
                        if (result?.missing) reconcileMissingFiles();
                    }
                } catch (err) {
                    showToast('Could not open file: ' + err.message, 'error');
                }
            });

            // Open a specific file from the expanded child list
            item.on('fileClick', async ({ file }) => {
                if (!file || !file.path) {
                    showToast('No local path for this file yet', 'error');
                    return;
                }
                try {
                    const result = await window.electronAPI.openFile(file.path);
                    if (!result || result.success === false) {
                        // `missing` means the file is gone from disk, which
                        // deserves plainer wording than a generic failure.
                        showToast(result?.missing
                            ? 'That file was removed from your disk'
                            : (result?.error || 'Could not open file'), 'error');
                        // Free, authoritative signal: the OS just told us the
                        // file is gone. Re-check the affected drives rather
                        // than leaving a card claiming to share something it
                        // cannot open.
                        if (result?.missing) reconcileMissingFiles();
                    }
                } catch (err) {
                    showToast('Could not open file: ' + err.message, 'error');
                }
            });

            // Lazy thumbnail loading on expand
            item.on('expand', ({ expanded, data: driveData }) => {
                if (!expanded) return;
                loadFileThumbnails(driveData.id);
            });
            
            driveItems.set(data.id, item);
            return item;
        }
    });

    // Bind UI events
    bindDropZone();
    bindButtons();
    bindInput();
    bindQrUpload();
    bindModals();
    bindIPC();
    bindScrollListEvents();

    // One-time "share history was reset" notice — see HTML modal + IPC handler.
    // Safe to remove this call (and the function) once the notice is retired.
    showResetNoticeIfNeeded();

    // Initialize sort UI
    updateSortUI();

    // Wire the list search box (was decorative — no JS referenced it).
    bindListSearch();

    // Load existing drives
    loadDrives();

}

/**
 * Get visibility preset based on drive state and view mode
 */
function getPresetForDrive(drive) {
    // Determine base preset type
    if (drive.progress != null && drive.progress < 1) {
        // Active download
        return isExpandedView ? 'download' : 'downloadCompact';
    } else if (drive.type === 'upload' || drive.type === 'share' || drive.status === 'sharing') {
        // Share/upload
        return isExpandedView ? 'share' : 'shareCompact';
    } else {
        // Complete/inactive
        return isExpandedView ? 'all' : 'compact';
    }
}

// ============================================================================
// DROP ZONE
// ============================================================================

function bindDropZone() {
    dropZone.addEventListener('click', selectFiles);
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);
    clearBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        clearFiles();
    });
}

function selectFiles({ force = false } = {}) {
    // `force` is used by the Send modal's Add Files card, where re-opening
    // the picker to add more files is the whole point. The drop-zone still
    // gets the original guard.
    if (!force && filePreview.classList.contains('active')) return;
    
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(Array.from(e.target.files));
        }
    });
    input.click();
}

function handleDragOver(e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
        handleFiles(files);
    }
}

async function handleFiles(files) {
    if (!files || files.length === 0) return;
    
    const paths = files.map(f => f.path).filter(Boolean);
    if (paths.length === 0) return;
    
    try {
        // Use backend to get proper stats
        const stats = await window.electronAPI.getFilesStats(paths);
        
        activeFiles = stats.map(s => ({
            name: s.name,
            size: s.size,
            path: s.path,
            type: s.type,
            fileCount: s.fileCount,
            contents: s.contents
        }));
        
        updateDropZone();
    } catch (err) {
        console.error('Error getting file stats:', err);
        showToast('Error reading files', 'error');
    }
}

function updateDropZone() {
    // Every path that mutates activeFiles ends here, so this is the single
    // honest place to announce the change. The Send modal listens instead
    // of polling — a native file dialog can stay open far longer than any
    // poll window.
    queueMicrotask(() => document.dispatchEvent(
        new CustomEvent('activefiles-changed', { detail: { count: activeFiles.length } })));

    if (activeFiles.length === 0) {
        dropContent.classList.remove('hidden');
        filePreview.classList.remove('active');
        dropZone.classList.remove('has-files');
        shareBtn.disabled = true;
        shareBtn.classList.remove('is-ready');
    } else {
        dropContent.classList.add('hidden');
        filePreview.classList.add('active');
        dropZone.classList.add('has-files');
        shareBtn.disabled = false;
        shareBtn.classList.add('is-ready');
        
        const file = activeFiles[0];
        fileIcon.textContent = getFileIcon(file.name);
        fileName.textContent = activeFiles.length > 1 
            ? `${activeFiles.length} items` 
            : file.name;
        
        const totalSize = activeFiles.reduce((sum, f) => sum + (f.size || 0), 0);
        fileSize.textContent = formatFileSize(totalSize);
    }
}

function clearFiles() {
    activeFiles = [];
    currentShareLink = null;
    currentDriveId = null;
    updateDropZone();
}

// ============================================================================
// BUTTONS & INPUT
// ============================================================================

function bindButtons() {
    shareBtn.addEventListener('click', startShare);
    downloadBtn.addEventListener('click', startDownload);

    // Desktop Share page renders a second SHARE button inside the drop
    // zone (.drop-zone-share-btn). Both buttons drive the same flow, so
    // route its clicks to startShare too — and mirror state changes from
    // the primary #shareBtn so disabled / label / glow stay in sync.
    const dropZoneShareBtn = document.getElementById('dropZoneShareBtn');
    if (dropZoneShareBtn) {
        dropZoneShareBtn.addEventListener('click', startShare);
        const syncShareButtons = () => {
            dropZoneShareBtn.disabled = shareBtn.disabled;
            dropZoneShareBtn.textContent = shareBtn.textContent;
            dropZoneShareBtn.classList.toggle('is-ready', shareBtn.classList.contains('is-ready'));
        };
        new MutationObserver(syncShareButtons).observe(shareBtn, {
            attributes: true,
            attributeFilter: ['disabled', 'class'],
            childList: true,
            characterData: true,
            subtree: true
        });
        syncShareButtons(); // initial state pull
    }

    // Same pattern for the desktop Receive in-panel DOWNLOAD button.
    const linkInputDownloadBtn = document.getElementById('linkInputDownloadBtn');
    if (linkInputDownloadBtn) {
        linkInputDownloadBtn.addEventListener('click', startDownload);
        const syncDownloadButtons = () => {
            linkInputDownloadBtn.disabled = downloadBtn.disabled;
            linkInputDownloadBtn.textContent = downloadBtn.textContent;
        };
        new MutationObserver(syncDownloadButtons).observe(downloadBtn, {
            attributes: true,
            attributeFilter: ['disabled'],
            childList: true,
            characterData: true,
            subtree: true
        });
        syncDownloadButtons();
    }
}

function bindInput() {
    linkInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            startDownload();
        }
    });

    // Mirror the SHARE-when-no-files pattern: DOWNLOAD is disabled while
    // the link input is empty (mobile + desktop). Programmatic value
    // changes (e.g. handleScannedLink) must also call updateDownloadButtonState.
    linkInput.addEventListener('input', updateDownloadButtonState);

    // Auto-detect pasted links
    linkInput.addEventListener('paste', () => {
        setTimeout(() => {
            updateDownloadButtonState();
            const val = linkInput.value.trim();
            if (val.startsWith('peardrop://')) {
                // Visual feedback
                linkInput.style.borderColor = 'rgba(168, 206, 56, 0.5)';
                setTimeout(() => {
                    linkInput.style.borderColor = '';
                }, 500);
            }
        }, 50);
    });

    // Set initial state — input starts empty so button starts disabled.
    updateDownloadButtonState();
}

// Disables #downloadBtn while the link input is empty (after trim). The
// in-panel #linkInputDownloadBtn mirrors disabled via the MutationObserver
// in bindButtons, so this single call covers both layouts.
function updateDownloadButtonState() {
    if (!downloadBtn || !linkInput) return;
    downloadBtn.disabled = linkInput.value.trim().length === 0;
}

function bindQrUpload() {
    qrUploadBtn.addEventListener('click', () => {
        window.openQrScanner({ onResult: handleScannedLink });
    });
}

function handleScannedLink(text) {
    if (!text.startsWith('peardrop://')) {
        showToast('QR doesn\'t contain a PearDrop link', 'error');
        return;
    }
    linkInput.value = text;
    updateDownloadButtonState();
    linkInput.classList.add('flash');
    setTimeout(() => linkInput.classList.remove('flash'), 500);
    showToast('Link captured', 'success');
    //startDownload(); // a plan for later on
}

async function startShare() {
    if (activeFiles.length === 0) return;

    shareBtn.disabled = true;
    shareBtn.classList.remove('is-ready');
    shareBtn.textContent = 'SHARING...';
    
    // Show build progress — in the Send modal if it's open, otherwise as
    // the bottom-right pill. Totals come from activeFiles, which already
    // carry per-file sizes.
    window.shareProgress?.begin(activeFiles);

    try {
        // Must pass { files: [...], options: {} } - not just paths!
        const shareName = activeFiles.length === 1 
            ? activeFiles[0].name 
            : 'Folder';   // placeholder; see note in hyperdrive-manager.createDrive
        
        const result = await window.electronAPI.hyperdriveShare({
            files: activeFiles,
            options: { name: shareName }
        });
        
        if (result.success) {
            currentShareLink = result.shareLink;
            currentDriveId = result.driveId;
            // Build finished — tear down progress, close Send, hand over to
            // the Share Link modal. Same 760x520 shell, so this reads as a
            // content swap rather than a second window.
            window.shareProgress?.finish();
            showShareModal(result.shareLink);
            
            // Add to list but park it invisibly — the share-link modal is on
            // top, so the user shouldn't see the new item peeking through the
            // modal's backdrop blur. deferAnimation pre-collapses the slot;
            // closeShareModal() will play the entrance once the modal is gone.
            pendingShareAnimationId = result.driveId;
            addDriveToList({
                id: result.driveId,
                title: shareName,
                size: activeFiles.reduce((sum, f) => sum + (f.size || 0), 0),
                fileCount: activeFiles.length,
                files: activeFiles.map(f => ({ name: f.name, size: f.size, path: f.path })),
                // Not 'sharing' yet: the drive exists but its DHT announce
                // has not landed, so the link works for nobody. markAnnounced
                // promotes it; the watchdog fails it if it never arrives.
                status: announcedDrives.has(result.driveId) ? 'sharing' : 'initiating',
                peers: 0,
                type: 'share',
                shareLink: result.shareLink
            }, { deferAnimation: true });
            
            // Clear drop zone after successful share
            clearFiles();
        } else if (result.cancelled) {
            // User pressed Cancel — expected, not a failure.
            window.shareProgress?.fail(null);
            showToast('Share cancelled', 'info');
        } else {
            window.shareProgress?.fail(result.error || 'Share failed');
            showToast(result.error || 'Share failed', 'error');
        }
    } catch (err) {
        console.error('Share error:', err);
        window.shareProgress?.fail(err.message);
        showToast('Share failed: ' + err.message, 'error');
    } finally {
        shareBtn.textContent = 'SHARE';
        // Re-enable only if files remain. After a successful share,
        // clearFiles() drains activeFiles → button stays disabled until the
        // user picks more files. After a failed share, files are still here
        // so the user can retry.
        const hasFiles = activeFiles.length > 0;
        shareBtn.disabled = !hasFiles;
        shareBtn.classList.toggle('is-ready', hasFiles);
    }
}

async function startDownload() {
    const rawInput = linkInput.value.trim();

    // Nothing pasted? Flash + focus, no toast (silent for empty input).
    if (!rawInput) {
        linkInput.classList.add('flash');
        linkInput.focus();
        setTimeout(() => linkInput.classList.remove('flash'), 500);
        return;
    }

    // Extract a clean `peardrop://<64 hex>` link from the pasted text —
    // guards against the common case of copying multi-line CLI output
    // ("LINK: peardrop://…\nID: drive_…") into the input, which used to
    // sneak past `startsWith('peardrop://')` and blow up in the engine
    // with a silent "Invalid share link" that showed the user nothing.
    const match = rawInput.match(/peardrop:\/\/[a-f0-9]{64}/i);
    const link = match ? match[0] : null;

    if (!link) {
        linkInput.classList.add('flash');
        setTimeout(() => linkInput.classList.remove('flash'), 500);
        if (rawInput.toLowerCase().startsWith('peardrop://')) {
            showToast('Invalid link — the key after peardrop:// must be exactly 64 hex characters.', 'error');
        } else {
            showToast('Not a peardrop:// link. Paste the full link starting with peardrop://', 'error');
        }
        return;
    }

    // If the input had junk but we recovered a link, tell the user we
    // salvaged it — helps them realize they pasted extra text next time.
    if (link !== rawInput) {
        console.log('[PearDrop] Extracted link from polluted input:', link);
    }

    linkInput.value = '';

    // 1. Check for duplicate (fast local check). Wrap in try/catch — a
    //    thrown IPC error here would otherwise be silently lost to the
    //    Promise rejection with no user feedback.
    let dupCheck;
    try {
        dupCheck = await window.electronAPI.hyperdriveCheckDuplicate({ shareLink: link });
    } catch (err) {
        console.error('[PearDrop] Duplicate check failed:', err);
        showToast('Could not start download: ' + (err.message || 'engine error'), 'error');
        return;
    }
    
    // Re-downloading a link already in the list is refused: point at the row
    // that already exists instead. Also covers pasting your OWN share link,
    // which otherwise opens a second receiver session against a key this app
    // is already seeding.
    //
    // decideDupCheckAction() in lib/dup-check-action.js models the nicer
    // "Show in list" / "Download again" confirm, and remains unused.
    if (dupCheck.isDuplicate) {
        highlightExistingDrive(dupCheck.driveId);
        showAlreadyDownloadedMessage('Already downloaded');
        return;
    }
    
    // 2. Not a duplicate - add to list immediately (animate — fresh download)
    const tempId = `dl_${Date.now()}`;
    console.log('[PearDrop] Adding to list:', tempId);
    addDriveToList({
        id: tempId,
        title: 'Connecting...',
        status: 'connecting',
        progress: 0,
        peers: 0,
        type: 'download',
        shareLink: link
    }, { animate: true });
    console.log('[PearDrop] Added to list, driveItems size:', driveItems.size);
    
    // 3. Open drive (skip duplicate check since we already did it)
    let openResult;
    try {
        openResult = await window.electronAPI.hyperdriveOpen({ shareLink: link, forceOpen: true });
    } catch (err) {
        console.error('[PearDrop] hyperdriveOpen threw:', err);
        openResult = { success: false, error: err.message || 'engine error' };
    }

    if (!openResult.success) {
        updateDriveInList({ id: tempId, status: 'error' });
        // Surface the engine's actual reason to the user. Was silently
        // swallowed before — the row briefly appeared as "Connecting…",
        // auto-removed after 5s, and the user had no idea why.
        showToast('Download failed: ' + (openResult.error || 'unknown error'), 'error');
        setTimeout(() => removeDriveFromList(tempId, { animate: true }), 5000);
        return;
    }
    
    const driveId = openResult.driveId;
    const hasPeer = openResult.peerConnected === true;
    const hasData = openResult.shareName && openResult.files?.length > 0;
    
    // No peer and no data - stay in connecting state
    if (!hasPeer && !hasData) {
        console.log('[PearDrop] No peer connected, staying in connecting state');
        // Just update the tempId to use real driveId, keep status as connecting
        updateDriveInList({ 
            id: tempId, 
            title: 'Waiting for peer...',
            status: 'connecting'
        });
        // TODO: Could set up a retry/listen mechanism here
        return;
    }
    
    // Have peer or data - proceed with download
    removeDriveFromList(tempId);
    
    addDriveToList({
        id: driveId,
        title: displayTitle(openResult.shareName || 'Download', openResult.files?.length || 1, driveId),
        originalTitle: baseTitle(openResult.shareName || 'Download', openResult.files?.length || 1),
        alias: getAlias(driveId),
        size: openResult.totalBytes || 0,
        fileCount: openResult.files?.length || 1,
        files: (openResult.files || []).map(f => ({ name: f.name, size: f.size })),
        status: 'downloading',
        progress: 0,
        peers: hasPeer ? 1 : 0,
        type: 'download',
        shareLink: link
    });
    
    userStartedDownloads.add(driveId);
    handleDownload(driveId, link);
}

// Highlight an existing drive in the list and scroll to it
function highlightExistingDrive(driveId) {
    // scroll-list uses data-id attribute
    const driveEl = document.querySelector(`[data-id="${driveId}"]`);
    console.log('[PearDrop] Highlighting drive:', driveId, 'found:', !!driveEl);
    if (driveEl) {
        // Scroll into view
        driveEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Add highlight class
        driveEl.classList.add('highlight-pulse');
        setTimeout(() => driveEl.classList.remove('highlight-pulse'), 2000);
    }
}

// Show "already downloaded" message above the download bar
function showAlreadyDownloadedMessage(message) {
    console.log('[PearDrop] Showing message:', message);
    
    // Remove any existing message
    const existing = document.querySelector('.already-downloaded-msg');
    if (existing) existing.remove();
    
    // Create message element
    const msgEl = document.createElement('div');
    msgEl.className = 'already-downloaded-msg';
    msgEl.textContent = message;
    
    // Insert above the link input container
    const inputContainer = document.querySelector('.link-input-container');
    if (inputContainer) {
        inputContainer.parentElement.insertBefore(msgEl, inputContainer);
    } else {
        // Fallback: insert at top of main content
        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.prepend(msgEl);
    }
    
    // Fade out and remove after 3 seconds
    setTimeout(() => {
        msgEl.classList.add('fade-out');
        setTimeout(() => msgEl.remove(), 500);
    }, 3000);
    
    // Also remove on input focus
    linkInput.addEventListener('focus', () => msgEl.remove(), { once: true });
}

// Background download handler
// Drives with a download request already in flight from THIS renderer.
// main holds the authoritative guard; this one stops the redundant IPC and,
// more importantly, the status writes that came with it — those were what
// made the card flicker as two callers fought over it.
const downloadsInFlight = new Set();

// Drives the USER asked to download in this session — a fresh paste, or the
// Resume button. Consulted by 'drive-ready-to-download' to decide whether a
// reconnect may continue on its own.
//
// This replaced a wall-clock test (`Date.now() - APP_START_AT < 20000`) that
// tried to infer the same thing. That was a race the app kept losing: DHT
// lookup plus peer connect regularly takes longer than 20s, so a slow resume
// fell the wrong side of the window and auto-started a download nobody asked
// for. Intent is a fact we already hold; it does not need to be guessed from
// a clock.
const userStartedDownloads = new Set();

async function handleDownload(driveId, link) {
    if (downloadsInFlight.has(driveId)) {
        console.warn('[PearDrop] Download already starting for', driveId, '- ignoring duplicate');
        return;
    }
    downloadsInFlight.add(driveId);
    try {
        const downloadResult = await window.electronAPI.hyperdriveDownload({ driveId });

        // A duplicate that slipped past the local guard: leave the card
        // alone entirely — the run that is actually going owns it.
        if (downloadResult && downloadResult.alreadyRunning) return;

        // The drive is connected but hasn't sent its file list yet. That is a
        // wait, not a failure — painting the card red here would be wrong, and
        // the swarm stays joined, so the engine will emit ready-to-download
        // once the manifest actually arrives.
        if (downloadResult && downloadResult.notReady) {
            updateDriveInList({ id: driveId, status: 'connecting', speed: 0 });
            return;
        }

        if (downloadResult.success) {
            // Provisional. The authoritative state arrives with the
            // 'files-downloaded' event, which knows whether seeding began.
            updateDriveInList({ id: driveId, status: 'complete', progress: 1 });
        } else {
            updateDriveInList({ id: driveId, status: 'error' });
            // Surface WHY. A silent red row left people guessing whether the
            // sender vanished or something was wrong with the link.
            if (downloadResult.error && !downloadResult.cancelled) {
                showToast(downloadResult.error, 'error');
            }
        }
    } catch (err) {
        console.error('Download error:', err);
        updateDriveInList({ id: driveId, status: 'error' });
    } finally {
        downloadsInFlight.delete(driveId);
    }
}

// ============================================================================
// MODALS
// ============================================================================

function bindModals() {
    copyLinkBtn.addEventListener('click', copyShareLink);
    closeShareBtn.addEventListener('click', closeShareModal);

    // Close on backdrop click
    shareModal.addEventListener('click', (e) => {
        if (e.target === shareModal) closeShareModal();
    });
}

// One-time "share history was reset" notice.
//
// Gating logic:
//   1. If user already dismissed (SEEN_FLAG) → skip.
//   2. If lastSeenVersion is tracked → show only when the user has crossed
//      the fix boundary (lastSeen < FIX_VERSION ≤ current).
//   3. If lastSeenVersion is missing (first launch on this build) → use
//      legacy-data presence as a tiebreaker: fresh install → no notice;
//      old data on disk → notice.
//
// FIX_VERSION = the first build that contained the persistence fix.
// Bump it forward only if a future fix produces a new one-time notice.
//
// Safe to retire by removing this function, its call site, the modal
// HTML/CSS, the preload bridges, and the matching IPC handlers.
async function showResetNoticeIfNeeded() {
    const SEEN_FLAG = 'peardrop:resetNoticeSeen';
    const VERSION_KEY = 'peardrop:lastSeenVersion';
    const FIX_VERSION = '0.19.1';

    if (localStorage.getItem(SEEN_FLAG) === '1') return;

    let currentVersion = null;
    try {
        currentVersion = await window.electronAPI.getAppVersion();
    } catch {
        return; // can't reach main — bail silently
    }
    if (!currentVersion) return;

    const lastSeen = localStorage.getItem(VERSION_KEY);
    let shouldShow = false;

    if (lastSeen) {
        // We know which version they ran last. Show only on first launch
        // of a build that includes the fix, when the previous build didn't.
        shouldShow = semverLt(lastSeen, FIX_VERSION) && !semverLt(currentVersion, FIX_VERSION);
    } else {
        // No tracked version yet — could be either a true fresh install or
        // a first launch after upgrading from a pre-tracking build. Use the
        // legacy state files as a tiebreaker.
        try {
            const { present } = await window.electronAPI.checkLegacyDataPresent();
            shouldShow = present && !semverLt(currentVersion, FIX_VERSION);
        } catch {
            shouldShow = false;
        }
    }

    // Always record the current version so we never re-check this case again
    localStorage.setItem(VERSION_KEY, currentVersion);

    if (!shouldShow) {
        localStorage.setItem(SEEN_FLAG, '1');
        return;
    }

    const modal = document.getElementById('resetNoticeModal');
    const okBtn = document.getElementById('resetNoticeOkBtn');
    if (!modal || !okBtn) return;

    const dismiss = () => {
        modal.classList.remove('active');
        localStorage.setItem(SEEN_FLAG, '1');
    };
    okBtn.addEventListener('click', dismiss, { once: true });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) dismiss();
    }, { once: true });

    modal.classList.add('active');
}

// Tiny semver "less-than" comparison for MAJOR.MINOR.PATCH strings.
// Only used by showResetNoticeIfNeeded — remove when the notice is retired.
function semverLt(a, b) {
    const aa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const bb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const av = aa[i] || 0;
        const bv = bb[i] || 0;
        if (av < bv) return true;
        if (av > bv) return false;
    }
    return false;
}

// QR codes are a pure function of the link: the same link always encodes to
// the same image, and a drive's link never changes. So this can be cached
// with no staleness risk. Kept in memory only — generation itself measures
// ~3ms, so persisting it to disk would trade real storage for nothing. The
// delay users actually see is the IPC round-trip waiting on a busy main
// process, which a cache only helps on the SECOND open.
const qrCache = new Map();

async function showShareModal(link) {
    shareLinkDisplay.textContent = link;
    shareModal.classList.add('active');

    const qrCanvas = document.getElementById('shareQrCode');
    const qrSlot   = document.getElementById('shareQrSlot');

    const paint = (dataUrl) => {
        const img = new Image();
        img.onload = () => {
            const ctx = qrCanvas.getContext('2d');
            ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
            ctx.drawImage(img, 0, 0, qrCanvas.width, qrCanvas.height);
            qrSlot?.classList.add('is-ready');
        };
        img.src = dataUrl;
    };

    // Cache hit — paint immediately, never show the spinner.
    const cached = qrCache.get(link);
    if (cached) {
        paint(cached);
        return;
    }

    // Miss — the slot keeps its size either way, so the modal never changes
    // height. But generation is ~3ms on an idle app, and a spinner that
    // appears and vanishes within a couple of frames reads as a glitch. Hold
    // it back for 180ms: fast paths show nothing at all, and it only appears
    // when there is a real wait (main process busy resuming drives, etc).
    qrSlot?.classList.remove('is-ready');
    qrSlot?.classList.add('is-pending');
    const spinnerTimer = setTimeout(() => qrSlot?.classList.remove('is-pending'), 180);
    try {
        const dataUrl = await window.electronAPI.generateQr(link);
        clearTimeout(spinnerTimer);
        qrSlot?.classList.remove('is-pending');
        qrCache.set(link, dataUrl);
        // The user may have closed and reopened on a different link while
        // this was in flight; only paint if it's still the one on screen.
        if (shareLinkDisplay.textContent === link) paint(dataUrl);
    } catch (err) {
        clearTimeout(spinnerTimer);
        qrSlot?.classList.remove('is-pending');
        console.warn('[qr] generation failed:', err.message);
        // Leave the placeholder up rather than collapsing the layout.
    }
}

function closeShareModal() {
    shareModal.classList.remove('active');
    // Reset to the loading state for the next open. Was setting the canvas
    // to display:none, which is what removed its footprint and made the
    // modal jump on every open.
    document.getElementById('shareQrSlot')?.classList.remove('is-ready');

    // The new share was added silently behind this modal so updates could
    // route to it during the modal's lifetime. Animate it in now that the
    // user can actually see the list.
    if (pendingShareAnimationId) {
        const id = pendingShareAnimationId;
        pendingShareAnimationId = null;
        scrollList.animateSlotEntrance(id);
    }
}

async function copyShareLink() {
    const link = shareLinkDisplay.textContent;
    try {
        await navigator.clipboard.writeText(link);
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyLinkBtn.textContent = 'Copy';
        }, 1500);
    } catch (err) {
        showToast('Failed to copy', 'error');
    }
}

// ============================================================================
// DRIVE LIST MANAGEMENT
// ============================================================================

function addDriveToList(drive, options = {}) {
    console.log('[addDriveToList] called with:', drive.id, drive.title, drive.status);

    // Check if already exists
    if (driveItems.has(drive.id)) {
        console.log('[addDriveToList] already exists, updating');
        updateDriveInList(drive);
        return;
    }

    // Alias resolution happens HERE, not at each call site. Only four of the
    // seven callers go through normalizeDrive; the rest build a card by hand
    // (fresh share, fresh download, the temporary "Connecting…" row), and
    // those would otherwise show the un-aliased name and give the Rename
    // modal no original to reset to. One choke point means a new call site
    // can't silently reintroduce either bug.
    if (drive.originalTitle == null) drive.originalTitle = drive.title;
    const existingAlias = getAlias(drive.id);
    if (existingAlias) {
        drive.alias = existingAlias;
        drive.title = existingAlias;
    }

    // Add timestamp for sorting
    drive.addedAt = Date.now();

    // Always add to top of list first (newest at top)
    drives.unshift(drive);
    const result = scrollList.addItem(drive, {
        prepend: true,
        animate: options.animate === true,
        deferAnimation: options.deferAnimation === true
    });
    console.log('[addDriveToList] scrollList.addItem result:', result?.id, 'component:', !!result?.component);

    // Tag the slot with its drive type so the page-switch CSS filter can
    // show/hide it via .view-share / .view-receive on the list container.
    if (result && result.slot) {
        result.slot.dataset.type = drive.type === 'download' ? 'download' : 'share';
        // Same mechanism for the Favorites tab: CSS filters on this
        // attribute, so switching tabs never re-renders the list.
        result.slot.dataset.fav = isFavorite(drive.id) ? 'true' : 'false';
        // Demo rows are debug scaffolding and opt OUT of all three tab
        // filters. Without this a `peardrop.demo()` card is type=download and
        // simply doesn't appear while the Shares tab is selected (and never
        // appears under Favorites, since it isn't starred) — it looks like
        // the demo helper is broken when it is only being filtered.
        if (drive.isDemo) result.slot.dataset.demo = 'true';
        // Respect any active query: a row added while a search is running
        // must not appear just because it is new.
        result.slot.dataset.match =
            driveMatchesSearch(drive, listSearchQuery.trim().toLowerCase()) ? 'true' : 'false';
        // A card that mounts already 'initiating' needs the watchdog running,
        // or a share that never announces would sit there forever.
        if (drive.status === 'initiating' && !drive.isDemo) armInitiatingWatchdog(drive.id);
        reindexVisibleSlots();
    }

    // If we have a non-recent sort active, re-apply sorting
    // (but new items still briefly appear at top, then sort into place)
    if (sortField !== 'recent' && sortField !== 'custom') {
        setTimeout(() => applySorting(), 100);
    }

    // Replace the generic 📤/⬇️ emoji in the main thumb slot with something
    // useful: single-file → real preview, multi-file → first preview + count badge.
    // Fire-and-forget; falls back silently to the lib's emoji.
    loadSingleFileThumbnail(drive.id);
    loadGroupThumbnail(drive.id);
}

function updateDriveInList(drive) {
    const item = driveItems.get(drive.id);
    const idx = drives.findIndex(d => d.id === drive.id);
    const oldStatus = idx >= 0 ? drives[idx].status : null;
    
    // Merge update into stored drive data FIRST
    if (idx >= 0) {
        drives[idx] = { ...drives[idx], ...drive };
    }
    
    if (item) {
        item.update(drive);
        
        // Update preset based on FULL drive data (not just the update)
        const fullDrive = idx >= 0 ? drives[idx] : drive;
        const newPreset = getPresetForDrive(fullDrive);
        item.setVisibility(newPreset);
    }
    
    // An open folder modal is showing a snapshot of this drive — keep its
    // header honest rather than leaving it frozen at whatever it said when
    // it opened.
    window.syncFolderModalDrive?.(drive);

    // A rename changes what this row can be found by, so re-test it against
    // the active query instead of leaving a stale match flag.
    if (listSearchQuery && (drive.title !== undefined || drive.files !== undefined)) {
        const slot = scrollList?._slots?.get(drive.id)?.slot;
        if (slot) {
            const full = idx >= 0 ? drives[idx] : drive;
            slot.dataset.match =
                driveMatchesSearch(full, listSearchQuery.trim().toLowerCase()) ? 'true' : 'false';
            reindexVisibleSlots();
        }
    }

    // Re-sort if relevant field changed
    if (sortField === 'status' && drive.status && drive.status !== oldStatus) {
        applySorting();
    } else if (sortField === 'peers' && drive.peers !== undefined) {
        applySorting();
    }
}

// Active per-drive deletion countdowns. Map<driveId, { intervalId, overlay, slot }>.
// Used by startDeletionCountdown / cancelDeletionCountdown so an app close or
// repeat-remove can clean up cleanly.
const deletionTimers = new Map();

// Begin a 5-second undo window before actually deleting a drive. Inserts a
// circular countdown button (replacing the right-side menu visually) and dims
// the slot's content. If the user clicks the button → onUndo runs and the
// drive is restored (no backend call ever fired). If the timer expires →
// onExpire runs (this is when the real backend delete should happen).
function startDeletionCountdown(driveId, { onExpire, onUndo } = {}) {
    const totalSeconds = 5;
    const slotData = scrollList && scrollList._slots && scrollList._slots.get(driveId);
    if (!slotData || !slotData.slot) {
        // No slot to attach to — just fire the expire path immediately
        if (typeof onExpire === 'function') onExpire();
        return;
    }

    // Cancel any prior countdown on this drive
    if (deletionTimers.has(driveId)) {
        cancelDeletionCountdown(driveId);
    }

    const slot = slotData.slot;
    slot.classList.add('is-pending-delete');

    const overlay = document.createElement('div');
    overlay.className = 'drive-delete-countdown';
    overlay.innerHTML =
        '<div class="drive-undo-timer" aria-label="Time until delete">' +
            '<svg class="drive-undo-ring" viewBox="0 0 36 36" aria-hidden="true">' +
                '<circle class="drive-undo-ring-bg" cx="18" cy="18" r="15.9155"/>' +
                '<circle class="drive-undo-ring-fg" cx="18" cy="18" r="15.9155"/>' +
            '</svg>' +
            '<span class="drive-undo-label">' + totalSeconds + '</span>' +
        '</div>' +
        '<button class="drive-undo-btn" type="button" title="Cancel delete">Undo</button>';
    slot.appendChild(overlay);

    const undoBtn = overlay.querySelector('.drive-undo-btn');
    const ringFg = overlay.querySelector('.drive-undo-ring-fg');
    const label = overlay.querySelector('.drive-undo-label');

    // Kick off the ring drain across totalSeconds. Double-rAF so the browser
    // commits the initial (full ring) state before transitioning to empty.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            ringFg.style.transition = 'stroke-dashoffset ' + totalSeconds + 's linear';
            ringFg.style.strokeDashoffset = '100';
        });
    });

    let secondsLeft = totalSeconds;
    const intervalId = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) {
            label.textContent = secondsLeft;
        } else {
            clearInterval(intervalId);
            // Timer's done. Hide the circle entirely and let a bigger
            // "Deleting…" pill take over as the primary status indicator,
            // with the slot's content blurred behind it.
            overlay.classList.add('is-final');
            slot.classList.add('is-deleting-now');
            label.textContent = '';
            undoBtn.disabled = true;
            undoBtn.textContent = 'Deleting…';
            const entry = deletionTimers.get(driveId);
            if (entry) entry.expired = true;
            if (typeof onExpire === 'function') onExpire();
        }
    }, 1000);

    undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelDeletionCountdown(driveId);
        if (typeof onUndo === 'function') onUndo();
    });

    deletionTimers.set(driveId, { intervalId, overlay, slot, expired: false });
}

function cancelDeletionCountdown(driveId) {
    const entry = deletionTimers.get(driveId);
    if (!entry) return;
    clearInterval(entry.intervalId);
    if (entry.overlay && entry.overlay.parentNode) entry.overlay.remove();
    if (entry.slot) {
        entry.slot.classList.remove('is-pending-delete');
        entry.slot.classList.remove('is-deleting-now');
    }
    deletionTimers.delete(driveId);
}

// Show / hide a "Deleting…" overlay on a drive slot while the backend works.
// Backend removal can take a moment (close swarm, close drive, rm storage),
// so the user needs visible feedback that something is happening. The slot
// is dimmed underneath; the overlay sits above with a spinner + label.
function setDriveDeleting(driveId, isDeleting) {
    const slotData = scrollList && scrollList._slots && scrollList._slots.get(driveId);
    if (!slotData || !slotData.slot) return;
    const slot = slotData.slot;

    if (isDeleting) {
        slot.classList.add('is-deleting');
        if (!slot.querySelector('.drive-deleting-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'drive-deleting-overlay';
            overlay.innerHTML =
                '<span class="drive-deleting-spinner" aria-hidden="true"></span>' +
                '<span>Deleting…</span>';
            slot.appendChild(overlay);
        }
    } else {
        slot.classList.remove('is-deleting');
        const overlay = slot.querySelector('.drive-deleting-overlay');
        if (overlay) overlay.remove();
    }
}

function removeDriveFromList(driveId, options = {}) {
    console.log('[DEBUG] removeDriveFromList called:', {
        driveId,
        animate: options.animate === true,
        driveItemExists: driveItems.has(driveId),
        scrollListHasSlot: scrollList._slots?.has(driveId) || 'unknown',
        drivesArrayLength: drives.length,
        driveInArray: drives.some(d => d.id === driveId)
    });

    // The row is going for good, so the local-only things keyed to it —
    // its rename and its favorite star — go with it. Left behind they would
    // accumulate in localStorage forever and re-apply to any drive that
    // ever reused the id.
    forgetLocalDriveState(driveId);

    // Step 1: Remove from driveItems Map
    const hadDriveItem = driveItems.has(driveId);
    driveItems.delete(driveId);
    console.log('[DEBUG] After driveItems.delete():', {
        hadDriveItem,
        nowHas: driveItems.has(driveId)
    });

    // Step 2: Remove from ScrollList (animated if requested — the slot stays
    // in the DOM during the transition but is detached from internal tracking)
    const hadScrollListSlot = scrollList._slots?.has(driveId);
    console.log('[DEBUG] Before scrollList.removeItem():', {
        hadScrollListSlot,
        scrollListSlotCount: scrollList._slots?.size || 'unknown'
    });

    setTimeout(() => { try { reindexVisibleSlots(); } catch (_) {} }, 0);
    const scrollListResult = scrollList.removeItem(driveId, {
        animate: options.animate === true
    });
    console.log('[DEBUG] After scrollList.removeItem():', {
        result: scrollListResult,
        nowHasSlot: scrollList._slots?.has(driveId) || 'unknown',
        scrollListSlotCount: scrollList._slots?.size || 'unknown'
    });

    // Step 3: Remove from drives array
    const originalLength = drives.length;
    drives = drives.filter(d => d.id !== driveId);
    console.log('[DEBUG] After drives array filter:', {
        originalLength,
        newLength: drives.length,
        removed: originalLength - drives.length
    });
}

async function loadDrives() {
    try {
        const result = await window.electronAPI.drivesList();
        if (result.success && Array.isArray(result.drives)) {
            // Seed reachability BEFORE normalizing: a UI refresh clears this
            // renderer's Set, but the shares are still announced and main
            // still knows it. Without this every share re-paints as
            // "Initiating" on every reload and never gets a second
            // drive-announced event to correct it.
            if (Array.isArray(result.announced)) {
                for (const id of result.announced) announcedDrives.add(id);
            }
            for (const drive of result.drives) {
                addDriveToList(normalizeDrive(drive));
            }
            // Now that the cards exist, find out whether their content still
            // does. Deferred rather than awaited so the list paints first.
            reconcileMissingFiles();
        }
    } catch (err) {
        console.error('Error loading drives:', err);
    }
}

/**
 * Map an engine drive `state` onto a UI status.
 * @param {Object} drive - raw entry from the engine
 * @returns {string} one of the STATUS_CONFIG keys
 */
function deriveStatusFromState(drive) {
    const state = drive.state;
    const isDownload = drive.isUpload === false || drive.type === 'download';

    // 'paused' is an ENGINE state, not a UI one. The card shows it as
    // Inactive: from the user's side a stopped share and a share that
    // failed to come back are the same thing — it isn't running, and the
    // way to fix it is the same. One less state to explain.
    if (state === 'paused')  return 'inactive';
    if (state === 'errored') return 'error';

    if (isDownload) {
        // 'seeking' + isUpload:false is the engine's marker for a download
        // that STARTED AND NEVER FINISHED: openDrive writes it when the
        // transfer begins, and only main promotes it to 'active' once the
        // files have actually landed. That is precisely the interrupted
        // state, so say so — it was reported as 'inactive', which reads as
        // "stopped share" and offers Retry instead of Resume + cancel.
        // Bytes are already on disk here; Resume continues rather than
        // restarting.
        if (state === 'seeking') return 'interrupted';
        // Finished and now seeding it back to the network.
        if (state === 'active')  return 'sharing';
        return 'inactive';
    }

    // Uploads. 'active' in the manifest means "this drive should be seeding",
    // NOT "it is reachable right now" — the DHT announce lands seconds after
    // the drive opens. Start at 'initiating' and let the engine's
    // drive-announced event promote it, or the watchdog fail it.
    if (state !== 'active') return 'inactive';
    return announcedDrives.has(drive.id || drive.driveId) ? 'sharing' : 'initiating';
}

// ─── List search ────────────────────────────────────────────────────────
// Filters the drive list by name, applied the same way the tab filters are:
// an attribute on each slot plus one CSS rule. Nothing is re-rendered and no
// DOM is discarded, so scroll position, running progress bars and open
// thumbnails all survive typing — and a query composes with whichever tab is
// active rather than fighting it.
let listSearchQuery = '';

/**
 * What a row can be found by.
 *
 * Includes the ORIGINAL name as well as the displayed one: renaming a share
 * to "Holiday" must not hide it from a search for its real filename. A
 * rename is a label, not a disguise.
 *
 * Also includes the names of files INSIDE a folder share, so searching for
 * one file surfaces the folder holding it — otherwise a multi-file share is
 * only findable by the placeholder word "Folder", which every one of them
 * shares.
 */
function driveSearchHaystack(drive) {
    if (!drive) return '';
    const parts = [drive.title, drive.originalTitle];
    if (Array.isArray(drive.files)) {
        for (const f of drive.files) if (f && f.name) parts.push(f.name);
    }
    return parts.filter(Boolean).join(' | ').toLowerCase();
}

/**
 * Does one file name satisfy the query? Same every-term rule as the list.
 * Top-level so the list, the card's file count and the folder modal all
 * decide "does this file match" with one piece of code — three copies of
 * this rule would drift, and the count on the card would stop agreeing with
 * the rows behind it.
 */
function nameMatchesTerms(name, q) {
    if (!q) return true;
    const hay = String(name || '').toLowerCase();
    return q.split(/\s+/).filter(Boolean).every(term => hay.includes(term));
}

/** How many of a drive's files match. 0 when it has no file list. */
function countMatchingFiles(drive, q) {
    if (!drive || !Array.isArray(drive.files)) return 0;
    if (!q) return drive.files.length;
    return drive.files.filter(f => f && nameMatchesTerms(f.name, q)).length;
}

function driveMatchesSearch(drive, q) {
    if (!q) return true;
    const hay = driveSearchHaystack(drive);
    // Every whitespace-separated term must appear somewhere. "matrix 1080"
    // then finds "The.Matrix.1080p.mkv" regardless of word order, which is
    // how people actually half-remember a filename.
    return q.split(/\s+/).filter(Boolean).every(term => hay.includes(term));
}

function applyListSearch() {
    if (!listContainer || !scrollList || !scrollList._slots) return;
    const q = listSearchQuery.trim().toLowerCase();

    listContainer.classList.toggle('is-searching', !!q);
    const termEl = document.getElementById('searchEmptyTerm');
    if (termEl) termEl.textContent = q ? `“${listSearchQuery.trim()}”` : '';

    for (const [id, slotData] of scrollList._slots) {
        const slot = slotData && slotData.slot;
        if (!slot) continue;
        const drive = drives.find(d => d.id === id);
        slot.dataset.match = driveMatchesSearch(drive, q) ? 'true' : 'false';

        // Make the card's file count agree with what opening it will show.
        // Searching "sa" on a 2-file folder with one hit said "2 Files" next
        // to a single result — the card contradicting the folder behind it.
        //
        // DISPLAY ONLY: the true count stays in drives[] (and is always
        // recoverable from files.length), so nothing downstream ever reads
        // the filtered number.
        const item = driveItems.get(id);
        if (item && drive && Array.isArray(drive.files)) {
            const total = drive.files.length;
            const hits = q ? countMatchingFiles(drive, q) : total;
            // hits === 0 means the folder matched on its NAME, not its
            // contents — it opens showing everything, so show everything.
            const want = (q && hits > 0) ? hits : total;
            if (item.getData?.().fileCount !== want) item.update({ fileCount: want });
        }
    }
    // Visible-slot bookkeeping drives the two-column left/right striping,
    // so it has to run after rows appear or disappear.
    reindexVisibleSlots();
}

function bindListSearch() {
    const input = document.getElementById('listSearchInput');
    if (!input) return;
    input.addEventListener('input', () => {
        listSearchQuery = input.value;
        applyListSearch();
    });
    // Esc clears the query rather than blurring — recovering from a typo
    // should not cost the focus as well.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && input.value) {
            e.stopPropagation();
            input.value = '';
            listSearchQuery = '';
            applyListSearch();
        }
    });
}

// ─── Local file availability ────────────────────────────────────────────
// Does a drive's content still exist on disk?
//
// "Files removed" existed as a status for a long time but NOTHING ever set
// it from a file check — it was only ever produced by a Corestore resume
// failure, which is a different thing entirely (see statusForResumeError).
// So the app has never actually noticed a deleted file; it found out when
// the user clicked Open and Windows threw its own dialog.
//
// States deliberately skipped: anything mid-flight (its files are still
// being written), and 'lost' (already terminal, and its Corestore — not its
// files — is what went).
const FILE_CHECK_SKIP_STATUSES = new Set([
    'downloading', 'connecting', 'initiating', 'interrupted', 'lost', 'missing'
]);

async function reconcileMissingFiles() {
    if (!window.electronAPI?.filesExist) return;

    const candidates = drives.filter(d =>
        d && !d.isDemo
        && !FILE_CHECK_SKIP_STATUSES.has(d.status)
        && Array.isArray(d.files)
        && d.files.some(f => f && f.path));
    if (!candidates.length) return;

    // One IPC round trip for every path rather than one per drive.
    const paths = [];
    for (const d of candidates) {
        for (const f of d.files) if (f && f.path) paths.push(f.path);
    }

    let exists;
    try {
        exists = await window.electronAPI.filesExist([...new Set(paths)]);
    } catch (err) {
        console.warn('[PearDrop] File availability check failed:', err.message);
        return;
    }
    if (!exists) return;

    for (const d of candidates) {
        const own = d.files.filter(f => f && f.path);
        const goneCount = own.filter(f => exists[f.path] === false).length;
        if (goneCount === 0) continue;

        // ALL gone -> the card is about content that is not there any more.
        // SOME gone -> the drive still has something to offer, so the card
        // keeps its status; the folder modal is where per-file state belongs.
        if (goneCount === own.length) {
            console.warn('[PearDrop] All files gone for drive', d.id);
            updateDriveInList({ id: d.id, status: 'missing' });
        } else {
            console.warn('[PearDrop] Some files gone for drive', d.id,
                `(${goneCount}/${own.length})`);
        }
    }
}

// ─── Reachability (DHT announce) ────────────────────────────────────────
// Shares the engine has confirmed announced. A share is open locally well
// before it is findable, and the card used to claim "Active" for that whole
// gap — up to 11s in practice.
const announcedDrives = new Set();
const initiatingWatchdogs = new Map();

// Five minutes, deliberately far beyond any healthy announce. Cold starts
// with many drives have been measured at ~11s, but a slow DHT, a bad network
// or a machine waking from sleep can take far longer, and a share wrongly
// labelled "Not reachable" is much worse than one that says "Initiating" for
// a while: the first is a claim the user will act on, the second is patience.
// This is a last-resort backstop for a genuinely dead announce, not a
// latency budget.
const INITIATING_TIMEOUT_MS = 5 * 60 * 1000;

function markAnnounced(driveId) {
    if (!driveId) return;
    announcedDrives.add(driveId);
    clearInitiatingWatchdog(driveId);
    const cur = driveItems.get(driveId)?.getData?.()?.status
        || drives.find(d => d.id === driveId)?.status;
    if (cur === 'initiating') updateDriveInList({ id: driveId, status: 'sharing' });
}

function clearInitiatingWatchdog(driveId) {
    const t = initiatingWatchdogs.get(driveId);
    if (t) { clearTimeout(t); initiatingWatchdogs.delete(driveId); }
}

// Arm only for a card actually sitting in 'initiating'. Re-arming is safe:
// the previous timer is cleared first.
function armInitiatingWatchdog(driveId) {
    if (!driveId || announcedDrives.has(driveId)) return;
    clearInitiatingWatchdog(driveId);
    initiatingWatchdogs.set(driveId, setTimeout(() => {
        initiatingWatchdogs.delete(driveId);
        if (announcedDrives.has(driveId)) return;
        const cur = driveItems.get(driveId)?.getData?.()?.status
            || drives.find(d => d.id === driveId)?.status;
        if (cur !== 'initiating') return;
        console.warn('[PearDrop] Share never announced on the DHT', driveId);
        updateDriveInList({ id: driveId, status: 'unreachable' });
    }, INITIATING_TIMEOUT_MS));
}

// Multi-file shares are shown as "Folder" (placeholder until real folder
// names land — see the note in hyperdrive-manager.createDrive).
//
// New shares are already CREATED with that name, but every drive made before
// the rename carries "2 files", "70 files", … in drives-state.json and would
// keep showing it forever, so the list looks half-renamed. This is a DISPLAY
// rename only: the stored name is never rewritten, so nothing is lost and the
// engine's manifest stays exactly as it wrote it.
//
// Deliberately narrow — it matches only the old generated pattern, so a share
// the user deliberately named "3 files of mine" keeps its name.
const LEGACY_MULTI_FILE_NAME = /^\d+\s+files?$/i;

// Stand-in shown for any multi-file share until real folder names land.
const FOLDER_PLACEHOLDER = 'Folder';

// The name we'd show with no alias set — i.e. what "Reset" restores.
function baseTitle(rawTitle, fileCount) {
    const name = String(rawTitle == null ? '' : rawTitle).trim();
    if (LEGACY_MULTI_FILE_NAME.test(name)) return FOLDER_PLACEHOLDER;
    // No usable name at all, but we know it holds more than one file.
    if (fileCount > 1 && (!name || name === 'Unknown')) return FOLDER_PLACEHOLDER;
    return rawTitle;
}

/**
 * Resolve what a card actually shows.
 * Precedence: user alias > "Folder" placeholder > the engine's stored name.
 * @param {string} [driveId] omit to skip the alias lookup
 */
function displayTitle(rawTitle, fileCount, driveId) {
    return getAlias(driveId) || baseTitle(rawTitle, fileCount);
}

function normalizeDrive(drive) {
    const fileCount = drive.fileCount || drive.files?.length || 1;
    const id = drive.id || drive.driveId;
    const rawTitle = drive.name || drive.fileName || drive.title || 'Unknown';
    return {
        id,
        title: displayTitle(rawTitle, fileCount, id),
        // What the card would show with no alias. The Rename modal needs this
        // to label the reset, and it must NOT be re-read from `title` — that
        // is already aliased, so doing so would make the alias its own
        // "original" the second time the modal opens.
        originalTitle: baseTitle(rawTitle, fileCount),
        alias: getAlias(id),
        size: drive.totalBytes || drive.size || 0,
        fileCount,
        files: drive.files || [],
        // Derived from the backend's `state`, NOT defaulted to 'sharing'.
        //
        // The engine sends `state` ('seeking' | 'active' | 'paused' |
        // 'errored'); it never sends `status`. So `drive.status || 'sharing'`
        // made EVERY restored drive claim to be an active share — including a
        // download that was interrupted half way. The card came back green
        // and "Active", with no sign anything was unfinished and no way to
        // resume it.
        //
        // For a download, 'seeking' is the tell: openDrive writes that when
        // the transfer starts and only main promotes it to 'active' once the
        // files have actually landed. So seeking + isUpload:false == started
        // but never finished.
        status: drive.status || deriveStatusFromState(drive),
        progress: drive.progress,
        speed: drive.speed,
        peers: drive.peers || 0,
        // Backend canonically uses `isUpload` (true for shares, false for
        // downloads); prefer an explicit `.type` if one is passed but fall
        // back to deriving from isUpload so the Share/Receive split filter
        // actually separates them (was defaulting everything to 'share').
        type: drive.type || (drive.isUpload === false ? 'download' : 'share'),
        shareLink: drive.shareLink,
        // The manifest stores this as createdAt; without mapping it the
        // File Info "Added" row had no source and always showed a dash.
        addedAt: drive.addedAt || drive.createdAt || null,
        localPath: drive.localPath || null,
        favorite: isFavorite(drive.id || drive.driveId)
    };
}

// ─── Favorites (client-side, localStorage) ──────────────────────────────
// Simple string-set of drive ids. Used by the Favorites tab filter and by
// the 3-dot menu's Add/Remove-from-Favorites toggle.
const FAVORITES_KEY = 'peardrop.favorites.v1';
function loadFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
        return new Set();
    }
}
// `var` + lazy accessor for the same reason as aliasMap below: normalizeDrive
// and removeDriveFromList are hoisted functions defined ABOVE this line that
// touch this set, and a `let` would leave it in the temporal dead zone until
// execution got here.
var favoritesSet;
function favorites() {
    if (!favoritesSet) favoritesSet = loadFavorites();
    return favoritesSet;
}
function isFavorite(id) { return !!id && favorites().has(id); }
function saveFavorites() {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites()]));
    } catch (_) { /* quota exceeded / disabled — ignore */ }
}
// Row separators and their per-column offsets were keyed off :nth-child,
// which counts EVERY slot — including ones the active tab filters out. A
// single starred drive sitting at slot 7 would then draw a separator above
// it as though it had rows above, and land in the wrong column's offset.
// These attributes re-number only the slots actually on screen; the CSS
// keys off them instead.
function reindexVisibleSlots() {
    if (!listContainer) return;
    let i = 0;
    listContainer.querySelectorAll('.scroll-list-slot').forEach((slot) => {
        if (slot.offsetParent === null) {          // display:none via a view filter
            delete slot.dataset.visIndex;
            delete slot.dataset.visCol;
            return;
        }
        slot.dataset.visIndex = String(i);
        slot.dataset.visCol = (i % 2 === 0) ? 'left' : 'right';
        i++;
    });
}
window.reindexVisibleSlots = reindexVisibleSlots;

function toggleFavorite(id) {
    if (!id) return false;
    if (favorites().has(id)) favorites().delete(id);
    else favorites().add(id);
    saveFavorites();
    return favorites().has(id);
}

// ─── Aliases (client-side, localStorage) ────────────────────────────────
// A per-drive display name the user sets from the 3-dot menu's "Rename".
//
// LOCAL ONLY, BY DESIGN (beta):
//   - It never travels to peers. The name a receiver sees comes from the
//     share's `.peardrop.json`, which is written once at create time; we do
//     not rewrite the drive to rename a card.
//   - It never touches drives-state.json. The engine's stored name is left
//     exactly as written, so an alias is always reversible and real folder
//     names can replace the "Folder" placeholder later with no migration.
//
// Known beta trade-off (same one favorites already has): localStorage is
// per-install, so aliases are lost on a reinstall while the drives they
// name survive. Accepted for beta; the fix is storing them alongside the
// drive, which is engine territory.
const ALIASES_KEY = 'peardrop.aliases.v1';
const ALIAS_MAX_LEN = 120;

function loadAliases() {
    try {
        const raw = localStorage.getItem(ALIASES_KEY);
        if (!raw) return new Map();
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return new Map();
        return new Map(Object.entries(obj).filter(([, v]) => typeof v === 'string' && v.trim()));
    } catch (_) {
        return new Map();
    }
}
// `var`, deliberately — and lazily filled by aliases() below.
//
// This file is one long script. `normalizeDrive` and `addDriveToList` are
// hoisted function declarations defined ABOVE this line, and both call
// getAlias(). With `let` the binding would sit in the temporal dead zone
// until execution reached this statement, so a call from above would throw
// ReferenceError — and in a single-script renderer one uncaught error takes
// the whole UI down with it (the v0.17.1 incident). `var` hoists to
// undefined instead, and the accessor fills it in on first use, so the order
// of definition can no longer matter. Storage is still read exactly once.
var aliasMap;

function aliases() {
    if (!aliasMap) aliasMap = loadAliases();
    return aliasMap;
}

function saveAliases() {
    try {
        localStorage.setItem(ALIASES_KEY, JSON.stringify(Object.fromEntries(aliases())));
    } catch (_) { /* quota exceeded / disabled — ignore */ }
}

function getAlias(id) {
    if (!id) return null;
    const v = aliases().get(id);
    return (typeof v === 'string' && v.trim()) ? v : null;
}

/**
 * Set or clear a drive's alias.
 * An empty / whitespace-only name CLEARS it — that is the reset path, so
 * there is no separate "remove alias" state to keep in sync.
 * @returns {string|null} the alias now in force, or null if cleared
 */
function setAlias(id, name) {
    if (!id) return null;
    const clean = String(name == null ? '' : name).trim().slice(0, ALIAS_MAX_LEN);
    if (!clean) aliases().delete(id);
    else aliases().set(id, clean);
    saveAliases();
    return clean || null;
}

/**
 * Forget everything stored locally about a drive that no longer exists.
 *
 * Removing a drive used to leave its alias and its favorite flag behind in
 * localStorage forever — they grew without bound, and a drive id that ever
 * came round again would silently inherit a dead name and a star nobody set.
 * Called from removeDriveFromList, the one place a row actually goes away.
 */
function forgetLocalDriveState(id) {
    if (!id) return;
    let changed = false;
    if (aliases().delete(id)) { saveAliases(); changed = true; }
    if (favorites().delete(id)) { saveFavorites(); changed = true; }
    if (changed) log('Cleared local state for removed drive:', id);
}

// ============================================================================
// IPC EVENT HANDLERS
// ============================================================================

function bindIPC() {
    // Peer connections
    window.electronAPI.onPeerConnected?.((event, data) => {
        const driveId = data.driveId;
        recordPeerConnection(driveId, data, true);
        const item = driveItems.get(driveId);
        if (item) {
            const drive = drives.find(d => d.id === driveId);
            if (drive) {
                drive.peers = (drive.peers || 0) + 1;
                item.update({ peers: drive.peers });
            }
        }
    });
    
    window.electronAPI.onPeerDisconnected?.((event, data) => {
        const driveId = data.driveId;
        recordPeerConnection(driveId, data, false);
        const item = driveItems.get(driveId);
        if (item) {
            const drive = drives.find(d => d.id === driveId);
            if (drive && drive.peers > 0) {
                drive.peers--;
                item.update({ peers: drive.peers });
            }
            // A peer that leaves MID-transfer never produces
            // 'upload-complete', so without this the card keeps showing the
            // speed of a transfer that has stopped. Only once the last one
            // is gone — other peers may still be pulling.
            if (!drive || drive.peers <= 0) {
                item.update({ speed: 0 });
            }
        }
    });
    
    // Progress updates (covers both upload and download via 'upload-progress' event)
    // Data format from downloader: { driveId, peerId, percent, bytesFormatted, totalFormatted, speedFormatted }
    window.electronAPI.onUploadProgress?.((event, data) => {
        log('Progress event:', data);
        const { driveId, peerId, percent, speedFormatted } = data;
        const item = driveItems.get(driveId);
        if (!item) {
            log('Progress: No item found for driveId:', driveId);
            return;
        }
        
        // Cancelled: ignore further progress so the bar and percentage stop
        // dead the moment the user confirms, rather than climbing while the
        // backend finishes unwinding.
        if (cancellingDrives.has(driveId)) return;

        // If this is a download (peerId === 'self'), update progress
        if (peerId === 'self') {
            // Convert percent (0-100) to progress (0-1)
            const progress = typeof percent === 'number' ? percent / 100 : 0;
            // Parse speed from formatted string (e.g., "1.5 MB/s" -> bytes)
            const speed = parseSpeed(speedFormatted);
            
            log('Progress: Updating download:', { driveId, progress, speed });
            item.update({
                status: 'downloading',
                progress: progress,
                speed: speed
            });
        } else {
            // This is an upload (someone downloading from us).
            // A peer pulling bytes is proof of reachability stronger than any
            // announce signal, so settle the initiating state here too — a
            // share actively serving must never read "Initiating".
            markAnnounced(driveId);
            const speed = parseSpeed(speedFormatted);
            item.update({ 
                status: 'sharing',
                speed: speed
            });
        }
    });
    
    // A peer finished pulling from us.
    //
    // This event has been emitted all along — tracker 'complete' ->
    // manager 'upload-complete' -> main -> here — and NOTHING subscribed.
    // So a share's speed was written on every chunk and never cleared: the
    // last value from the final chunk stayed frozen on the card forever,
    // which is why it never "refreshed on its own".
    //
    // peerId 'self' is main's marker for OUR download finishing; that case
    // belongs to onFilesDownloaded below, not here.
    window.electronAPI.onUploadComplete?.((event, data) => {
        const driveId = data && data.driveId;
        if (!driveId || data.peerId === 'self') return;
        const item = driveItems.get(driveId);
        if (!item) return;
        // Back to a plain "Active": still shared, nothing moving.
        item.update({ status: 'sharing', speed: 0 });
    });

    // Download complete
    window.electronAPI.onFilesDownloaded?.((event, data) => {
        const { driveId, files, isSeeding } = data;
        const item = driveItems.get(driveId);
        if (item) {
            // A finished download does NOT stop being useful — main.js sets
            // the drive to ACTIVE and starts seeding it (see "Download
            // complete, now seeding"), because that's the whole point of a
            // P2P network: what you fetched, you now serve.
            //
            // The renderer used to hardcode 'complete' and drop the
            // isSeeding flag the backend was already sending, so a drive
            // that was actively sharing displayed as a finished, inert
            // item. Report what is actually true.
            item.update({
                status: isSeeding ? 'sharing' : 'complete',
                progress: 1,
                fileCount: files?.length || 1
            });
            if (data.partial) {
                // Some files never arrived. Saying "complete" here would be
                // a plain lie about what is on disk.
                showToast(`Finished with ${data.failedCount} file${data.failedCount !== 1 ? 's' : ''} missing`, 'error');
            } else {
                showToast(isSeeding ? 'Download complete — now sharing' : 'Download complete!', 'success');
            }
        }
    });
    
/**
 * What a failed resume should look like on the card.
 *
 * Two very different failures arrive on the same channel:
 *   "Storage directory missing" -> the drive's data is GONE. It can never
 *       announce or serve. The card must say so.
 *   "File descriptor could not be locked" -> another process holds the
 *       corestore. Transient, retried next boot — calling that dead is wrong.
 *
 * Shared by the live 'drive-resume-failed' event and the boot-time
 * `resumeErrors` snapshot, so the two can never disagree.
 */
function statusForResumeError(reason, isDownload) {
    const dataGone = /storage directory missing|no such file|ENOENT/i
        .test(String(reason || ''));
    if (!dataGone) return 'inactive';
    // The Corestore folder is gone. For a SHARE that is terminal: the key
    // lived there, so the link is dead for good — say "Share lost".
    //
    // For a DOWNLOAD it is far less dramatic. The received files live in
    // ~/peardrop/downloads, not in the Corestore, so they are very likely
    // still there and still openable; all that is lost is the ability to
    // seed them back. 'inactive' says "not running" without claiming
    // anything about the files.
    return isDownload ? 'inactive' : 'lost';
}

    // Drives updated (from HyperdriveManager)
    window.electronAPI.onDrivesUpdated?.((event, data) => {
        if (data.action === 'loaded') {
            // Complete drives list loaded (e.g., after migration or startup)
            console.log('[PearDrop] Drives loaded, refreshing list:', data.drives?.length || 0);
            // Announces that landed before this window attached its listener.
            // Seed them first so normalizeDrive resolves those cards straight
            // to 'sharing' instead of a "Initiating" flash.
            if (Array.isArray(data.announced)) {
                for (const id of data.announced) announcedDrives.add(id);
            }
            // Drives that failed to resume during init. main has always sent
            // this snapshot and the renderer has never read it — the live
            // 'drive-resume-failed' event fires DURING init, before this
            // payload exists, so its `if (!existing) return` guard dropped
            // every one of them. The result: a drive whose files are gone
            // came back looking healthy, then sat on "Initiating" for five
            // minutes and finally claimed "Not reachable" — which blamed the
            // network for a missing folder.
            const resumeErrors = data.resumeErrors || {};
            if (data.drives) {
                for (const drive of data.drives) {
                    const normalized = normalizeDrive(drive);
                    // Applied BEFORE the card mounts, so a dead drive never
                    // shows as Initiating and never arms the announce
                    // watchdog.
                    const failed = resumeErrors[normalized.id];
                    if (failed) {
                        normalized.status = statusForResumeError(
                            failed.error, normalized.type === 'download');
                    }
                    if (driveItems.has(normalized.id)) {
                        updateDriveInList(normalized);
                    } else {
                        addDriveToList(normalized);
                    }
                }
                // The thumbnail attempt inside addDriveToList races drive
                // resumption and swarm bootstrap, so on a cold start the
                // video grabs time out. Failures are no longer cached, so a
                // second pass once things are quiet actually sticks — this
                // is what a manual refresh was doing by hand.
                scheduleThumbnailRetry();
                reconcileMissingFiles();
            }
        } else if (data.action === 'removed' && data.id) {
            // The row is going away, so stop suppressing its progress events.
            // Without this the id stays in the set for the life of the
            // session and would silently mute a future drive reusing it.
            cancellingDrives.delete(data.id);
            // Drive was deleted from backend
            console.log('[DEBUG] onDrivesUpdated - removal event received:', {
                action: data.action,
                id: data.id,
                driveItemsSize: driveItems.size,
                scrollListSize: scrollList._slots?.size || 'unknown',
                driveItemExists: driveItems.has(data.id),
                scrollListHasSlot: scrollList._slots?.has(data.id) || 'unknown'
            });
            
            removeDriveFromList(data.id, { animate: true });

            console.log('[DEBUG] onDrivesUpdated - after removal:', {
                driveItemsSize: driveItems.size,
                scrollListSize: scrollList._slots?.size || 'unknown',
                driveItemExists: driveItems.has(data.id),
                scrollListHasSlot: scrollList._slots?.has(data.id) || 'unknown'
            });
        } else if (data.action === 'added' && data.entry) {
            // Single-drive added/refreshed event — fires after share creation
            // AND after a download completes (with paths populated). If we
            // already have the slot, merge new data so file paths land; if
            // not (rare), create it. This is how downloaded file paths
            // propagate to the UI without an app reload.
            const normalized = normalizeDrive(data.entry);
            if (driveItems.has(normalized.id)) {
                updateDriveInList(normalized);
            } else {
                addDriveToList(normalized, { animate: true });
            }
            // Now that the path is on the drive, retry the main thumbnail
            // for single-file drives. (addDriveToList already tries on first
            // mount, but for downloads it usually doesn't have a path yet.)
            loadSingleFileThumbnail(normalized.id);
            loadGroupThumbnail(normalized.id);
        } else if (data.drives) {
            // Legacy format or individual drive updates — animate the new ones
            for (const drive of data.drives) {
                const normalized = normalizeDrive(drive);
                if (driveItems.has(normalized.id)) {
                    updateDriveInList(normalized);
                } else {
                    addDriveToList(normalized, { animate: true });
                }
            }
        }
    });

    // Drive resume failed (new in unified engine 0.24.0) — the engine gave up
    // on resuming an interrupted drive. Flip the display to inactive so the
    // user sees the failure instead of a stuck "resuming" spinner.
    window.electronAPI.onDriveResumeFailed?.((event, data) => {
        if (!data || !data.driveId) return;
        console.log('[PearDrop] drive-resume-failed:', data.driveId, data.error);
        const existing = drives.find(d => d.id === data.driveId);
        if (!existing) return;

        // Not all resume failures mean the same thing, and showing them
        // identically hid the one the user can actually act on:
        //
        //   "Storage directory missing"  -> the drive's data is GONE. It can
        //       never resume. The row is a tombstone; the honest thing is to
        //       say so and let the user remove it.
        //
        //   "File descriptor could not be locked" -> another process holds
        //       the corestore (a CLI share, a second window, a copy still
        //       shutting down). Transient, retried next boot — calling that
        //       dead would be wrong.
        clearInitiatingWatchdog(data.driveId);
        updateDriveInList({
            id: data.driveId,
            status: statusForResumeError(data.error, existing.type === 'download')
        });
    });

    // Resumed drive ready to continue download (new in unified engine 0.24.0)
    // — an interrupted download reconnected to the sender and can now finish.
    // Kick the same handleDownload path used for fresh downloads.
    // Sender went offline mid-download. This event has existed and been
    // forwarded by main all along, but nothing subscribed to it — so the
    // card sat frozen at its last percentage with no explanation while the
    // 60s-per-file stall watchdog ran down.
    window.electronAPI.onDownloadPeerDisconnected?.((event, data) => {
        const driveId = data && data.driveId;
        if (!driveId || cancellingDrives.has(driveId)) return;
        const drive = drives.find(d => d.id === driveId);
        if (!drive) return;

        // Read the LIVE status off the drive-item, never the `drives` array.
        // Progress updates call item.update() directly and never write back to
        // the array — progress calls item.update() directly.
        // So the first drop set the array to 'connecting' and NOTHING ever set
        // it back to 'downloading': the Resume button calls handleDownload
        // directly, and every progress event after that only touches the item.
        // This guard then rejected the second and third disconnect, which is
        // why the overlay appeared exactly once per download and never again.
        const live = driveItems.get(driveId)?.getData?.();
        const status = (live && live.status) || drive.status;

        // 'connecting' counts too: a drop while reconnecting is still a drop.
        // 'interrupted' is excluded so a second disconnect on an already
        // parked card is a no-op rather than a redundant re-render.
        if (status !== 'downloading' && status !== 'connecting') return;

        // Plain status change — no overlay. The card keeps its thumbnail,
        // name and size, and simply reads "Disconnected at N%" with Resume
        // and cancel on the row. Speed is zeroed because nothing is moving.
        updateDriveInList({ id: driveId, status: 'interrupted', speed: 0 });
    });

    // Share became reachable on the DHT.
    window.electronAPI.onDriveAnnounced?.((event, data) => {
        if (data && data.driveId) markAnnounced(data.driveId);
    });

    // The announce itself failed — no point waiting out the watchdog.
    window.electronAPI.onDriveAnnounceFailed?.((event, data) => {
        const driveId = data && data.driveId;
        if (!driveId) return;
        announcedDrives.delete(driveId);
        clearInitiatingWatchdog(driveId);
        const cur = driveItems.get(driveId)?.getData?.()?.status
            || drives.find(d => d.id === driveId)?.status;
        if (cur === 'initiating' || cur === 'sharing') {
            updateDriveInList({ id: driveId, status: 'unreachable' });
        }
    });

    window.electronAPI.onDriveReadyToDownload?.((event, data) => {
        if (!data || !data.driveId) return;
        const { driveId, shareLink, shareName } = data;
        console.log('[PearDrop] drive-ready-to-download:', driveId);

        // ONE question decides this: did the user ask for this transfer in
        // this session? If so, a reconnect continues it. If not — a drive the
        // engine resumed at boot — it parks and asks, because silently
        // pulling gigabytes because the app happened to open is not the app's
        // call to make.
        //
        // There used to be a second condition here, `parked`, meaning "this
        // card is showing the interrupted state, so the peer returning should
        // resume it". That was written when only a mid-session drop could put
        // a card in that state. It is now also the state a RESTORED download
        // loads in, so `parked` was true for exactly the drives that must not
        // auto-start, and every restored download resumed itself on launch —
        // landing on "Downloading" and staying there when the sender was gone.
        //
        // It is redundant as well as harmful: a mid-session drop was
        // user-initiated by definition, so its id is already in the set below.
        const userAsked = userStartedDownloads.has(driveId);

        // Only write the title when the engine actually supplied one.
        // `shareName || 'Download'` overwrote a card that already showed the
        // real filename with the placeholder "Download", and the next update
        // put the name back — a visible flip on every resume. A title change
        // is structural, so it also forces a full re-render rather than an
        // in-place patch, making it the most expensive kind of no-op.
        const update = {
            id: driveId,
            status: userAsked ? 'downloading' : 'interrupted'
        };
        // Through displayTitle so a resumed drive whose stored name is the old
        // "N files" doesn't reintroduce it after the list has been normalised.
        if (shareName) {
            const known = drives.find(d => d.id === driveId);
            update.title = displayTitle(shareName, known?.fileCount || 1, driveId);
            update.originalTitle = baseTitle(shareName, known?.fileCount || 1);
        }
        updateDriveInList(update);

        // Nobody asked for this one. The status set above already reads
        // "Disconnected" with Resume on the row, so there is nothing more to
        // do until they press it.
        if (!userAsked) return;

        if (typeof handleDownload === 'function') {
            handleDownload(driveId, shareLink);
        }
    });
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatFileSize(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Parse speed string like "1.5 MB/s" back to bytes/sec
function parseSpeed(speedStr) {
    if (!speedStr || typeof speedStr !== 'string') return 0;
    const match = speedStr.match(/([\d.]+)\s*(B|KB|MB|GB)/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    const multipliers = { 'B': 1, 'KB': 1024, 'MB': 1024*1024, 'GB': 1024*1024*1024 };
    return value * (multipliers[unit] || 1);
}

// File extensions Chromium can decode natively into a <video> element.
// Anything outside this set silently falls back to the OS icon via the
// existing get-file-thumbnail IPC (mkv/avi/wmv etc.).
// Chromium (Electron 28) can decode: mp4 (H.264/H.265 in most builds),
// webm, m4v, mov, ogv/ogg. Adding avi/mkv/wmv/flv/ts/3gp/mts as best-effort —
// generateVideoThumb attempts every one, and falls back gracefully via
// its .catch if the codec inside isn't supported. So even mkv-with-h264
// (very common) now gets a first-frame poster instead of an SVG icon.
const VIDEO_EXTS = new Set([
    '.mp4', '.webm', '.m4v', '.mov', '.ogv', '.ogg',
    '.mkv', '.avi', '.wmv', '.flv', '.ts', '.3gp', '.mts', '.m2ts'
]);

function getFileExt(name) {
    if (!name) return '';
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
}

// Extract a first-frame thumbnail from a local video file using a hidden
// <video> element + a small canvas. Output is 80x80 JPEG so the encoded
// data: URL stays tiny (faster encode, smaller memory cost). Resolves with
// { kind: 'image', src }, rejects on any failure — caller falls back to
// the OS-icon path.
// Video decoding is expensive; ten of them at once during startup is what
// pushed every attempt past its timeout. Cap concurrency so each gets a
// fair share of the decoder instead of all of them failing together.
const VIDEO_THUMB_CONCURRENCY = 2;
const _videoThumbQueue = [];
let _videoThumbActive = 0;

function _pumpVideoThumbQueue() {
    while (_videoThumbActive < VIDEO_THUMB_CONCURRENCY && _videoThumbQueue.length) {
        const job = _videoThumbQueue.shift();
        _videoThumbActive++;
        generateVideoThumb(job.path)
            .then(job.resolve, job.reject)
            .finally(() => { _videoThumbActive--; _pumpVideoThumbQueue(); });
    }
}

function queueVideoThumb(filePath) {
    return new Promise((resolve, reject) => {
        _videoThumbQueue.push({ path: filePath, resolve, reject });
        _pumpVideoThumbQueue();
    });
}

function generateVideoThumb(filePath) {
    return new Promise((resolve, reject) => {
        if (!filePath) return reject(new Error('No path'));

        const video = document.createElement('video');
        // 'metadata' only fetches headers — the seek could report complete
        // before any frame was decoded, so drawImage painted nothing and
        // the canvas kept its own black fill. That was the black thumbnail.
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        // Keep it out of the layout / off-screen
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.top = '0';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';

        let done = false;

        const cleanup = () => {
            try {
                video.removeAttribute('src');
                video.load();
            } catch { /* ignore */ }
            if (video.parentNode) video.parentNode.removeChild(video);
        };
        const fail = (err) => {
            if (done) return;
            done = true;
            // Surfaces WHY a video fell back to the generic icon — codec,
            // timeout, or no frame. Cheap, and there's no other signal.
            console.warn('[video-thumb] fallback to icon:', filePath,
                         '|', (err && err.message) || 'unknown',
                         '| readyState=', video.readyState,
                         'dims=', video.videoWidth + 'x' + video.videoHeight,
                         'err=', video.error && video.error.code);
            cleanup();
            reject(err || new Error('Video thumb failed'));
        };
        const succeed = (dataUrl) => {
            if (done) return;
            done = true;
            cleanup();
            resolve({ kind: 'image', src: dataUrl });
        };

        // Candidate timestamps, tried in order. 1s was far too early —
        // films routinely open on several seconds of black leader or a
        // fading studio logo. If a grab comes back essentially black we
        // move deeper into the file rather than shipping a black square.
        let attempt = 0;
        const seekPoints = () => {
            const d = video.duration;
            if (!d || !isFinite(d)) return [1, 3, 6];
            return [d * 0.10, d * 0.25, d * 0.45, d * 0.65]
                .map(t => Math.min(Math.max(t, 0.5), Math.max(d - 0.2, 0.5)));
        };

        const seekNext = () => {
            const points = seekPoints();
            while (attempt < points.length) {
                const t = points[attempt++];
                // Skip a target we're effectively already at — assigning it
                // fires no 'seeked', so the chain would stall until the
                // safety timeout.
                if (Math.abs((video.currentTime || 0) - t) < 0.05) continue;
                try {
                    video.currentTime = t;
                    return true;
                } catch (err) {
                    fail(err);
                    return false;
                }
            }
            return false;
        };

        video.addEventListener('loadedmetadata', () => { seekNext(); });

        // Mean luminance of the grab. Near-zero means we caught black
        // leader (or an undecoded frame) and should try further in.
        const isMostlyBlack = (ctx, size) => {
            try {
                const { data } = ctx.getImageData(0, 0, size, size);
                let sum = 0;
                // Every 4th pixel is plenty for a yes/no answer.
                for (let i = 0; i < data.length; i += 16) {
                    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
                }
                return (sum / (data.length / 16)) < 12;   // 0-255 scale
            } catch {
                return false;   // canvas unreadable — take what we have
            }
        };

        const drawFrame = () => {
            try {
                const target = 80;
                const vw = video.videoWidth || 1;
                const vh = video.videoHeight || 1;
                // Cover-fit: scale so the smaller side fills, crop the rest.
                const scale = Math.max(target / vw, target / vh);
                const dw = vw * scale;
                const dh = vh * scale;
                const canvas = document.createElement('canvas');
                canvas.width = target;
                canvas.height = target;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, target, target);
                ctx.drawImage(video, (target - dw) / 2, (target - dh) / 2, dw, dh);

                // Black grab and points left to try → go deeper.
                if (isMostlyBlack(ctx, target) && seekNext()) return;

                succeed(canvas.toDataURL('image/jpeg', 0.72));
            } catch (err) {
                fail(err);
            }
        };

        let frameWatchdog = null;
        const clearFrameWatchdog = () => {
            if (frameWatchdog) { clearTimeout(frameWatchdog); frameWatchdog = null; }
        };

        video.addEventListener('seeked', () => {
            // A completed seek does NOT guarantee a decoded frame is ready
            // to paint. requestVideoFrameCallback fires only once one has
            // actually been presented; readyState is the fallback.
            clearFrameWatchdog();

            // ...but rVFC can also never fire (paused element, codec quirk).
            // Without this the whole attempt burned the global timeout and
            // fell back to the OS icon. Draw anyway once a frame exists.
            frameWatchdog = setTimeout(() => {
                if (done) return;
                if (video.readyState >= 2) drawFrame();
                else if (!seekNext()) fail(new Error('No frame after seek'));
            }, 2500);

            if (typeof video.requestVideoFrameCallback === 'function') {
                video.requestVideoFrameCallback(() => { clearFrameWatchdog(); drawFrame(); });
            } else if (video.readyState >= 2) {
                clearFrameWatchdog();
                drawFrame();
            } else {
                video.addEventListener('loadeddata', () => {
                    clearFrameWatchdog();
                    drawFrame();
                }, { once: true });
            }
        });

        video.addEventListener('error', () => fail(new Error('Video load error')));

        // Append + assign src last so all listeners are wired first.
        document.body.appendChild(video);
        // Encode each segment: an unencoded '#' truncates the URL and the
        // file silently never loads (the drive letter's ':' must stay literal).
        video.src = 'file:///' + filePath
            .replace(/\\/g, '/')
            .split('/')
            .map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg)) ? seg : encodeURIComponent(seg))
            .join('/');

        // Safety net — never block the page forever on a bad file. 10s was
        // too tight: preload:'auto' plus a seek 10% into a 1080p MKV can
        // take longer, and every timeout silently became an OS icon.
        setTimeout(() => fail(new Error('Video thumb timeout')), 25000);
    });
}

// Lazy thumbnail loader for an expanded drive item's file rows.
// Walks every .drive-item-file in the item, maps it to the drive's
// files[] by data-file-index, and asks main for a thumbnail. Images use
// a direct file:// URL; everything else gets the OS-native icon.
// Cached per-path so re-expanding the same drive is instant.
async function loadFileThumbnails(driveId) {
    const item = driveItems.get(driveId);
    const itemEl = item && item._element;
    const drive = drives.find(d => d.id === driveId);
    if (!itemEl || !drive || !Array.isArray(drive.files)) return;

    const rows = itemEl.querySelectorAll('.drive-item-file');
    rows.forEach((row) => {
        if (row.dataset.thumbLoaded === 'done' || row.dataset.thumbLoaded === 'pending') {
            return;
        }
        const idx = parseInt(row.dataset.fileIndex, 10);
        const file = drive.files[idx];
        const filePath = file && file.path;
        if (!filePath) return; // no path → keep emoji fallback

        const thumbEl = row.querySelector('.drive-item-file-thumb');
        if (!thumbEl) return;

        // Cached? Apply immediately.
        if (fileThumbnailCache.has(filePath)) {
            applyThumbnail(thumbEl, fileThumbnailCache.get(filePath));
            row.dataset.thumbLoaded = 'done';
            return;
        }

        // Inflight? Reuse the pending promise so we don't spam IPCs.
        let promise = fileThumbnailPending.get(filePath);
        if (!promise) {
            const isVideo = VIDEO_EXTS.has(getFileExt(file.name));
            // Videos: try real frame extraction first; on any failure
            // (unsupported codec, broken file, timeout), fall through to
            // the IPC which returns the OS-native icon.
            const fetcher = isVideo
                ? queueVideoThumb(filePath).catch(() =>
                    window.electronAPI.getFileThumbnail(filePath)
                  )
                : window.electronAPI.getFileThumbnail(filePath);

            promise = fetcher
                .then((result) => {
                    const value = result || { kind: 'none', src: null };
                    cacheThumbResult(filePath, value);
                    fileThumbnailPending.delete(filePath);
                    return value;
                })
                .catch(() => {
                    const value = { kind: 'none', src: null };
                    cacheThumbResult(filePath, value);
                    fileThumbnailPending.delete(filePath);
                    return value;
                });
            fileThumbnailPending.set(filePath, promise);
        }

        row.dataset.thumbLoaded = 'pending';
        promise.then((value) => {
            if (!document.body.contains(row)) return; // slot was removed
            applyThumbnail(thumbEl, value);
            row.dataset.thumbLoaded = 'done';
        });
    });
}

// Fetch and apply the thumbnail to a single-file drive's main thumb slot.
// Re-uses the same cache + video extraction as the expanded file list.
// The lib renders <img> when data.thumbnail is set, so we just need to push
// the resolved src through updateDriveInList.
async function loadSingleFileThumbnail(driveId) {
    if (singleFileDriveThumbsLoaded.has(driveId)) return;

    const drive = drives.find(d => d.id === driveId);
    if (!drive) return;
    if (!Array.isArray(drive.files) || drive.files.length !== 1) return;

    const file = drive.files[0];
    if (!file || !file.path) return; // No path yet — drives-updated 'added' will retry

    singleFileDriveThumbsLoaded.add(driveId);

    let value;
    try {
        if (fileThumbnailCache.has(file.path)) {
            value = fileThumbnailCache.get(file.path);
        } else {
            const isVideo = VIDEO_EXTS.has(getFileExt(file.name));
            const fetcher = isVideo
                ? queueVideoThumb(file.path).catch((err) => {
                    // Log the reason so we can see WHY a specific file
                    // failed to poster (bad codec, DRM, corrupt header).
                    // Falls back to the OS-icon path which the filter
                    // below then drops so the SVG icon shows.
                    console.warn('[thumb] video frame extract failed for', file.name, '—', err && err.message);
                    return window.electronAPI.getFileThumbnail(file.path);
                  })
                : window.electronAPI.getFileThumbnail(file.path);
            value = await fetcher;
            cacheThumbResult(file.path, value);
        }
    } catch {
        return; // silent fail — emoji fallback stays
    }

    if (!value || !value.src) return;

    // Only push REAL image previews (image files + video-frame extracts)
    // through to the drive-item's `thumbnail`. If main.js came back with
    // `kind: 'icon'` — that's `app.getFileIcon()` returning a small OS
    // shell icon (Windows Music/PDF/etc.) — leaving `thumbnail` null lets
    // the drive-item library render our beautiful category-tinted SVG
    // instead of a pixelated 32-px OS glyph. Video-frame extracts come
    // back with `kind: 'video'` (or no kind but a data-URL src from
    // generateVideoThumb) — both are real previews, so allow them.
    if (value.kind === 'icon') return;

    // Inject into the drive's data — lib re-renders the thumb slot.
    updateDriveInList({ id: driveId, thumbnail: value.src });
}

// For multi-file ("group") drives: composite a stacked-card effect using up to
// the first 3 files' thumbnails — back layers peek behind the front, the way
// iOS folder/album icons render collections. A count pill in the corner shows
// the total. Far more recognizably "a collection" than a single thumb.
async function loadGroupThumbnail(driveId) {
    if (groupDriveThumbsLoaded.has(driveId)) return;

    const drive = drives.find(d => d.id === driveId);
    if (!drive) return;
    if (!Array.isArray(drive.files) || drive.files.length < 2) return;

    const first = drive.files[0];
    if (!first || !first.path) return; // path not ready — retry later

    groupDriveThumbsLoaded.add(driveId);

    // Fetch up to 3 file thumbnails in parallel (reusing the per-file cache).
    const sourceFiles = drive.files.slice(0, 3);
    const thumbs = await Promise.all(sourceFiles.map(async (file) => {
        if (!file || !file.path) return null;
        if (fileThumbnailCache.has(file.path)) return fileThumbnailCache.get(file.path);
        try {
            const isVideo = VIDEO_EXTS.has(getFileExt(file.name));
            const value = isVideo
                ? await queueVideoThumb(file.path).catch(() =>
                    window.electronAPI.getFileThumbnail(file.path)
                  )
                : await window.electronAPI.getFileThumbnail(file.path);
            cacheThumbResult(file.path, value);
            return value;
        } catch {
            return null;
        }
    }));

    // Load each into an <img> so we can drawImage to canvas.
    const loadedImages = await Promise.all(thumbs.map((t) => {
        if (!t || !t.src) return null;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = t.src;
        });
    }));

    // Composite onto a 80x80 canvas (2x retina for the 40x40 display).
    const target = 80;
    const canvas = document.createElement('canvas');
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext('2d');

    // ---- Stack geometry ----
    // The card stack centers in the canvas and "fans" from top-left (back)
    // to bottom-right (front). Cards are square with rounded corners.
    const cardSize = 54;
    const cornerR = 7;
    const stackOffset = 6;
    const usable = loadedImages.filter(Boolean).length;
    const layers = Math.min(usable, 3) || 1;

    // Center the entire stack inside the canvas
    const stackSpan = (layers - 1) * stackOffset;
    const baseX = (target - cardSize - stackSpan) / 2;
    const baseY = (target - cardSize - stackSpan) / 2;

    // Draw from BACK to FRONT so layers stack correctly.
    for (let i = layers - 1; i >= 0; i--) {
        const x = baseX + i * stackOffset;
        const y = baseY + i * stackOffset;
        const img = loadedImages[i];

        // Soft outer shadow ring for separation between stacked cards
        ctx.save();
        roundedRectPath(ctx, x - 1, y - 1, cardSize + 2, cardSize + 2, cornerR + 1);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fill();
        ctx.restore();

        // Card background (in case the image is small / fails)
        ctx.save();
        roundedRectPath(ctx, x, y, cardSize, cardSize, cornerR);
        ctx.fillStyle = '#1c1c20';
        ctx.fill();
        ctx.restore();

        // Clip the image to the rounded card bounds
        ctx.save();
        roundedRectPath(ctx, x, y, cardSize, cardSize, cornerR);
        ctx.clip();
        if (img) {
            const scale = Math.max(cardSize / img.width, cardSize / img.height);
            const dw = img.width * scale;
            const dh = img.height * scale;
            ctx.drawImage(img, x + (cardSize - dw) / 2, y + (cardSize - dh) / 2, dw, dh);
        }
        ctx.restore();

        // Subtle hairline border for crispness
        ctx.save();
        roundedRectPath(ctx, x + 0.5, y + 0.5, cardSize - 1, cardSize - 1, cornerR - 0.5);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    // ---- Count badge: rounded pill, bottom-right ----
    const count = drive.files.length;
    const badgeText = String(count);
    ctx.font = 'bold 18px -apple-system, "SF Pro Display", "Segoe UI", sans-serif';
    const textW = ctx.measureText(badgeText).width;
    const padX = 7;
    const badgeH = 22;
    const badgeW = Math.max(badgeH, textW + padX * 2);
    const badgeX = target - badgeW - 3;
    const badgeY = target - badgeH - 3;
    const bR = badgeH / 2;

    // Outer ring (softens against thumbnail content behind)
    ctx.save();
    roundedRectPath(ctx, badgeX - 1, badgeY - 1, badgeW + 2, badgeH + 2, bR + 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    ctx.restore();

    // Pill
    ctx.save();
    roundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, bR);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.82)';
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    updateDriveInList({ id: driveId, thumbnail: dataUrl });
}

// Helper: trace a rounded rectangle path (caller decides fill / stroke / clip).
function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// Swap the emoji placeholder inside a thumb span for the resolved image / icon.
// `none` leaves the existing emoji as-is.
function applyThumbnail(thumbEl, value) {
    if (!value || !value.src) return;
    const previous = thumbEl.innerHTML;
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    // If the source turns out to be undecodable, restore whatever icon was
    // there and forget the entry. A broken-page glyph is strictly worse
    // than the category icon it replaced.
    img.addEventListener('error', () => {
        thumbEl.innerHTML = previous;
        for (const [k, v] of fileThumbnailCache) {
            if (v && v.src === value.src) { fileThumbnailCache.delete(k); break; }
        }
        saveThumbCacheSoon();
    }, { once: true });
    img.src = value.src;
    thumbEl.innerHTML = '';
    thumbEl.appendChild(img);
}

function getFileIcon(filename) {
    if (!filename) return '📄';
    const ext = filename.split('.').pop()?.toLowerCase();
    const icons = {
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
    return icons[ext] || '📄';
}

const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
};

function showToast(message, type = 'info') {
    toast.className = 'toast ' + type;
    toast.innerHTML = '';

    const iconSvg = TOAST_ICONS[type];
    if (iconSvg) {
        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.innerHTML = iconSvg;
        toast.appendChild(icon);
    }

    const msg = document.createElement('span');
    msg.className = 'toast-message';
    msg.textContent = message;
    toast.appendChild(msg);

    toast.classList.add('visible');

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// ============================================================================
// PROFILE & LIST MENU
// ============================================================================

profileIcon.addEventListener('click', () => {
    showToast('Profile settings coming soon', 'info');
});

// List menu (3 dots)
let listMenuOpen = false;
let sortSubmenuOpen = false;

const listMenuContainer = listMenuBtn.parentElement;

listMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    // If in reorder mode, clicking the button exits reorder mode
    if (isReorderMode) {
        disableReorderMode();
        // Switch to custom sort since user made manual changes
        sortField = 'custom';
        updateSortUI();
        showToast('Custom order saved', 'success');
        return;
    }
    
    listMenuOpen = !listMenuOpen;
    listMenuDropdown.classList.toggle('open', listMenuOpen);
    listMenuContainer.classList.toggle('menu-open', listMenuOpen);
    if (!listMenuOpen) {
        sortSubmenu.classList.remove('open');
        sortSubmenuOpen = false;
    }
});

// Sort By hover/click to open submenu
function positionSubmenu() {
    const dropdownRect = listMenuDropdown.getBoundingClientRect();
    const triggerRect = sortByTrigger.getBoundingClientRect();
    const submenuWidth = 160; // min-width from CSS
    
    // Position submenu to the side of the dropdown (attached to parent menu)
    // Try right side first
    let left = dropdownRect.right + 4;
    let flipLeft = false;
    
    // If would overflow right edge, flip to left side of dropdown
    if (left + submenuWidth > window.innerWidth - 10) {
        left = dropdownRect.left - submenuWidth - 4;
        flipLeft = true;
    }
    
    // Vertically align with the Sort By trigger item
    sortSubmenu.style.top = triggerRect.top + 'px';
    sortSubmenu.style.left = left + 'px';
    sortSubmenu.classList.toggle('flip-left', flipLeft);
}

sortByTrigger.addEventListener('mouseenter', () => {
    if (listMenuOpen) {
        positionSubmenu();
        sortSubmenu.classList.add('open');
        sortSubmenuOpen = true;
    }
});

sortByTrigger.addEventListener('mouseleave', (e) => {
    // Don't close if moving to submenu
    if (!sortSubmenu.contains(e.relatedTarget)) {
        setTimeout(() => {
            if (!sortSubmenu.matches(':hover')) {
                sortSubmenu.classList.remove('open');
                sortSubmenuOpen = false;
            }
        }, 100);
    }
});

sortSubmenu.addEventListener('mouseleave', () => {
    sortSubmenu.classList.remove('open');
    sortSubmenuOpen = false;
});

// Close menu on outside click
document.addEventListener('click', (e) => {
    if (listMenuOpen && !listMenuBtn.contains(e.target) && !listMenuDropdown.contains(e.target) && !sortSubmenu.contains(e.target)) {
        listMenuOpen = false;
        listMenuDropdown.classList.remove('open');
        listMenuContainer.classList.remove('menu-open');
        sortSubmenu.classList.remove('open');
        sortSubmenuOpen = false;
    }
});

// Handle sort submenu clicks
sortSubmenu.addEventListener('click', (e) => {
    const item = e.target.closest('.list-submenu-item');
    if (!item) return;
    
    e.stopPropagation();
    const sort = item.dataset.sort;
    
    if (sort === 'reorder') {
        // Enable reorder mode and switch to custom sort
        sortField = 'custom';
        updateSortUI();
        enableReorderMode();
    } else if (sort === 'custom') {
        // Just switch to custom ordering (preserve current order)
        sortField = 'custom';
        disableReorderMode();
        updateSortUI();
    } else {
        // If same sort clicked, toggle direction
        if (sort === sortField && sortField !== 'custom') {
            sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
        } else {
            sortField = sort;
            sortDirection = 'desc'; // Default to descending for new sort
        }
        disableReorderMode();
        applySorting();
        updateSortUI();
    }
    
    // Close menus
    listMenuOpen = false;
    listMenuDropdown.classList.remove('open');
    listMenuContainer.classList.remove('menu-open');
    sortSubmenu.classList.remove('open');
    sortSubmenuOpen = false;
});

// Handle menu item clicks (non-sort items)
listMenuDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.list-menu-item:not(.has-submenu)');
    if (!item) return;
    
    const action = item.dataset.action;
    if (!action) return;
    
    listMenuOpen = false;
    listMenuDropdown.classList.remove('open');
    listMenuContainer.classList.remove('menu-open');
    sortSubmenu.classList.remove('open');
    
    switch (action) {
        case 'select-shares':
            showToast('Select shares coming soon', 'info');
            break;
        case 'toggle-view':
            toggleViewMode();
            break;
        case 'pause-all':
            pauseAllTransfers();
            break;
        case 'resume-all':
            resumeAllTransfers();
            break;
        case 'clear-completed':
            clearCompletedTransfers();
            break;
    }
});

// ============================================================================
// LIST ACTIONS
// ============================================================================

async function pauseAllTransfers() {
    const activeDrives = drives.filter(d => 
        d.status === 'downloading' || d.status === 'sharing' || d.status === 'connecting'
    );
    
    if (activeDrives.length === 0) {
        showToast('No active transfers to pause', 'info');
        return;
    }
    
    let paused = 0;
    for (const drive of activeDrives) {
        try {
            const result = await window.electronAPI.drivesPause?.(drive.id);
            if (result?.success) {
                updateDriveInList({ id: drive.id, status: 'inactive' });
                paused++;
            }
        } catch (err) {
            console.error('Failed to pause:', drive.id, err);
        }
    }
    
    showToast(`Stopped ${paused} transfer${paused !== 1 ? 's' : ''}`, 'success');
}

async function resumeAllTransfers() {
    // Was filtering on 'paused', a status the UI no longer produces, so
    // Resume All silently found nothing.
    const pausedDrives = drives.filter(d => d.status === 'inactive');
    
    if (pausedDrives.length === 0) {
        showToast('No inactive transfers to resume', 'info');
        return;
    }
    
    let resumed = 0;
    for (const drive of pausedDrives) {
        try {
            const result = await window.electronAPI.drivesResume?.(drive.id);
            if (result?.success) {
                const status = drive.type === 'share' ? 'sharing' : 'downloading';
                updateDriveInList({ id: drive.id, status });
                resumed++;
            }
        } catch (err) {
            console.error('Failed to resume:', drive.id, err);
        }
    }
    
    showToast(`Resumed ${resumed} transfer${resumed !== 1 ? 's' : ''}`, 'success');
}

async function clearCompletedTransfers() {
    // Find all clearable items:
    // - Downloads that are complete, inactive, or not actively downloading
    // - Shares that are complete, inactive, paused, or not actively connected
    const clearable = drives.filter(d => {
        // Active downloads in progress - keep
        if (d.type === 'download' && d.status === 'downloading' && d.progress < 1) {
            return false;
        }
        // Active shares with peers connected - these need explicit clearing
        if (d.type === 'share' && d.status === 'sharing' && d.peers > 0) {
            return true; // Include but will warn
        }
        // Everything else: complete, inactive, error, disconnected
        return d.status === 'complete' || 
               d.status === 'sharing' || 
               d.status === 'error' ||
               d.status === 'inactive' ||
               (d.type === 'download' && d.progress >= 1) ||
               (d.type === 'share' && (!d.peers || d.peers === 0));
    });
    
    if (clearable.length === 0) {
        showToast('Nothing to clear', 'info');
        return;
    }
    
    // Count shares vs downloads for the message
    const shareCount = clearable.filter(d => d.type === 'share').length;
    const downloadCount = clearable.filter(d => d.type === 'download').length;
    
    // Build message
    let itemList = [];
    if (downloadCount > 0) itemList.push(`${downloadCount} download${downloadCount !== 1 ? 's' : ''}`);
    if (shareCount > 0) itemList.push(`${shareCount} share${shareCount !== 1 ? 's' : ''}`);
    
    const warningMsg = shareCount > 0 
        ? '\n\n⚠️ Are you sure you want to stop sharing these items? Others may not be able to download them anymore.'
        : '';
    
    showConfirm({
        title: 'Clear Completed',
        message: `This will remove ${itemList.join(' and ')} from the list.${warningMsg}`,
        buttons: [
            { label: 'Cancel', class: 'secondary', action: () => {} },
            { 
                label: `Clear ${clearable.length} Item${clearable.length !== 1 ? 's' : ''}`, 
                class: shareCount > 0 ? 'danger' : 'primary', 
                action: () => doClearTransfers(clearable, [])
            }
        ]
    });
}

async function doClearTransfers(downloads, uploads) {
    const toClear = [...downloads, ...uploads];
    let cleared = 0;
    
    for (const drive of toClear) {
        try {
            const result = await window.electronAPI.drivesRemove?.({ id: drive.id, deleteFiles: false });
            if (result?.success !== false) {
                removeDriveFromList(drive.id, { animate: true });
                cleared++;
            }
        } catch (err) {
            console.error('Failed to remove:', drive.id, err);
        }
    }
    
    showToast(`Cleared ${cleared} item${cleared !== 1 ? 's' : ''}`, 'success');
}

// ============================================================================
// VIEW MODE (Expanded / Compact)
// ============================================================================

const toggleViewLabel = document.getElementById('toggleViewLabel');

/**
 * Toggle between expanded and compact view for all items
 */
function toggleViewMode() {
    isExpandedView = !isExpandedView;
    
    // Update button label
    if (toggleViewLabel) {
        toggleViewLabel.textContent = isExpandedView ? 'Compact View' : 'Expanded View';
    }
    
    // Update all items with new preset
    for (const [id, item] of driveItems) {
        const drive = drives.find(d => d.id === id);
        if (drive) {
            const newPreset = getPresetForDrive(drive);
            item.setVisibility(newPreset);
        }
    }
    
    showToast(isExpandedView ? 'Expanded view' : 'Compact view', 'info');
}

// ============================================================================
// SORTING
// ============================================================================

const STATUS_PRIORITY = {
    'downloading': 1,
    'connecting': 2,
    'sharing': 3,
    'complete': 4,
    'inactive': 5,
    'error': 6
};

function getFileExtension(filename) {
    if (!filename) return '';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function applySorting() {
    if (sortField === 'custom' || drives.length === 0) return;
    
    // Sort the drives array
    const sorted = [...drives].sort((a, b) => {
        let comparison = 0;
        
        switch (sortField) {
            case 'recent':
                // Sort by addedAt timestamp (or id which contains timestamp)
                const timeA = a.addedAt || parseInt(a.id?.split('_')[1]) || 0;
                const timeB = b.addedAt || parseInt(b.id?.split('_')[1]) || 0;
                comparison = timeB - timeA; // Most recent first by default
                break;
                
            case 'status':
                const priorityA = STATUS_PRIORITY[a.status] || 99;
                const priorityB = STATUS_PRIORITY[b.status] || 99;
                comparison = priorityA - priorityB; // Lower priority number = higher in list
                break;
                
            case 'size':
                comparison = (b.size || 0) - (a.size || 0); // Largest first by default
                break;
                
            case 'name':
                const nameA = (a.title || a.name || '').toLowerCase();
                const nameB = (b.title || b.name || '').toLowerCase();
                comparison = nameA.localeCompare(nameB); // A-Z by default
                break;
                
            case 'peers':
                comparison = (b.peers || 0) - (a.peers || 0); // Most peers first by default
                break;
                
            case 'filetype':
                const extA = getFileExtension(a.title || a.name);
                const extB = getFileExtension(b.title || b.name);
                comparison = extA.localeCompare(extB); // A-Z by extension
                break;
        }
        
        // Apply direction
        return sortDirection === 'asc' ? -comparison : comparison;
    });
    
    // Reorder in ScrollList to match sorted order
    sorted.forEach((drive, index) => {
        const currentIndex = scrollList.getSlotIds().indexOf(drive.id);
        if (currentIndex !== index && currentIndex !== -1) {
            scrollList.reorderSlot(drive.id, index, false); // No animation for bulk reorder
        }
    });
    
    // Update drives array order
    drives = sorted;
}

function updateSortUI() {
    // Update active state and arrows in submenu
    sortSubmenu.querySelectorAll('.list-submenu-item').forEach(item => {
        const sort = item.dataset.sort;
        const isActive = sort === sortField;
        item.classList.toggle('active', isActive);
        
        const arrowEl = item.querySelector('.sort-arrow');
        if (arrowEl && sort !== 'reorder') {
            if (sort === sortField && sort !== 'custom') {
                arrowEl.textContent = sortDirection === 'desc' ? '↓' : '↑';
            } else {
                arrowEl.textContent = '';
            }
        }
    });
}

function enableReorderMode() {
    isReorderMode = true;
    scrollList.setReorderMode(true);
    listMenuBtn.classList.add('reorder-active');
    showToast('Drag to reorder • Click menu button to save', 'info');
}

function disableReorderMode() {
    if (!isReorderMode) return;
    isReorderMode = false;
    scrollList.setReorderMode(false);
    listMenuBtn.classList.remove('reorder-active');
}

// Listen for manual reorder events from ScrollList
function bindScrollListEvents() {
    scrollList.on('slot:reordered', ({ id, fromIndex, toIndex }) => {
        // User manually reordered - update drives array to match new order
        // (sortField will be set to 'custom' when user exits reorder mode)
        if (isReorderMode) {
            const slotIds = scrollList.getSlotIds();
            drives = slotIds.map(id => drives.find(d => d.id === id)).filter(Boolean);
        }
    });
}

// ─── Peer connection ledger ─────────────────────────────────────────────
// Per-drive record of who we are (or were) connected to, for the File Info
// panel. Kept in the renderer only: it is presentation state, and the
// engine already owns the authoritative peer count.
//   { active: Map<publicKey, connectedAt>, lastKey, lastAt, lastEndedAt }
const peerLedger = new Map();

function recordPeerConnection(driveId, data, connected) {
    if (!driveId) return;
    let rec = peerLedger.get(driveId);
    if (!rec) {
        rec = { active: new Map(), lastKey: null, lastAt: null, lastEndedAt: null };
        peerLedger.set(driveId, rec);
    }
    // Fall back to peerId when a peer arrives without a key (rare, but the
    // engine tolerates it, so this must too).
    const key = data.publicKey || data.peerId || null;
    const at = data.at || Date.now();
    if (connected) {
        if (key) rec.active.set(key, at);
        rec.lastKey = key;
        rec.lastAt = at;
    } else {
        if (key) rec.active.delete(key);
        rec.lastEndedAt = at;
    }
}

// Drives the user has cancelled. Progress events for these are dropped so
// the bar and percentage freeze the instant Cancel is pressed, instead of
// ticking upward while the backend unwinds.
const cancellingDrives = new Set();

/**
 * Show the "Cancelling…" overlay on a slot. Same shape as the delete
 * countdown's final state — the row dims and one clear label takes over —
 * but with no timer and no undo: cancelling is immediate.
 */
function showCancellingOverlay(driveId) {
    const slotData = scrollList && scrollList._slots && scrollList._slots.get(driveId);
    if (!slotData || !slotData.slot) return;
    const slot = slotData.slot;
    if (slot.querySelector('.drive-cancel-overlay')) return;

    slot.classList.add('is-deleting-now');
    const overlay = document.createElement('div');
    overlay.className = 'drive-delete-countdown drive-cancel-overlay is-final';
    overlay.innerHTML = '<span class="drive-cancel-label">Cancelling…</span>';
    slot.appendChild(overlay);
}

function clearCancellingOverlay(driveId) {
    cancellingDrives.delete(driveId);
    const slotData = scrollList && scrollList._slots && scrollList._slots.get(driveId);
    if (!slotData || !slotData.slot) return;
    slotData.slot.classList.remove('is-deleting-now');
    const overlay = slotData.slot.querySelector('.drive-cancel-overlay');
    if (overlay) overlay.remove();
}

/**
 * Remove a drive after the 5s undo window.
 *
 * The backend is not called until the timer expires, so Undo simply cancels
 * the timer — there is nothing to roll back. `deleteFiles` comes from the
 * confirm dialog's checkbox and is what actually erases the downloaded file
 * from disk; without it the row disappears but the file stays, which is how
 * duplicate copies used to pile up in the downloads folder.
 */
function startRemoveCountdown(data, deleteFiles) {
    startDeletionCountdown(data.id, {
        onExpire: async () => {
            const result = await driveActions.handle('remove', data, { deleteFiles: !!deleteFiles });
            // Backend always emits 'drives-updated' { action: 'removed' },
            // which removes the slot via the exit animation. `success` can be
            // false for benign reasons (an orphan drive missing from the
            // manifest), so only surface a toast on a real error.
            if (!result.success && result.error) {
                cancelDeletionCountdown(data.id);
                showToast('Delete failed: ' + result.error, 'error');
            } else if (deleteFiles) {
                showToast('Removed and deleted from disk');
            }
        }
        // onUndo intentionally omitted — the backend was never called.
    });
}

// ============================================================================
// CONFIRM DIALOG
// ============================================================================

function showConfirm({ title, message, buttons, checkbox }) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;

    // Optional opt-in row. `checkbox` = { label, sub, checked }. Its state
    // is passed to each button's action, so callers don't have to reach
    // into the DOM.
    const checkRow = document.getElementById('confirmCheck');
    const checkInput = document.getElementById('confirmCheckInput');
    const checkLabel = document.getElementById('confirmCheckLabel');
    if (checkbox) {
        checkLabel.innerHTML = '';
        checkLabel.appendChild(document.createTextNode(checkbox.label || ''));
        if (checkbox.sub) {
            const sub = document.createElement('span');
            sub.className = 'confirm-check-sub';
            sub.textContent = checkbox.sub;
            checkLabel.appendChild(sub);
        }
        checkInput.checked = !!checkbox.checked;
        checkRow.classList.add('visible');
    } else {
        checkRow.classList.remove('visible');
        checkInput.checked = false;
    }

    // Clear and add buttons
    confirmButtons.innerHTML = '';
    buttons.forEach(btn => {
        const button = document.createElement('button');
        button.className = `confirm-btn ${btn.class || 'secondary'}`;
        button.textContent = btn.label;
        button.addEventListener('click', () => {
            const checked = !!checkInput.checked;
            hideConfirm();
            if (btn.action) btn.action({ checked });
        });
        confirmButtons.appendChild(button);
    });
    
    confirmOverlay.classList.add('active');
}

function hideConfirm() {
    confirmOverlay.classList.remove('active');
}

// Close confirm on overlay click
confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) hideConfirm();
});

// Close confirm on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && confirmOverlay.classList.contains('active')) {
        hideConfirm();
    }
});

// Tab clicks (future: switch between Shares/Friends)
// ============================================================================
// PAGE SWITCH — Shares vs Receive
// Mobile-UI: top tab bar (tabShares / tabReceive)
// Desktop-UI: sidebar nav (.sidebar-nav-item[data-page])
// Both routes call setActivePage(name); the data-type filter on the list and
// the top-bar swap (drop zone vs paste link) are CSS-driven.
// ============================================================================
const tabReceive = document.getElementById('tabReceive');
const appShellEl = document.querySelector('.app-shell');
const appEl = document.querySelector('.app');

function setActivePage(page) {
    if (page !== 'share' && page !== 'receive' && page !== 'allshares') return;
    if (page === currentPage) return;
    currentPage = page;
    // The view-* class swap below changes which slots are visible, so the
    // separator numbering has to be recomputed once the classes land.
    setTimeout(() => { try { reindexVisibleSlots(); } catch (_) {} }, 0);

    // "allshares" reuses the SHARE tab's layout (drop-zone visible, SHARE
    // button visible) — only the sidebar-active state and page heading
    // differ. The rest of the code below computes classes from this
    // effective-layout choice, not from `page` directly.
    const layoutPage = page === 'allshares' ? 'share' : page;

    // Sidebar active state — only touches share/receive/allshares nav items
    // so unrelated items (Favorites, Settings, etc.) keep their own state.
    document.querySelectorAll('.sidebar-nav-item[data-page="share"], .sidebar-nav-item[data-page="receive"], .sidebar-nav-item[data-page="allshares"]').forEach((btn) => {
        if (btn.disabled) return;
        btn.classList.toggle('is-active', btn.dataset.page === page);
    });

    // Desktop-UI page heading
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) {
        titleEl.textContent =
            page === 'allshares' ? 'All Shares' :
            page === 'receive' ? 'Receive' : 'Shares';
    }

    // Mobile tab active state (mobile has no All Shares tab; treat it like
    // share so the "Shares" tab lights up).
    if (tabShares) tabShares.classList.toggle('active', layoutPage === 'share');
    if (tabReceive) tabReceive.classList.toggle('active', layoutPage === 'receive');

    // CSS-based filter on the drives list. Note this is SEPARATE from the
    // layout page — All Shares uses the SHARE layout but must show BOTH
    // shares and downloads, so it applies no filter class (nothing hidden).
    if (listContainer) {
        listContainer.classList.remove('view-share', 'view-receive', 'view-all');
        if (page === 'allshares') {
            listContainer.classList.add('view-all');
        } else {
            listContainer.classList.add(layoutPage === 'share' ? 'view-share' : 'view-receive');
        }
    }

    // Page class on .app — drives the top-bar swap and per-page action button.
    // All Shares applies BOTH page-share AND page-receive so every existing
    // desktop layout rule (drop-zone hero-rail AND link-input pill) fires,
    // and adds page-allshares as a marker for the one override rule that
    // re-shows the drop-zone (which page-receive normally hides).
    if (appEl) {
        appEl.classList.remove('page-share', 'page-receive', 'page-allshares');
        if (page === 'allshares') {
            appEl.classList.add('page-share', 'page-receive', 'page-allshares');
        } else {
            appEl.classList.add(layoutPage === 'share' ? 'page-share' : 'page-receive');
        }
    }
}

// Wire mobile tabs
[tabShares, tabReceive].forEach((tab) => {
    if (!tab) return;
    tab.addEventListener('click', () => setActivePage(tab.dataset.page));
});

// Wire desktop sidebar
document.querySelectorAll('.sidebar-nav-item').forEach((btn) => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page === 'share' || page === 'receive' || page === 'allshares') setActivePage(page);
    });
});

// ============================================================================
// All Shares mode switch — segmented pill above the boxes on the All Shares
// page that toggles between the drop-zone (send) and the link-input pill
// (receive). Persisted on .app as .mode-send / .mode-receive; the classes
// have no effect unless .page-allshares is also present, so switching to
// Share/Receive tabs leaves the mode intact for next return to All Shares.
// ============================================================================
function setAllsharesMode(mode) {
    if (!appEl) return;
    if (mode !== 'send' && mode !== 'receive') return;
    appEl.classList.remove('mode-send', 'mode-receive');
    appEl.classList.add(mode === 'send' ? 'mode-send' : 'mode-receive');
    document.querySelectorAll('.mode-tab').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });
}
document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => setAllsharesMode(btn.dataset.mode));
});
setAllsharesMode('send'); // default

// Initial page — "All Shares" is the default landing tab. setActivePage
// applies every class needed (page-share on .app, view-all on the list
// container, sidebar-active on the nav item), so no fallback class-adds
// afterward — the old fallback only knew about view-share/view-receive
// and was re-adding view-share on top of view-all, which then hid every
// download on cold start.
setActivePage('allshares');

// ============================================================================
// DESKTOP v2 SHELL — top-bar tabs (Shares / Favorites) and Send / Receive /
// gear buttons. Visual shell only for now — modals and full behavior come
// in later steps. Kept lightweight so this file doesn't grow before we
// actually know the modal contract.
// ============================================================================
(function bindDesktopTopBarV2() {
    const tabs = document.querySelectorAll('.top-tab');
    tabs.forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            if (!target) return;
            tabs.forEach((t) => {
                const isActive = t.dataset.tab === target;
                t.classList.toggle('is-active', isActive);
                t.setAttribute('aria-selected', isActive ? 'true' : 'false');
            });
            // Filter the list. Favourites live in localStorage
            // (favoritesSet), so this needs nothing from the backend.
            // Purely a class swap — the CSS does the hiding, so no
            // re-render and no scroll-position loss.
            if (listContainer) {
                listContainer.classList.toggle('view-favorites', target === 'favorites');
            }
            const pageTitle = document.getElementById('pageTitle');
            if (pageTitle) {
                pageTitle.textContent = target === 'favorites' ? 'Favorites' : 'Shares';
            }
            reindexVisibleSlots();
        });
    });

    // Send modal wiring — two-state flow:
    //   State A: Add Files hero card. Click → open native file picker
    //            (modal stays open). Picker returns → activeFiles gets
    //            populated by handleFiles → we render State B into the
    //            same modal.
    //   State B: file list + Share button. Click Share → startShare()
    //            fires, existing shareModal appears with QR + link,
    //            Send modal closes.
    const sendBtn = document.getElementById('topSendBtn');
    const sendModalOverlay = document.getElementById('sendModalOverlay');
    const sendModalClose = document.getElementById('sendModalCloseBtn');
    const sendAddFilesCard = document.getElementById('sendAddFilesCard');
    const sendFileReview = document.getElementById('sendFileReview');
    const sendFileReviewTitle = document.getElementById('sendFileReviewTitle');
    const sendFileReviewList = document.getElementById('sendFileReviewList');
    const sendFileReviewClearBtn = document.getElementById('sendFileReviewClearBtn');
    const sendShareBtn = document.getElementById('sendShareBtn');
    const sendModalInner = sendModalOverlay?.querySelector('.send-modal');

    function fmtBytes(n) {
        if (!n || n <= 0) return '0 B';
        const u = ['B','KB','MB','GB','TB'];
        let i = 0, v = n;
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
        return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
    }
    function iconForType(f) {
        const n = (f?.name || '').toLowerCase();
        if (f?.fileCount > 0 || f?.type === 'folder') return '📁';
        if (/\.(png|jpg|jpeg|gif|webp|bmp|svg|heic)$/.test(n)) return '🖼️';
        if (/\.(mp4|mov|avi|mkv|webm)$/.test(n)) return '🎬';
        if (/\.(mp3|wav|flac|m4a|ogg)$/.test(n)) return '🎵';
        if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return '🗜️';
        if (/\.(pdf)$/.test(n)) return '📄';
        return '📎';
    }

    function escapeHtml(s) {
        return (s || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    }

    function renderSendFileReview() {
        if (!sendFileReview || !sendFileReviewList || !sendFileReviewTitle) return;
        // `activeFiles` is a top-level renderer.js var populated by handleFiles.
        const files = (typeof activeFiles !== 'undefined' && Array.isArray(activeFiles)) ? activeFiles : [];
        if (files.length === 0) {
            sendFileReview.classList.remove('active');
            sendModalInner?.classList.remove('has-files');
            return;
        }
        const total = files.reduce((s, f) => s + (f.size || 0), 0);
        sendFileReviewTitle.textContent = files.length === 1
            ? `1 file · ${fmtBytes(total)}`
            : `${files.length} files · ${fmtBytes(total)}`;
        // Each row gets a Cancel-send button that removes just that file.
        // data-idx targets the array index; click handler is attached
        // below via delegation for the whole list.
        sendFileReviewList.innerHTML = files.map((f, i) => `
            <div class="send-file-review-item">
                <div class="send-file-review-item-icon" aria-hidden="true">${iconForType(f)}</div>
                <div class="send-file-review-item-info">
                    <div class="send-file-review-item-name">${escapeHtml(f.name)}</div>
                    <div class="send-file-review-item-size">${f.fileCount > 1 ? f.fileCount + ' files · ' : ''}${fmtBytes(f.size)}</div>
                </div>
                <button type="button" class="send-file-review-item-cancel" data-idx="${i}" title="Cancel send for this file">
                    <span class="send-file-review-item-cancel-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </span>
                    Cancel send
                </button>
            </div>
        `).join('');
        sendFileReview.classList.add('active');
        sendModalInner?.classList.add('has-files');
    }

    // Delegated click handler for per-file Cancel-send buttons.
    if (sendFileReviewList) {
        sendFileReviewList.addEventListener('click', (e) => {
            const btn = e.target.closest('.send-file-review-item-cancel');
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx, 10);
            if (typeof activeFiles === 'undefined' || !Array.isArray(activeFiles)) return;
            if (Number.isNaN(idx) || idx < 0 || idx >= activeFiles.length) return;
            activeFiles.splice(idx, 1);
            // If no files left, also reset the hidden drop-zone preview
            // state so the SHARE button (which mirrors activeFiles) disables.
            if (activeFiles.length === 0 && typeof clearFiles === 'function') {
                clearFiles();
            }
            renderSendFileReview();
        });
    }

    // ---- Recent Shares (2-column grid, capped at 4) ----
    // Renders under the primary action in the Send modal. Populated from
    // the top-level `drives` array filtered to type='share'. Cap at 4
    // matches the Figma (fits cleanly in a 2×2 grid). Each item shows
    // a real file thumbnail (fetched via getFileThumbnail IPC — falls
    // back to a type-emoji if no path/preview available) + a two-line
    // info block (filename + "type · status" subtitle) + Link button.
    function categoryFromName(name) {
        const n = (name || '').toLowerCase();
        if (/\.(png|jpg|jpeg|gif|webp|bmp|svg|heic)$/.test(n)) return 'Picture';
        if (/\.(mp4|mov|avi|mkv|webm)$/.test(n)) return 'Video';
        if (/\.(mp3|wav|flac|m4a|ogg)$/.test(n)) return 'Music';
        if (/\.(pdf)$/.test(n)) return 'PDF';
        if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return 'Archive';
        return 'File';
    }
    function humanStatus(d) {
        // Map internal drive.status to a user-visible label matching
        // the Figma badges (Sharing, Active, Completed, etc.).
        const s = (d.status || '').toLowerCase();
        if (s === 'sharing' || s === 'seeding') return 'Sharing';
        if (s === 'downloading') return 'Downloading';
        if (s === 'complete' || s === 'completed' || s === 'downloaded') return 'Completed';
        if (s === 'error' || s === 'failed') return 'Failed';
        if (s === 'inactive') return 'Inactive';
        return 'Active';
    }
    function renderSendRecentShares() {
        const section = document.getElementById('sendRecentSection');
        const grid = document.getElementById('sendRecentGrid');
        if (!section || !grid) return;
        const all = (typeof drives !== 'undefined' && Array.isArray(drives)) ? drives : [];
        // SENDS ONLY — never receives. Note this can't whitelist 'share'
        // alone: drives restored from the backend manifest come back as
        // type 'upload' (see the check at line ~337), so a strict
        // === 'share' test silently dropped every share from a previous
        // session. Excluding downloads is the same rule addDriveToList
        // uses when tagging slots, so the two always agree.
        // Cap at 4 — matches the Figma (2×2 grid, up to 4 most-recent).
        const shares = all.filter(d => d.type !== 'download').slice(0, 4);
        section.classList.add('active');
        if (shares.length === 0) {
            section.classList.add('is-empty');
            grid.innerHTML = '';
            return;
        }
        section.classList.remove('is-empty');
        // Same iOS Files.app folder used by the main list's cards, so the
        // two surfaces don't drift into different icon languages.
        const FOLDER_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M3.4 4h4.2a1.6 1.6 0 0 1 1.13.47L10 5.5h-7V5.6A1.6 1.6 0 0 1 3.4 4z"/><path d="M2 8.4a1.6 1.6 0 0 1 1.6-1.6h16.8A1.6 1.6 0 0 1 22 8.4v10.2A1.4 1.4 0 0 1 20.6 20H3.4A1.4 1.4 0 0 1 2 18.6z"/></svg>';

        grid.innerHTML = shares.map((d, i) => {
            const isFolder = (d.fileCount || 0) > 1 || d.type === 'folder';
            const category = isFolder ? 'Folder' : categoryFromName(d.title);
            const status = humanStatus(d);
            // Real SVG icons rather than the old emoji fallback — same
            // getFileIconSvg() the drive-item cards use, so category tints
            // match exactly.
            let fallbackIcon;
            if (isFolder) {
                fallbackIcon = `<span class="send-recent-thumb-folder">${FOLDER_SVG}</span>`;
            } else {
                const ic = window.PearUtils?.getFileIconSvg?.(d.title);
                fallbackIcon = ic
                    ? `<span class="send-recent-thumb-fileicon" style="color:${ic.color}">${ic.svg}</span>`
                    : '';
            }
            return `
                <div class="send-recent-item" data-drive-id="${escapeHtml(d.id)}" data-col="${i % 2 === 0 ? 'left' : 'right'}" data-idx="${i}">
                    <div class="send-recent-item-thumb${isFolder ? ' is-folder' : ''}" data-drive-id="${escapeHtml(d.id)}" aria-hidden="true">${fallbackIcon}</div>
                    <div class="send-recent-item-info">
                        <div class="send-recent-item-name">${escapeHtml(d.title)}</div>
                        <div class="send-recent-item-subtitle">${escapeHtml(category)} · <span class="send-recent-item-subtitle-status">${escapeHtml(status)}</span></div>
                    </div>
                    <button type="button" class="send-recent-item-link" data-drive-id="${escapeHtml(d.id)}" data-share-link="${escapeHtml(d.shareLink || '')}">Link</button>
                </div>
            `;
        }).join('');
        // Load real thumbnails asynchronously — the emoji fallback shows
        // instantly, then swaps in when the IPC returns. Same infra used
        // by the drive-item list for consistency.
        shares.forEach((d) => {
            // Folders keep the folder icon — the list does the same. Using
            // files[0] here meant a folder showed its first file's preview.
            const isFolder = (d.fileCount || 0) > 1 || d.type === 'folder';
            if (isFolder) return;

            const path = d.files?.[0]?.path;
            if (!path || !window.electronAPI?.getFileThumbnail) return;
            window.electronAPI.getFileThumbnail(path).then((res) => {
                // ONLY real image previews. main.js also returns
                // { kind: 'icon' } — a Windows shell icon — and swapping
                // that in replaced the category-tinted SVG with a generic
                // OS glyph, which is why these stopped matching the list.
                // The drives list rejects 'icon' for the same reason.
                if (!res || res.kind !== 'image' || !res.src) return;
                const thumbEl = grid.querySelector(`.send-recent-item-thumb[data-drive-id="${d.id}"]`);
                if (thumbEl) {
                    thumbEl.innerHTML = `<img src="${res.src}" alt="">`;
                    thumbEl.classList.remove('is-folder');
                }
            }).catch(() => {});
        });
    }

    // Delegated click handler for Recent Shares "Link" buttons — copies
    // the drive's peardrop:// link to the clipboard.
    const sendRecentGrid = document.getElementById('sendRecentGrid');
    if (sendRecentGrid) {
        sendRecentGrid.addEventListener('click', async (e) => {
            const btn = e.target.closest('.send-recent-item-link');
            if (!btn) return;
            const link = btn.dataset.shareLink;
            if (!link) return;
            try {
                await navigator.clipboard.writeText(link);
                if (typeof showToast === 'function') showToast('Link copied', 'success');
            } catch {
                if (typeof showToast === 'function') showToast('Copy failed', 'error');
            }
        });
    }

    function openSendModal() {
        if (!sendModalOverlay) return;
        renderSendFileReview();     // refresh state B based on activeFiles
        renderSendRecentShares();   // refresh recent-shares grid from drives
        sendModalOverlay.classList.add('active');
    }
    function closeSendModal() {
        if (!sendModalOverlay) return;
        sendModalOverlay.classList.remove('active');
    }

    // Exposed so the share-progress controller can reopen the modal from
    // the background pill, and skip re-rendering State A/B mid-share.
    window.openSendModal  = openSendModal;
    window.closeSendModal = closeSendModal;

    if (sendBtn) sendBtn.addEventListener('click', openSendModal);
    if (sendModalClose) sendModalClose.addEventListener('click', closeSendModal);
    if (sendModalOverlay) {
        sendModalOverlay.addEventListener('click', (e) => {
            if (e.target === sendModalOverlay) closeSendModal();
        });
    }

    // Add Files card — open native picker without closing the modal.
    // After the picker returns and handleFiles finishes populating
    // activeFiles, we re-render the modal into State B.
    if (sendAddFilesCard) {
        sendAddFilesCard.addEventListener('click', () => {
            // force: the picker must reopen even when files are already
            // staged, so the card can add more.
            if (typeof selectFiles === 'function') selectFiles({ force: true });
        });
    }

    // Re-render the modal whenever the selection changes, from ANY source:
    // the picker (however long the user browses), a drag-drop, or Clear all.
    document.addEventListener('activefiles-changed', () => {
        if (sendModalOverlay?.classList.contains('active')) renderSendFileReview();
    });

    // "Change files" — clear the current selection and go back to State A.
    if (sendFileReviewClearBtn) {
        sendFileReviewClearBtn.addEventListener('click', () => {
            if (typeof clearFiles === 'function') clearFiles();
            renderSendFileReview();
        });
    }

    // Share button — fires the existing startShare(). It handles the
    // whole share flow and pops the existing shareModal with QR + link.
    // We close the Send modal as we hand off.
    if (sendShareBtn) {
        sendShareBtn.addEventListener('click', () => {
            // Modal STAYS OPEN — startShare() flips it into State C
            // (progress) and swaps to the Share Link modal when the drive
            // finishes building. Closing here left the user staring at a
            // blank screen for the whole build.
            if (typeof startShare === 'function') startShare();
        });
    }

    // Receive modal wiring — top-right "↓ Receive" button opens the
    // modal. Paste button reads the input and pipes into the existing
    // startDownload flow via linkInput. QR area launches the existing
    // openQrScanner. Import QR image triggers the existing #qrFileInput.
    const receiveBtn = document.getElementById('topReceiveBtn');
    const receiveModalOverlay = document.getElementById('receiveModalOverlay');
    const receiveModalClose = document.getElementById('receiveModalCloseBtn');
    const receivePasteInput = document.getElementById('receivePasteInput');
    const receivePasteBtn = document.getElementById('receivePasteBtn');
    const receiveQrArea = document.getElementById('receiveQrArea');
    const receiveImportQrBtn = document.getElementById('receiveImportQrBtn');

    function openReceiveModal() {
        if (!receiveModalOverlay) return;
        receiveModalOverlay.classList.add('active');
        // Reset the field and the button label. Close already does this, but
        // the QR sub-flow can re-enter without one, and a stale "Download"
        // sitting over an empty field would do nothing when pressed.
        if (receivePasteInput) receivePasteInput.value = '';
        updateReceiveLinkHint();
        if (receivePasteInput) receivePasteInput.focus();
    }
    function closeReceiveModal() {
        if (!receiveModalOverlay) return;
        receiveModalOverlay.classList.remove('active');
        if (receivePasteInput) receivePasteInput.value = '';
        if (typeof updateReceiveLinkHint === 'function') updateReceiveLinkHint();
    }

    if (receiveBtn) receiveBtn.addEventListener('click', openReceiveModal);
    if (receiveModalClose) receiveModalClose.addEventListener('click', closeReceiveModal);
    if (receiveModalOverlay) {
        receiveModalOverlay.addEventListener('click', (e) => {
            if (e.target === receiveModalOverlay) closeReceiveModal();
        });
    }

    // Paste-and-download: pipe into the existing startDownload which
    // reads linkInput.value + runs the full duplicate-check → open →
    // download flow. Keeps all validation/error-handling in one place.
    function submitReceiveLink() {
        if (!receivePasteInput) return;
        const raw = receivePasteInput.value.trim();
        if (!raw) {
            receivePasteInput.focus();
            return;
        }
        // Hand the engine the EXTRACTED link, never the raw field. Pasting a
        // chat line ("here you go peardrop://ab12… enjoy") used to send the
        // whole sentence downstream and fail with a vague error.
        const link = extractPeardropLink(raw);
        if (!link) {
            updateReceiveLinkHint();
            receivePasteInput.focus();
            return;
        }
        // Enter must not walk past a link we already know is a duplicate —
        // the button says "Show in list" for a reason.
        if (receiveBtnState === 'existing') {
            const id = receiveExistingId;
            closeReceiveModal();
            if (id && typeof highlightExistingDrive === 'function') {
                highlightExistingDrive(id);
            }
            return;
        }
        // Existing startDownload reads from #linkInput — set it, then fire.
        if (linkInput) linkInput.value = link;
        closeReceiveModal();
        if (typeof startDownload === 'function') startDownload();
    }
    // Live link validation. Uses the SAME pattern startDownload() checks
    // against, so the hint can never promise something the download then
    // rejects — a loose startsWith('peardrop://') would say "press Enter"
    // for a key of the wrong length.
    const receiveLinkHint = document.getElementById('receiveLinkHint');
    const PEARDROP_LINK_RE = /peardrop:\/\/[a-f0-9]{64}/i;

    /**
     * Pull a usable link out of whatever was pasted.
     *
     * People rarely paste a bare link — it arrives inside a chat message, or
     * line-wrapped by an email client, which splits the key across a newline
     * and stops it matching at all. Whitespace is stripped before matching,
     * and the MATCH is returned rather than the raw string, so surrounding
     * words never reach the engine.
     *
     * Lower-cased because the key is hex and downstream comparisons (the
     * duplicate check) are string equality.
     */
    function extractPeardropLink(raw) {
        const compact = String(raw || '').replace(/\s+/g, '');
        const m = compact.match(PEARDROP_LINK_RE);
        return m ? m[0].toLowerCase() : null;
    }

    // The paste button is a three-state control:
    //   empty input        -> "Paste"     (read the clipboard)
    //   valid link         -> "Download"  (start the transfer)
    //   anything else      -> "Clear"     (empty the field and start over)
    // Enter in the field still submits regardless, because some people will
    // always reach for it and taking that away would be a downgrade.
    let receiveBtnState = 'paste';
    // Drive id behind an 'existing' state, for "Show in list".
    let receiveExistingId = null;
    // Guards against a slow duplicate-check answering for a link the user
    // has already typed past. Only the newest request may touch the UI.
    let receiveCheckToken = 0;
    let receiveCheckTimer = null;

    function updateReceiveButton(state) {
        receiveBtnState = state;
        if (!receivePasteBtn) return;
        receivePasteBtn.classList.remove('is-download', 'is-clear', 'is-existing');
        if (state === 'download') {
            receivePasteBtn.textContent = 'Download';
            receivePasteBtn.classList.add('is-download');
        } else if (state === 'clear') {
            receivePasteBtn.textContent = 'Clear';
            receivePasteBtn.classList.add('is-clear');
        } else if (state === 'existing') {
            receivePasteBtn.textContent = 'Show in list';
            receivePasteBtn.classList.add('is-existing');
        } else {
            receivePasteBtn.textContent = 'Paste';
        }
    }

    /**
     * A link can be well-formed and still not worth downloading: it may be
     * YOUR OWN share, or something already in your list. Both were only
     * discovered after pressing Download, when the modal had already closed
     * and the refusal arrived as a toast with no context.
     *
     * Answering here means the message appears under the field, beside the
     * link it is about, before anything is committed.
     */
    async function checkReceiveDuplicate(link) {
        if (!window.electronAPI?.hyperdriveCheckDuplicate) return;
        const token = ++receiveCheckToken;
        let res;
        try {
            res = await window.electronAPI.hyperdriveCheckDuplicate({ shareLink: link });
        } catch (_) {
            return;   // check unavailable — leave the optimistic state alone
        }
        // The field moved on while we were waiting.
        if (token !== receiveCheckToken) return;
        if (!res || !res.isDuplicate) return;
        // And it still holds the same link.
        if (extractPeardropLink(receivePasteInput.value) !== link) return;

        const entry = res.existingDrive || {};
        const isOwnShare = entry.isUpload !== false;
        const filesGone = res.localStatus === 'missing';

        if (receiveLinkHint) {
            receiveLinkHint.classList.remove('is-valid', 'is-invalid');
            receiveLinkHint.classList.add('is-warn');
            receiveLinkHint.textContent = isOwnShare
                ? 'This is your own share — it is already in your list'
                : filesGone
                    ? 'Already in your list, but its files were removed'
                    : 'You have already downloaded this';
        }
        receiveExistingId = res.driveId || entry.id || null;
        updateReceiveButton('existing');
    }

    function updateReceiveLinkHint() {
        if (!receivePasteInput) return;
        const raw = receivePasteInput.value.trim();
        if (receiveLinkHint) receiveLinkHint.classList.remove('is-valid', 'is-invalid', 'is-warn');

        // Any edit invalidates an in-flight check and any stored result.
        receiveCheckToken++;
        receiveExistingId = null;
        if (receiveCheckTimer) { clearTimeout(receiveCheckTimer); receiveCheckTimer = null; }

        if (!raw) {
            if (receiveLinkHint) receiveLinkHint.textContent = '';
            updateReceiveButton('paste');
            return;
        }
        const link = extractPeardropLink(raw);
        if (link) {
            if (receiveLinkHint) {
                receiveLinkHint.textContent = 'Press Enter to download';
                receiveLinkHint.classList.add('is-valid');
            }
            updateReceiveButton('download');
            // Debounced so typing a link character by character does not fire
            // a check per keystroke. Optimistic in the meantime: startDownload
            // runs the same check anyway, so a hurried Enter is still refused.
            // Debounced so typing a link character by character does not fire
            // a check per keystroke. Optimistic in the meantime: startDownload
            // runs the same check anyway, so a hurried Enter is still refused.
            receiveCheckTimer = setTimeout(() => checkReceiveDuplicate(link), 200);
        } else {
            if (receiveLinkHint) {
                receiveLinkHint.textContent = raw.toLowerCase().includes('peardrop://')
                    ? 'Invalid link — the key must be exactly 64 characters'
                    : 'Invalid link';
                receiveLinkHint.classList.add('is-invalid');
            }
            updateReceiveButton('clear');
        }
    }

    if (receivePasteInput) {
        receivePasteInput.addEventListener('input', updateReceiveLinkHint);
    }

    // "Paste" pastes. It was wired directly to submitReceiveLink, so it
    // skipped the input entirely and started the download — leaving no way
    // to see or correct the link first.
    if (receivePasteBtn) {
        receivePasteBtn.addEventListener('click', async () => {
            // Download: the field already holds a good link.
            if (receiveBtnState === 'download') {
                submitReceiveLink();
                return;
            }
            // Already have it: take them to the row instead of fetching it
            // again. Closing first so the highlight is actually visible.
            if (receiveBtnState === 'existing') {
                const id = receiveExistingId;
                closeReceiveModal();
                if (id && typeof highlightExistingDrive === 'function') {
                    highlightExistingDrive(id);
                }
                return;
            }
            // Clear: the field holds something unusable. Empty it and put
            // the caret back so the next attempt costs nothing.
            if (receiveBtnState === 'clear') {
                receivePasteInput.value = '';
                updateReceiveLinkHint();
                receivePasteInput.focus();
                return;
            }
            try {
                const text = (await navigator.clipboard.readText() || '').trim();
                if (!text) {
                    showToast('Clipboard is empty', 'error');
                    return;
                }
                receivePasteInput.value = text;
                receivePasteInput.focus();
                // Put the caret at the end rather than selecting everything,
                // so the next keystroke doesn't wipe what was just pasted.
                receivePasteInput.setSelectionRange(text.length, text.length);
                updateReceiveLinkHint();
            } catch (err) {
                // Clipboard read can be refused; typing or Ctrl+V still work.
                showToast('Could not read the clipboard', 'error');
            }
        });
    }
    if (receivePasteInput) {
        receivePasteInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitReceiveLink();
        });
    }

    // QR area → open existing QR scanner (camera + file picker in one modal).
    // The Receive modal STAYS OPEN behind the scanner — the scanner is a
    // sub-flow of Receive, not a replacement. On a successful scan we DO
    // close Receive, because the scan itself hands the link back and the
    // download starts immediately (nothing left for Receive to do).
    if (receiveQrArea) {
        receiveQrArea.addEventListener('click', () => {
            if (typeof window.openQrScanner === 'function') {
                window.openQrScanner({
                    onResult: (text) => {
                        // A QR can encode anything; only act on a real link.
                        // Previously any scanned text was pushed straight
                        // into startDownload, which failed deeper in with a
                        // vague error.
                        const match = String(text || '').match(/peardrop:\/\/[a-f0-9]{64}/i);
                        if (!match) {
                            showToast('That QR code is not a PearDrop link', 'error');
                            return;
                        }
                        if (linkInput) linkInput.value = match[0];
                        closeReceiveModal();
                        if (typeof startDownload === 'function') startDownload();
                    }
                });
            }
        });
    }

    // "Import QRcode Image" → decode a QR out of a picture the user already
    // has, without opening the camera.
    //
    // This used to click #qrFileInput directly. That element belongs to the
    // qr-scanner module and its decode listener is bound in that module's
    // init(), which only runs when the CAMERA scanner is opened — so on a
    // cold app the button silently did nothing. Going through pickQrFile()
    // keeps the input's ownership where it belongs.
    if (receiveImportQrBtn) {
        receiveImportQrBtn.addEventListener('click', () => {
            if (typeof window.pickQrFile !== 'function') return;
            window.pickQrFile({
                onResult: (text) => {
                    // Same handling as the camera path, so both routes into
                    // Receive behave identically.
                    const match = String(text || '').match(/peardrop:\/\/[a-f0-9]{64}/i);
                    if (!match) {
                        showToast('That image has no PearDrop link in it', 'error');
                        return;
                    }
                    if (linkInput) linkInput.value = match[0];
                    closeReceiveModal();
                    if (typeof startDownload === 'function') startDownload();
                }
            });
        });
    }

    // Settings page wiring — gear button opens the full-page overlay,
    // back arrow closes it. Version number is pulled from the same
    // IPC handler the reset-notice uses (get-app-version).
    const settingsBtn = document.getElementById('topSettingsBtn');
    const settingsPage = document.getElementById('settingsPage');
    const settingsBackBtn = document.getElementById('settingsBackBtn');
    const settingsAboutVersion = document.getElementById('settingsAboutVersion');

    function openSettingsPage() {
        if (!settingsPage) return;
        settingsPage.classList.add('active');
    }
    function closeSettingsPage() {
        if (!settingsPage) return;
        settingsPage.classList.remove('active');
    }

    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsPage);
    if (settingsBackBtn) settingsBackBtn.addEventListener('click', closeSettingsPage);

    // Populate the About row's version from the live app version.
    if (settingsAboutVersion && window.electronAPI?.getAppVersion) {
        window.electronAPI.getAppVersion().then((v) => {
            if (typeof v === 'string') settingsAboutVersion.textContent = 'v' + v;
        }).catch(() => { /* leave placeholder */ });
    }

    // Report a bug page — reached from Settings → Report a bug row.
    // Back arrow returns to Settings. Send Report currently just shows
    // a confirmation toast (no backend endpoint wired yet).
    const reportBugPage = document.getElementById('reportBugPage');
    const reportBugBackBtn = document.getElementById('reportBugBackBtn');
    const settingsReportBugBtn = document.getElementById('settingsReportBugBtn');
    const bugDescription = document.getElementById('bugDescription');
    const bugCharCount = document.getElementById('bugCharCount');
    const bugTagVersion = document.getElementById('bugTagVersion');
    const bugTagOS = document.getElementById('bugTagOS');
    const bugSendReportBtn = document.getElementById('bugSendReportBtn');

    function openReportBugPage() {
        if (!reportBugPage) return;
        // Close Settings first so back-arrow returns cleanly to app.
        closeSettingsPage();
        reportBugPage.classList.add('active');
    }
    function closeReportBugPage() {
        if (!reportBugPage) return;
        reportBugPage.classList.remove('active');
    }

    if (settingsReportBugBtn) settingsReportBugBtn.addEventListener('click', openReportBugPage);
    if (reportBugBackBtn) reportBugBackBtn.addEventListener('click', closeReportBugPage);

    // Live character counter — matches the /500 shown at bottom-right of
    // the textarea. maxlength attribute already prevents exceeding 500.
    if (bugDescription && bugCharCount) {
        bugDescription.addEventListener('input', () => {
            bugCharCount.textContent = String(bugDescription.value.length);
        });
    }

    // Populate version + OS tags shown next to "Attach device info".
    if (bugTagVersion && window.electronAPI?.getAppVersion) {
        window.electronAPI.getAppVersion().then((v) => {
            if (typeof v === 'string') bugTagVersion.textContent = 'v' + v;
        }).catch(() => {});
    }
    if (bugTagOS) {
        // navigator.userAgentData is Chromium-only; falls back to the
        // classic userAgent string if not available.
        const ua = navigator.userAgentData?.platform || navigator.platform || '';
        let os = 'Unknown';
        if (/win/i.test(ua)) os = 'Windows';
        else if (/mac/i.test(ua)) os = 'macOS';
        else if (/linux/i.test(ua)) os = 'Linux';
        bugTagOS.textContent = os;
    }

    // Send Report — MVP just closes the page + shows a confirmation
    // toast. Real submission endpoint TBD (see mockup screen 10 for
    // the follow-up "Report sent" confirmation state).
    if (bugSendReportBtn) {
        bugSendReportBtn.addEventListener('click', () => {
            closeReportBugPage();
            if (bugDescription) bugDescription.value = '';
            if (bugCharCount) bugCharCount.textContent = '0';
            const locInput = document.getElementById('bugLocation');
            if (locInput) locInput.value = '';
            if (typeof showToast === 'function') {
                showToast('Report sent — thanks for the feedback', 'success');
            }
        });
    }

    // ─── File Info Modal (Desktop v2, Figma screen #19) ─────────────
    // Opened from a drive card's 3-dot menu → Properties. Reads from
    // the canonical File Info modal DOM in index.html and populates it
    // from a merged (event.data + stored drive) object.
    const fileInfoOverlay  = document.getElementById('fileInfoModalOverlay');
    const fileInfoModalEl  = fileInfoOverlay?.querySelector('.file-info-modal');
    const fileInfoNameEl   = document.getElementById('fileInfoName');
    const fileInfoSubEl    = document.getElementById('fileInfoSub');
    const fileInfoThumbEl  = document.getElementById('fileInfoThumb');
    const fileInfoGridEl   = document.getElementById('fileInfoGrid');
    const fileInfoQrBtn    = document.getElementById('fileInfoQrBtn');
    // Link for the footer buttons. Tracked here rather than read back from
    // the DOM, since it is no longer rendered anywhere.
    let currentInfoLink = '';
    const fileInfoCopyBtn  = document.getElementById('fileInfoCopyBtn');
    const fileInfoCloseBtn = document.getElementById('fileInfoCloseBtn');
    const fileInfoDoneBtn  = document.getElementById('fileInfoDoneBtn');

    // Human-readable time-ago for the "Added" row. Falls back to a locale
    // date string if the timestamp is > 30 days old.
    // "Jul 01, 2026" — the absolute date the Figma shows for Added. timeAgo
    // stays for the Connection rows, where "2m ago" is the useful reading.
    function formatDate(ts) {
        if (!ts) return '—';
        const d = new Date(ts);
        if (isNaN(d.getTime())) return '—';
        const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${MONTHS[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
    }

    function timeAgo(ts) {
        if (!ts) return '—';
        const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
        if (s < 60)   return `${s}s ago`;
        if (s < 3600) return `${Math.floor(s/60)}m ago`;
        if (s < 86400) return `${Math.floor(s/3600)}h ago`;
        const d = Math.floor(s / 86400);
        if (d < 30)   return `${d}d ago`;
        return new Date(ts).toLocaleDateString();
    }

    function statusLabel(status) {
        switch (status) {
            case 'sharing':     return 'Sharing';
            case 'downloading': return 'Downloading';
            case 'complete':    return 'Complete';
            case 'error':       return 'Error';
            case 'inactive':    return 'Inactive';
            case 'connecting':  return 'Connecting';
            default:            return status || '—';
        }
    }

    function typeLabel(type) {
        if (type === 'download') return 'Download';
        if (type === 'upload' || type === 'share') return 'Share';
        return type || '—';
    }

    // Same iOS Files.app folder the drive-item cards use.
    const FOLDER_ICON_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:#6ee0d3"><path d="M3.4 4h4.2a1.6 1.6 0 0 1 1.13.47L10 5.5h-7V5.6A1.6 1.6 0 0 1 3.4 4z"/><path d="M2 8.4a1.6 1.6 0 0 1 1.6-1.6h16.8A1.6 1.6 0 0 1 22 8.4v10.2A1.4 1.4 0 0 1 20.6 20H3.4A1.4 1.4 0 0 1 2 18.6z"/></svg>';

    function openInfoModal(data) {
        if (!fileInfoOverlay || !data) return;

        const esc = (v) => window.PearUtils.escapeHtml(v == null ? '' : String(v));
        // Middle-truncate: the head and tail of a key are what people
        // compare, so keep both rather than cutting the end off.
        const truncateKey = (k) => !k ? '—'
            : (k.length <= 20 ? k : `${k.slice(0, 10)}…${k.slice(-8)}`);

        const name = data.title || data.name || data.fileName || 'Untitled';
        // PearUtils, not a bare global — the `typeof formatBytes` guard was
        // always false here, so this fell through to printing raw bytes.
        const size = window.PearUtils.formatBytes(data.size || data.totalBytes || 0);
        const fileCount = data.fileCount
            || (Array.isArray(data.files) ? data.files.length : 0)
            || 1;

        // Hero icon: cached thumbnail if we have one, else the same
        // category-tinted SVG the list uses, else the folder icon. It was a
        // fixed generic page glyph regardless of file type.
        if (fileInfoThumbEl) {
            const isGroup = (data.fileCount || 0) > 1
                || (Array.isArray(data.files) && data.files.length > 1);
            const firstPath = Array.isArray(data.files) && data.files[0] ? data.files[0].path : null;
            const cached = firstPath ? fileThumbnailCache.get(firstPath) : null;

            fileInfoThumbEl.classList.remove('is-folder', 'is-fileicon');
            if (!isGroup && cached && cached.kind === 'image' && cached.src) {
                fileInfoThumbEl.innerHTML = `<img src="${esc(cached.src)}" alt="">`;
            } else if (isGroup) {
                fileInfoThumbEl.classList.add('is-folder');
                fileInfoThumbEl.innerHTML = FOLDER_ICON_SVG;
            } else {
                const ic = window.PearUtils.getFileIconSvg
                    ? window.PearUtils.getFileIconSvg(name)
                    : null;
                if (ic) {
                    fileInfoThumbEl.classList.add('is-fileicon');
                    fileInfoThumbEl.innerHTML = `<span style="color:${ic.color}">${ic.svg}</span>`;
                }
            }
        }

        fileInfoNameEl.textContent = name;
        fileInfoSubEl.textContent  = `${typeLabel(data.type)} · ${size} · ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;

        // Sections: Details, then Share info, then Connection. Full-width
        // rules sit BETWEEN sections only, never between rows.
        const SECTION = '—section—';

        // Full path, not just the containing folder — the folder alone left
        // people unable to tell which file it referred to.
        const location = (Array.isArray(data.files) && data.files[0] && data.files[0].path)
            || data.localPath
            || null;

        const rows = [
            [SECTION, 'Details'],
            ['Size',     size],
            ['Type',     typeLabel(data.type)],
            ['Added',    formatDate(data.addedAt)],
            ['Location', location || '—', location || '']
        ];

        // Status has exactly three values:
        //   Sharing  - a peer is connected and data is moving
        //   Active   - on the network and available, nobody connected
        //   Inactive - stopped / paused / errored
        const led = peerLedger.get(data.id) || { active: new Map(), lastKey: null, lastAt: null, lastEndedAt: null };
        const activeKeys = [...led.active.keys()];
        const onNetwork = data.status === 'sharing'
            || data.status === 'downloading'
            || data.status === 'connecting'
            || data.status === 'complete';

        let shareStatus;
        if (!onNetwork) shareStatus = 'Inactive';
        else if (activeKeys.length > 0 || (data.peers || 0) > 0) shareStatus = 'Sharing';
        else shareStatus = 'Active';

        if (data.shareLink) {
            const pct = data.progress != null ? Math.round(data.progress * 100) : null;
            rows.push([SECTION, 'Share info']);
            rows.push(['Status',   shareStatus]);
            if (pct != null) rows.push(['Progress', pct + '%']);
            rows.push(['Peers', String(activeKeys.length || data.peers || 0)]);

            // Every connected peer gets a row, not just the first — a share
            // can serve several at once, and "Peers: 3" followed by a single
            // key raised the obvious question of whose key it was.
            // Numbered only when there is more than one, so the common
            // single-peer case stays clean.
            if (activeKeys.length) {
                activeKeys.forEach((k, i) => {
                    const label = activeKeys.length > 1 ? `Peer ${i + 1}` : 'Peer key';
                    rows.push([label, truncateKey(k), k]);
                    rows.push([activeKeys.length > 1 ? ` connected` : 'Connected',
                               timeAgo(led.active.get(k))]);
                });
            } else if (led.lastKey) {
                rows.push(['Last peer', truncateKey(led.lastKey), led.lastKey]);
                rows.push(['Last seen', timeAgo(led.lastEndedAt || led.lastAt)]);
            } else {
                rows.push(['Peer key', 'None connected']);
            }
        }

        let seenSection = false;
        fileInfoGridEl.innerHTML = rows.map(([label, value, fullValue]) => {
            if (label === SECTION) {
                const first = !seenSection;
                seenSection = true;
                return `<div class="file-info-section-head${first ? ' is-first' : ''}">${esc(value)}</div>`;
            }
            return `
            <div class="file-info-grid-row${label === 'Location' ? ' is-path' : ''}">
                <div class="file-info-grid-label">${esc(label)}</div>
                <div class="file-info-grid-value" title="${esc(fullValue || value)}">${esc(value)}</div>
            </div>`;
        }).join('');

        // The link is never displayed now — the footer buttons act on it.
        // Hide the whole footer when there is nothing to copy or encode
        // (a partial download before its manifest lands, an orphan row).
        const link = data.shareLink || '';
        currentInfoLink = link;
        fileInfoModalEl.classList.toggle('no-link', !link);
        const footerEl = document.getElementById('fileInfoFooter');
        if (footerEl) footerEl.style.display = link ? 'flex' : 'none';

        fileInfoCopyBtn.textContent = 'Copy Link';
        fileInfoOverlay.classList.add('active');
    }

    function closeInfoModal() {
        if (fileInfoOverlay) fileInfoOverlay.classList.remove('active');
    }

    // Export openInfoModal so the DriveItem action handler at the top of
    // renderer.js can reach it. (The handler is defined before this IIFE
    // runs, but it looks the function up at CALL time via `openInfoModal`,
    // which lives in the module scope after this assignment.)
    window.openInfoModal  = openInfoModal;
    window.closeInfoModal = closeInfoModal;

    fileInfoCloseBtn?.addEventListener('click', closeInfoModal);
    fileInfoDoneBtn?.addEventListener('click', closeInfoModal);
    fileInfoOverlay?.addEventListener('click', (e) => {
        if (e.target === fileInfoOverlay) closeInfoModal();
    });
    // Reads the tracked link, not the DOM — the link is no longer rendered.
    fileInfoCopyBtn?.addEventListener('click', async () => {
        if (!currentInfoLink) return showToast('No share link yet', 'error');
        try {
            await navigator.clipboard.writeText(currentInfoLink);
            fileInfoCopyBtn.textContent = 'Copied!';
            setTimeout(() => { fileInfoCopyBtn.textContent = 'Copy Link'; }, 1500);
        } catch (_) {
            showToast('Failed to copy', 'error');
        }
    });

    fileInfoQrBtn?.addEventListener('click', () => {
        if (!currentInfoLink) return showToast('No share link yet', 'error');
        const link = currentInfoLink;
        closeInfoModal();
        // Reuses the existing share modal, which already renders the QR.
        if (typeof showShareModal === 'function') showShareModal(link);
    });

    // Download-complete toast — bottom-right notification when a download
    // finishes. Distinct from the general center-bottom showToast(). The
    // Detail button (for now) just calls openDownloads to reveal the file
    // in the OS file browser — later we can route it to the specific
    // drive-item's info panel.
    const dlToast = document.getElementById('downloadCompleteToast');
    const dlToastFilename = document.getElementById('downloadCompleteFilename');
    const dlToastDetail = document.getElementById('downloadCompleteDetail');
    let dlToastHideTimer = null;
    let dlToastLastPath = null;

    function showDownloadCompleteToast(filename, filePath) {
        if (!dlToast || !dlToastFilename) return;
        dlToastFilename.textContent = (filename || 'file') + ' saved';
        dlToastLastPath = filePath || null;
        dlToast.classList.add('active');
        if (dlToastHideTimer) clearTimeout(dlToastHideTimer);
        dlToastHideTimer = setTimeout(() => {
            dlToast.classList.remove('active');
        }, 5000);
    }

    if (dlToastDetail) {
        dlToastDetail.addEventListener('click', () => {
            // Reveal the downloaded file in Finder/Explorer if we have a
            // path; otherwise open the downloads folder.
            if (dlToastLastPath && window.electronAPI?.showFileInFolder) {
                window.electronAPI.showFileInFolder(dlToastLastPath);
            } else if (window.electronAPI?.openDownloads) {
                window.electronAPI.openDownloads();
            }
            if (dlToast) dlToast.classList.remove('active');
        });
    }

    // Hook the existing onFilesDownloaded IPC event. Payload shape from
    // main.js: { driveId, files: [{ path, name, ... }] }.
    if (window.electronAPI?.onFilesDownloaded) {
        window.electronAPI.onFilesDownloaded((event, data) => {
            const first = data?.files?.[0];
            const filename = first?.name || 'File';
            const filePath = first?.path || null;
            showDownloadCompleteToast(filename, filePath);
        });
    }
})();

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

// Debug state (loaded from main process on init)
let DEBUG = true;  // Default ON during development

/**
 * Conditional debug logging
 * Use: log('message', data) instead of console.log
 */
function log(...args) {
    if (DEBUG) console.log('[PearDrop]', ...args);
}

/**
 * Expose debug controls on window.peardrop for DevTools console access
 * 
 * Usage in DevTools:
 *   peardrop.debug()        — Check current state
 *   peardrop.setDebug(true) — Enable logging
 *   peardrop.setDebug(false) — Disable logging
 */
// ─── Demo cards (DevTools only) ─────────────────────────────────────────
// Fake rows for working on card UI without moving real data. They exist
// ONLY in the renderer's list: no drive is created, no manifest entry is
// written, nothing touches the network or the disk. Reloading clears them.
//
//   peardrop.demo()               downloading card, progress climbing
//   peardrop.demo('inactive')     interrupted download, Resume pill
//   peardrop.demo('missing')      Files removed
//   peardrop.demo('sharing')      active share
//   peardrop.demo('folder')       multi-file downloading card
//   peardrop.demo('interrupted')  stopped at 42% — red "Interrupted" label
//                                 with Resume + cancel-X on the row
//                                 ('dropped' is kept as an alias)
//   peardrop.demoClear()          remove every demo row
const _demoTimers = new Map();

function _demoAdd(kind = 'downloading') {
    const id = `demo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const isFolder = kind === 'folder';
    const base = {
        id,
        // Explicit flag rather than sniffing the id prefix — the itemFactory
        // reads it to suppress the context menu entirely.
        isDemo: true,
        title: isFolder ? 'Folder' : 'Demo.File.2026.1080p.WEBRip.x264.mkv',
        size: 3_130_049_295,
        fileCount: isFolder ? 3 : 1,
        files: isFolder
            ? [{ name: 'alpha.bin', size: 3e6 }, { name: 'beta.bin', size: 2e6 }, { name: 'gamma.bin', size: 1e6 }]
            : [{ name: 'Demo.File.2026.1080p.WEBRip.x264.mkv', size: 3_130_049_295 }],
        type: kind === 'sharing' ? 'share' : 'download',
        shareLink: 'peardrop://' + 'd'.repeat(64),
        peers: kind === 'sharing' ? 1 : 0,
        progress: 0,
        speed: 0,
        status: 'downloading'
    };

    if (kind === 'inactive' || kind === 'missing' || kind === 'sharing') {
        base.status = kind === 'sharing' ? 'sharing' : kind;
        base.progress = kind === 'sharing' ? 1 : 0.37;
        addDriveToList(base, { animate: true });
        console.log(`[demo] added ${kind} card:`, id);
        return id;
    }

    // Interrupted download: the card parks at a part-done percentage with the
    // "Connection lost" overlay on it, so the Resume/Cancel prompt can be
    // looked at without waiting for a real sender to drop.
    if (kind === 'dropped' || kind === 'interrupted') {
        // No overlay. The interrupted state is an ordinary card status now:
        // normal thumbnail, title and meta, a red "Interrupted" label where
        // the green "Active" would be, and Resume + cancel-X on the row.
        base.status = 'interrupted';
        base.progress = 0.42;
        base.speed = 0;
        addDriveToList(base, { animate: true });
        console.log('[demo] added interrupted card:', id);
        return id;
    }

    // Downloading: animate so the bar, percentage, rate and the 1/sec
    // throttle can all be seen behaving.
    addDriveToList(base, { animate: true });
    _demoRunProgress(id);
    console.log(`[demo] added downloading card:`, id, '(call peardrop.demoClear() to remove)');
    return id;
}

/**
 * Drive a demo card's progress bar from wherever it currently is up to 100%.
 * Split out of _demoAdd so the dropped card's Resume button can restart it.
 */
function _demoRunProgress(id) {
    const existing = _demoTimers.get(id);
    if (existing) clearInterval(existing);

    const current = drives.find(d => d.id === id);
    let pct = Math.round(((current && current.progress) || 0) * 100);

    const timer = setInterval(() => {
        pct += 1 + Math.random() * 2;
        if (pct >= 100) {
            clearInterval(timer);
            _demoTimers.delete(id);
            updateDriveInList({ id, status: 'sharing', progress: 1, speed: 0 });
            return;
        }
        updateDriveInList({
            id,
            status: 'downloading',
            progress: pct / 100,
            speed: (20 + Math.random() * 25) * 1024 * 1024
        });
    }, 400);
    _demoTimers.set(id, timer);
}

function _demoClear() {
    for (const [id, t] of _demoTimers) { clearInterval(t); }
    _demoTimers.clear();
    const ids = drives.filter(d => String(d.id).startsWith('demo_')).map(d => d.id);
    ids.forEach(id => removeDriveFromList(id));
    console.log(`[demo] removed ${ids.length} demo card(s)`);
}

window.peardrop = {
    // Demo cards for UI work — see the note above.
    demo: _demoAdd,
    demoClear: _demoClear,

    // Check debug state
    debug: () => {
        console.log(`Debug logging is ${DEBUG ? 'ENABLED' : 'DISABLED'}`);
        return DEBUG;
    },
    
    // Toggle debug (persists to config file)
    setDebug: async (enabled) => {
        const result = await window.electronAPI.setDebug(enabled);
        if (result.success) {
            DEBUG = result.enabled;
            console.log(`Debug logging ${DEBUG ? 'ENABLED' : 'DISABLED'}`);
            console.log('(Setting persisted to ~/peardrop/config.json)');
        }
        return DEBUG;
    },
    
    // Get version info
    version: '0.18.1',
    
    // Expose useful internals for debugging
    get drives() { return drives; },
    get driveItems() { return driveItems; },
    get scrollList() { return scrollList; }
};

/**
 * Load debug state from main process
 */
async function loadDebugState() {
    try {
        const result = await window.electronAPI.getDebug();
        DEBUG = result.enabled;
        if (DEBUG) {
            console.log('[PearDrop] Debug logging ENABLED');
            console.log('[PearDrop] Use peardrop.setDebug(false) to disable');
        }
    } catch (err) {
        // Default to enabled if can't load
        DEBUG = true;
    }
}

// ============================================================================
// INITIALIZE
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadDebugState();
    init();
});

// Also init if DOM already loaded (for hot reload)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    loadDebugState();
    init();
}


// ─── Folder Contents Modal (Desktop v2, Figma screen #22) ───────────
// Opened from a folder card's "View files" button. Replaces the old
// inline expand on desktop: the list is a 2-column CSS grid, so
// expanding a card in place stretched its row-neighbour to match and
// pushed every row below it down. Mobile still uses the inline expand.
//
// Renders the folder's files in the same two-column card grid as the
// main list, each row carrying a single Open button.
(function () {
    const overlay  = document.getElementById('folderModalOverlay');
    if (!overlay) return;
    const gridEl   = document.getElementById('folderModalGrid');
    const titleEl  = document.getElementById('folderModalTitle');
    const subEl    = document.getElementById('folderModalSub');
    const closeBtn = document.getElementById('folderModalCloseBtn');
    const doneBtn  = document.getElementById('folderModalDoneBtn');
    const statusEl = document.getElementById('folderModalStatus');
    const copyBtn  = document.getElementById('folderModalCopyBtn');
    const searchEl = document.getElementById('folderModalSearch');
    const noteEl   = document.getElementById('folderModalNote');

    const esc = (v) => window.PearUtils.escapeHtml(v == null ? '' : String(v));
    const fmt = (n) => {
        try { return window.PearUtils.formatBytes(n || 0); }
        catch (e) { return (n || 0) + ' B'; }
    };

    // Files currently rendered, indexed by the row's data-file-index.
    let currentFiles = [];
    // The drive the modal is showing, for Copy Link.
    let currentDrive = null;

    // Same status vocabulary as the cards, so the modal header and the row
    // it was opened from can never say different things.
    const STATUS_TEXT = {
        sharing: 'Active', complete: 'Completed', initiating: 'Initiating',
        inactive: 'Inactive', unreachable: 'Not reachable', lost: 'Share lost',
        missing: 'Files removed', error: 'Failed', interrupted: 'Disconnected',
        downloading: 'Downloading', connecting: 'Connecting'
    };
    const STATUS_GREEN = new Set(['sharing', 'complete']);
    const STATUS_AMBER = new Set(['initiating', 'downloading', 'connecting', 'interrupted']);

    /**
     * Paint the rows. Split out of openFolderModal so the search box can
     * re-render a filtered subset without reopening anything.
     *
     * `data-file-index` stays the index into currentFiles, NOT the position
     * in the filtered list — every click handler, the thumbnail loader and
     * the missing-file marker all look files up by it, and renumbering on
     * filter would quietly open the wrong file.
     */
    // Delegates to the shared matcher so the rows here, the card's file
    // count and the list filter can never disagree about what "matches".
    const fileMatchesQuery = (name, q) => nameMatchesTerms(name, q);

    function renderFolderRows(query) {
        const q = String(query || '').trim().toLowerCase();
        const rows = currentFiles
            .map((f, i) => ({ f, i }))
            .filter(({ f }) => fileMatchesQuery(f.name, q));

        if (noteEl) noteEl.textContent = '';

        if (!currentFiles.length) {
            gridEl.innerHTML = '<div class="folder-modal-empty">This folder has no files yet.</div>';
            return;
        }
        // A query that matched nothing is reported under the SEARCH BOX, in
        // amber — the message is about the query, so it belongs beside the
        // thing that produced it rather than floating in the empty grid.
        if (!rows.length) {
            gridEl.innerHTML = '';
            if (noteEl) noteEl.textContent = `No files match “${String(query).trim()}”`;
            return;
        }

        gridEl.innerHTML = rows.map(({ f, i }) => `
                <div class="folder-file" data-file-index="${i}">
                    <span class="folder-file-thumb" data-file-index="${i}">${getFileIcon(f.name)}</span>
                    <div class="folder-file-text">
                        <div class="folder-file-name" title="${esc(f.name)}">${esc(f.name)}</div>
                        <div class="folder-file-meta">${fmt(f.size)}</div>
                    </div>
                    <button type="button" class="folder-file-open" data-file-index="${i}">Open</button>
                </div>`).join('');

        loadFolderThumbs();
        markMissingFolderFiles();
    }

    function paintFolderStatus(st) {
        if (!statusEl) return;
        statusEl.textContent = STATUS_TEXT[st] || '';
        statusEl.style.color = STATUS_GREEN.has(st) ? '#6ac168'
            : STATUS_AMBER.has(st) ? '#f0b840'
            : '#ff6b6b';
    }

    /**
     * Keep an OPEN folder modal in step with its drive.
     *
     * The header used to be painted once, at open. Opening a folder during
     * startup therefore froze it on "Initiating" — the card behind it went
     * Active seconds later when the announce landed, and the modal went on
     * claiming otherwise for as long as it stayed open.
     *
     * Called from updateDriveInList, which every status change already
     * passes through.
     */
    function syncFolderModalDrive(update) {
        if (!update || !currentDrive || update.id !== currentDrive.id) return;
        if (!overlay.classList.contains('active')) return;
        currentDrive = { ...currentDrive, ...update };
        if (update.status !== undefined) paintFolderStatus(currentDrive.status);
        // A link can appear after the fact (a re-share mints a new one).
        if (update.shareLink !== undefined) copyBtn.hidden = !currentDrive.shareLink;
        if (update.title !== undefined) titleEl.textContent = currentDrive.title || 'Folder';
    }
    window.syncFolderModalDrive = syncFolderModalDrive;

    function openFolderModal(drive) {
        currentDrive = drive || null;
        currentFiles = Array.isArray(drive && drive.files) ? drive.files : [];
        titleEl.textContent = (drive && drive.title) || 'Folder';

        const total = currentFiles.reduce((a, f) => a + (f.size || 0), 0);
        subEl.textContent = currentFiles.length
            ? `${currentFiles.length} file${currentFiles.length !== 1 ? 's' : ''} · ${fmt(total)}`
            : 'Empty folder';

        // Status line under the meta, coloured the same way the card is.
        paintFolderStatus(drive && drive.status);

        // No link, no button — better than a button that copies nothing.
        const link = drive && drive.shareLink;
        copyBtn.hidden = !link;

        // Carry the list's search into the folder.
        //
        // If the folder is on screen because one of its FILES matched, the
        // useful view is those files — not all forty with the match buried
        // among them. So the query is seeded into the folder's own search
        // box (visible and editable, not a hidden filter).
        //
        // But only when a file actually matches. A folder can also be a hit
        // on its own NAME, and filtering its contents by that name would
        // open it onto an empty grid — the search would look broken at the
        // exact moment it succeeded.
        const listQ = (typeof listSearchQuery === 'string' ? listSearchQuery : '').trim();
        const seed = listQ && currentFiles.some(f => f && fileMatchesQuery(f.name, listQ.toLowerCase()))
            ? listQ
            : '';
        if (searchEl) searchEl.value = seed;
        renderFolderRows(seed);

        overlay.classList.add('active');
        gridEl.scrollTop = 0;
    }

    /**
     * Mark files that are no longer on disk.
     *
     * A share keeps its own copy of the data, so a file deleted from the
     * user's folder still transfers fine — but Open cannot work, and the OS
     * answers a missing path with its own "Windows cannot find…" dialog.
     * Checking up front turns that into a plain red line in the row.
     */
    async function markMissingFolderFiles() {
        const paths = currentFiles.map(f => f && f.path).filter(Boolean);
        if (!paths.length || !window.electronAPI?.filesExist) return;
        let exists;
        try { exists = await window.electronAPI.filesExist(paths); }
        catch (_) { return; }

        currentFiles.forEach((f, i) => {
            if (!f || !f.path || exists[f.path] !== false) return;
            const row = gridEl.querySelector(`.folder-file[data-file-index="${i}"]`);
            if (!row) return;
            row.classList.add('is-missing');
            const meta = row.querySelector('.folder-file-meta');
            if (meta) meta.textContent = 'File removed';
            const btn = row.querySelector('.folder-file-open');
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Removed';
            }
        });
    }

    function closeFolderModal() {
        overlay.classList.remove('active');
        // Don't leave a stale "Copied!" waiting for the next open — the
        // modal reopens on a different folder and the label would be a
        // leftover answer to an older click.
        resetCopyBtn();
    }

    // Swap the emoji placeholder for a real thumbnail where main can
    // produce one. Reuses the same cache as the drive-item file rows so
    // a file already previewed elsewhere resolves instantly.
    async function loadFolderThumbs() {
        const thumbs = gridEl.querySelectorAll('.folder-file-thumb[data-file-index]');
        for (const el of thumbs) {
            const file = currentFiles[parseInt(el.dataset.fileIndex, 10)];
            if (!file || !file.path) continue;
            try {
                let value = fileThumbnailCache.get(file.path);
                if (!value) {
                    // Videos get a real extracted frame here too. This path
                    // used to call the IPC directly, so every video inside a
                    // folder fell back to the OS icon while the same file in
                    // the main list showed a proper frame.
                    const isVideo = VIDEO_EXTS.has(getFileExt(file.name || file.path));
                    value = isVideo
                        ? await queueVideoThumb(file.path).catch(() =>
                            window.electronAPI.getFileThumbnail(file.path))
                        : await window.electronAPI.getFileThumbnail(file.path);
                    cacheThumbResult(file.path, value);
                }
                // Only a real image preview replaces the icon — an OS shell
                // icon is no better than our own glyph.
                if (value && value.kind === 'image' && value.src) {
                    el.innerHTML = `<img src="${esc(value.src)}" alt="">`;
                }
            } catch (_) { /* keep the glyph */ }
        }
    }

    // Delegated: Open button, or a click anywhere on the row.
    gridEl.addEventListener('click', async (e) => {
        const row = e.target.closest('[data-file-index]');
        if (!row || !gridEl.contains(row)) return;
        const file = currentFiles[parseInt(row.dataset.fileIndex, 10)];
        if (!file) return;
        if (!file.path) {
            showToast('No local path for this file yet', 'error');
            return;
        }
        try {
            const result = await window.electronAPI.openFile(file.path);
            if (!result || result.success === false) {
                showToast((result && result.error) || 'Could not open file', 'error');
            }
        } catch (err) {
            showToast('Could not open file: ' + err.message, 'error');
        }
    });

    closeBtn?.addEventListener('click', closeFolderModal);
    doneBtn?.addEventListener('click', closeFolderModal);

    // Copy the FOLDER's link — the share is one drive, so there is one link
    // for all of it. Individual files inside do not have their own.
    // Confirmation lands ON the button for 2s. The toast alone made the user
    // look away from the thing they just pressed to find out whether it
    // worked; the answer belongs where the click happened.
    let copyResetTimer = null;
    copyBtn?.addEventListener('click', async () => {
        const link = currentDrive && currentDrive.shareLink;
        if (!link) return showToast('No link for this share', 'error');
        try {
            await navigator.clipboard.writeText(link);
            // Freeze the width before swapping the label, or the pill jumps
            // between "Copy Link" and "Copied!" and back again.
            copyBtn.style.minWidth = `${copyBtn.offsetWidth}px`;
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('is-copied');
            // Re-clicking mid-countdown restarts it rather than letting the
            // first timer revert the label while the second is still running.
            if (copyResetTimer) clearTimeout(copyResetTimer);
            copyResetTimer = setTimeout(resetCopyBtn, 2000);
        } catch (err) {
            showToast('Could not copy link', 'error');
        }
    });

    function resetCopyBtn() {
        if (copyResetTimer) { clearTimeout(copyResetTimer); copyResetTimer = null; }
        if (!copyBtn) return;
        copyBtn.textContent = 'Copy Link';
        copyBtn.classList.remove('is-copied');
        copyBtn.style.minWidth = '';
    }

    // Filter as you type. Cheap enough to run per keystroke: it re-renders
    // at most a few dozen rows from an array already in memory.
    searchEl?.addEventListener('input', () => {
        renderFolderRows(searchEl.value);
        gridEl.scrollTop = 0;
    });

    // Esc inside the search clears it rather than closing the modal — losing
    // the whole view because you wanted to undo a search is a bad trade.
    searchEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && searchEl.value) {
            e.stopPropagation();
            searchEl.value = '';
            renderFolderRows('');
        }
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeFolderModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeFolderModal();
    });

    window.openFolderModal  = openFolderModal;
    window.closeFolderModal = closeFolderModal;
})();

// ─── Rename Modal (3-dot menu -> "Rename") ──────────────────────────
// Sets a LOCAL alias for a card. Never renames a file, never reaches a
// peer, never writes drives-state.json — see the alias store above for
// why, and for the beta trade-off.
//
// Applies to shares and downloads alike: the card is the same object in
// both tabs, so the rename is too.
(function () {
    const overlay  = document.getElementById('renameModalOverlay');
    if (!overlay) return;
    const inputEl  = document.getElementById('renameInput');
    const hintEl   = document.getElementById('renameHint');
    const resetBtn = document.getElementById('renameResetBtn');
    // The row holding the original name and the Reset button.
    const hintRow  = document.querySelector('#renameModalOverlay .rename-hint');
    const cancelBtn = document.getElementById('renameCancelBtn');
    const saveBtn  = document.getElementById('renameSaveBtn');

    let currentId = null;
    let currentOriginal = '';

    function openRenameModal(drive) {
        if (!drive || !drive.id) return;
        currentId = drive.id;

        // The un-aliased name. Prefer the field normalizeDrive computed; fall
        // back for a card built by a path that predates it. Never read
        // `drive.title` when an alias is set — that IS the alias, and using it
        // would make the alias its own "original" on the second open.
        currentOriginal = drive.originalTitle
            || (getAlias(currentId) ? '' : drive.title)
            || '';

        const alias = getAlias(currentId);
        inputEl.value = alias || '';
        inputEl.placeholder = currentOriginal || 'Name';
        // "Original name: Folder" tells the user nothing — every multi-file
        // share carries the same placeholder, so the line is pure noise on
        // exactly the cards people are most likely to rename. Show it only
        // when there is a real name underneath. Reset is unaffected: it still
        // appears whenever an alias exists, and still restores "Folder".
        const hasRealOriginal = currentOriginal && currentOriginal !== FOLDER_PLACEHOLDER;
        hintEl.innerHTML = hasRealOriginal
            ? `Original name: <span class="rename-orig">${window.PearUtils.escapeHtml(currentOriginal)}</span>`
            : '';
        resetBtn.hidden = !alias;

        // Collapse the whole row when it carries neither the original name
        // nor the Reset button. It used to keep a reserved 17px line so the
        // Save row could not jump — but on a folder card with no alias BOTH
        // are absent, and the reserved line is just a gap under the input.
        // The anti-jump reservation still applies whenever there is content.
        hintRow?.classList.toggle('is-empty', !hasRealOriginal && !alias);

        overlay.classList.add('active');
        // Focus after the opening fade so the caret doesn't render mid-animation.
        setTimeout(() => { inputEl.focus(); inputEl.select(); }, 60);
    }

    function closeRenameModal() {
        overlay.classList.remove('active');
        currentId = null;
    }

    // One path in and out: an empty field clears the alias, which is also
    // exactly what Reset does. No separate "remove alias" state to keep
    // in sync, and no way to save a blank name.
    function commit(value) {
        if (!currentId) return closeRenameModal();
        const id = currentId;
        const before = getAlias(id);

        // Reset needs the name to put back. If we somehow don't have it,
        // do NOTHING rather than invent one: this used to fall back to the
        // string 'Unknown', so a failed reset would RENAME the card to
        // "Unknown" — a wrong answer that looks like a right one, with the
        // real name now gone from the screen. Refusing is recoverable;
        // a confident wrong name is not.
        const stored = drives.find(d => d.id === id);
        const original = (stored && stored.originalTitle) || currentOriginal;
        // Checked BEFORE setAlias — bailing out after it would have already
        // cleared the stored alias, leaving the card named after something
        // we just decided we couldn't restore.
        const willClear = !String(value == null ? '' : value).trim();
        if (willClear && !original) {
            closeRenameModal();
            showToast('Could not restore the original name', 'error');
            return;
        }

        const alias = setAlias(id, value);
        updateDriveInList({ id, title: alias || original, alias });
        closeRenameModal();

        // Saying "Renamed" when nothing changed teaches the user to distrust
        // the toast. Silence is the honest response to a no-op.
        if (alias === before) return;
        showToast(alias ? 'Renamed' : 'Name reset');
    }

    saveBtn.addEventListener('click', () => commit(inputEl.value));
    resetBtn.addEventListener('click', () => commit(''));
    cancelBtn.addEventListener('click', closeRenameModal);

    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(inputEl.value); }
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeRenameModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeRenameModal();
    });

    window.openRenameModal  = openRenameModal;
    window.closeRenameModal = closeRenameModal;
})();

// ─── Share Build Progress (Send modal State C + background pill) ────
// Bridges the 'share-progress' IPC event (emitted per file by
// createDrive) to two surfaces:
//   • Send modal State C — while the modal is open
//   • bottom-right pill  — when it isn't, or the user backgrounds it
// Only one is ever visible. The pill is clickable and reopens the modal.
(function () {
    const modalOverlay = document.getElementById('sendModalOverlay');
    const modalInner   = modalOverlay?.querySelector('.send-modal');
    const fileEl       = document.getElementById('sendProgressFile');
    const barEl        = document.getElementById('sendProgressBar');
    const percentEl    = document.getElementById('sendProgressPercent');
    const ringEl       = document.getElementById('sendProgressRing');
    const statsEl      = document.getElementById('sendProgressStats');

    // Stat blocks are built once per share, then only their values are
    // written. Rebuilding the markup on every progress event would throw
    // away the tick animation and churn the DOM many times a second.
    let statRefs = {};

    function buildStats(isGroup) {
        if (!statsEl) return;
        const block = (key, label) =>
            `<div class="send-progress-stat">
                <div class="send-progress-stat-label">${label}</div>
                <div class="send-progress-stat-value send-progress-num" data-stat="${key}">—</div>
            </div>`;
        const divider = '<div class="send-progress-stat-div" aria-hidden="true"></div>';

        // "1 file" tells the user nothing, so a single file drops that block.
        const parts = isGroup
            ? [block('files', 'Files'), divider, block('size', 'Size'), divider, block('eta', 'Time left')]
            : [block('size', 'Size'), divider, block('eta', 'Time left')];

        statsEl.innerHTML = parts.join('');
        statRefs = {
            files: statsEl.querySelector('[data-stat="files"]'),
            size:  statsEl.querySelector('[data-stat="size"]'),
            eta:   statsEl.querySelector('[data-stat="eta"]')
        };
    }

    const RING_C = 326.7;   // 2 * pi * r(52), matches the CSS dasharray

    // Write a numeral in place. Every value in the dial is static — no
    // animation — so this only guards against needless DOM writes.
    function setNum(el, value) {
        if (!el || el.textContent === value) return;
        el.textContent = value;
    }
    const bgBtn        = document.getElementById('sendProgressBgBtn');
    const cancelBtn    = document.getElementById('sendProgressCancelBtn');
    const pill         = document.getElementById('sharePill');
    const pillPercent  = document.getElementById('sharePillPercent');

    const fmt = (n) => window.PearUtils.formatBytes(n || 0);

    let active = false;       // a share is currently building
    let backgrounded = false; // user explicitly chose the pill
    let bytesTotal = 0;
    let last = { bytesDone: 0, filesDone: 0, filesTotal: 0 };
    // Rolling throughput for the time-left estimate. Sampled rather than
    // instantaneous so a slow chunk doesn't make the ETA jump around.
    let currentDriveId = null;   // learned from the first progress event
    let rateAnchor = null;   // { t, bytes }
    let bytesPerSec = 0;

    function updateRate(bytesDone) {
        const now = Date.now();
        if (!rateAnchor) { rateAnchor = { t: now, bytes: bytesDone }; return; }
        const dt = now - rateAnchor.t;
        if (dt < 700) return;                       // sample window
        const inst = ((bytesDone - rateAnchor.bytes) * 1000) / dt;
        // Smooth toward the new reading instead of snapping to it.
        bytesPerSec = bytesPerSec ? (bytesPerSec * 0.6 + inst * 0.4) : inst;
        rateAnchor = { t: now, bytes: bytesDone };
    }

    function etaText() {
        if (!bytesPerSec || bytesTotal <= 0) return 'Estimating';
        const left = Math.max(0, bytesTotal - last.bytesDone);
        const secs = Math.round(left / bytesPerSec);
        if (secs < 1) return 'Almost done';
        if (secs < 60) return secs + 's';
        const m = Math.floor(secs / 60);
        if (m < 60) return m + 'm ' + (secs % 60) + 's';
        return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    }

    // Pill shows whenever a build is running and the modal isn't on screen.
    function syncSurfaces() {
        const modalOpen = !!modalOverlay?.classList.contains('active');
        const showPill = active && (backgrounded || !modalOpen);
        pill?.classList.toggle('is-visible', showPill);
        modalInner?.classList.toggle('is-sharing', active && modalOpen && !backgrounded);
    }

    function render() {
        // Bytes when we have a real total, else fall back to file count.
        // The renderer's list can disagree with what createDrive actually
        // writes — sharing a folder is ONE entry here but N files there —
        // so a byte total of 0 must not pin the bar at 0 forever.
        // filesDone/filesTotal come straight from createDrive's loop and
        // are always correct.
        let pct = 0;
        if (bytesTotal > 0) {
            pct = Math.min(100, Math.round((last.bytesDone / bytesTotal) * 100));
        } else if (last.filesTotal > 0) {
            pct = Math.min(100, Math.round((last.filesDone / last.filesTotal) * 100));
        }
        if (barEl) barEl.style.width = pct + '%';
        if (ringEl) ringEl.style.strokeDashoffset = String(RING_C * (1 - pct / 100));
        setNum(percentEl, String(pct));
        setNum(pillPercent, pct + '%');
        // Time left is shown for EVERY share, group or single. It used to be
        // swapped out for the file count on a group, which is backwards: a
        // 500-file transfer is exactly when you want to know how long.
        setNum(statRefs.eta, etaText());
        if (statRefs.files) {
            setNum(statRefs.files, last.filesTotal
                ? `${last.filesDone}/${last.filesTotal}`
                : String(last.filesDone));
        }
        // Size gets its own stat block now, so it's just the value.
        // bytesDone is always real (createDrive stats every file), so show
        // it even when the total is unknown.
        setNum(statRefs.size, bytesTotal > 0
            ? `${fmt(last.bytesDone)} / ${fmt(bytesTotal)}`
            : fmt(last.bytesDone));
    }

    function begin(files) {
        active = true;
        backgrounded = false;
        bytesTotal = (files || []).reduce((sum, f) => sum + (f.size || 0), 0);
        last = { bytesDone: 0, filesDone: 0, filesTotal: (files || []).length };
        rateAnchor = null;
        bytesPerSec = 0;
        currentDriveId = null;
        if (cancelBtn) {
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Cancel';
        }
        buildStats(last.filesTotal > 1);
        if (fileEl) fileEl.textContent = 'Starting…';
        render();
        syncSurfaces();
    }

    function clearThrottle() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = null;
        renderPending = false;
    }

    function finish() {
        clearThrottle();
        active = false;
        backgrounded = false;
        modalInner?.classList.remove('is-sharing');
        // Close the Send modal — the Share Link modal is about to open and
        // would otherwise stack on top of it.
        window.closeSendModal?.();
        syncSurfaces();
        if (barEl) barEl.style.width = '0%';
        if (ringEl) ringEl.style.strokeDashoffset = String(RING_C);
    }

    function fail(message) {
        clearThrottle();
        active = false;
        backgrounded = false;
        modalInner?.classList.remove('is-sharing');
        syncSurfaces();
        if (barEl) barEl.style.width = '0%';
        if (message) console.error('[share] build failed:', message);
    }

    // IPC — one event per file written.
    let renderTimer = null;
    let renderPending = false;

    // Coalesce renders to ~8/sec. createDrive emits once per file, so a
    // 500-file share fires hundreds of updates in well under a second —
    // faster than anyone can read, and faster than the tick animation.
    function scheduleRender() {
        if (renderTimer) { renderPending = true; return; }
        render();
        renderTimer = setTimeout(() => {
            renderTimer = null;
            if (renderPending) { renderPending = false; scheduleRender(); }
        }, 125);
    }

    window.electronAPI.onShareProgress?.((_evt, data) => {
        if (!active || !data) return;
        if (data.driveId) currentDriveId = data.driveId;
        last = {
            bytesDone: data.bytesDone || 0,
            filesDone: data.filesDone || 0,
            // createDrive's count wins — the renderer's activeFiles length
            // is wrong whenever a folder was expanded into many files.
            filesTotal: data.filesTotal || last.filesTotal
        };
        // Trust the sender's total when the renderer's file sizes were
        // incomplete (drag-drop entries occasionally lack `size`).
        if (!bytesTotal && data.bytesTotal) bytesTotal = data.bytesTotal;
        if (fileEl && data.currentFile) fileEl.textContent = data.currentFile;
        updateRate(last.bytesDone);
        scheduleRender();
    });

    // "Continue in background" — demote to the pill, close the modal.
    bgBtn?.addEventListener('click', () => {
        backgrounded = true;
        window.closeSendModal?.();
        syncSurfaces();
    });

    // Cancel — aborts the build. The backend deletes the partial drive, so
    // nothing is left behind in the Shares list.
    cancelBtn?.addEventListener('click', async () => {
        if (!active) return;
        cancelBtn.disabled = true;
        cancelBtn.textContent = 'Cancelling…';
        try {
            await window.electronAPI.hyperdriveShareCancel?.(currentDriveId);
        } catch (err) {
            console.error('[share] cancel failed', err);
            cancelBtn.disabled = false;
            cancelBtn.textContent = 'Cancel';
        }
        // startShare()'s rejection path calls fail(), which tears the
        // progress state down — no need to do it here.
    });

    // Clicking the pill returns to the modal.
    pill?.addEventListener('click', () => {
        backgrounded = false;
        window.openSendModal?.();
        syncSurfaces();
    });

    // Closing the modal mid-build (X, Escape, backdrop) demotes to the
    // pill rather than losing the progress. Watched via the overlay's
    // class rather than patching every close path.
    if (modalOverlay) {
        new MutationObserver(syncSurfaces).observe(modalOverlay, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    window.shareProgress = { begin, finish, fail };
})();
