/**
 * MODULE: lib/downloader.js
 * PURPOSE: Download orchestration - file writing, progress, naming
 * EXPORTS:
 * downloadFromDrive(drive, options) - Download all files from a drive
 * OPTIONS:
 * destDir: Destination directory
 * totalBytes: Expected total bytes (from manifest — should reflect the
 *     `fileNames` subset when a caller passes one, since progress percent
 *     is computed against this value; see the fileNames note below)
 * fileNames?: Optional string[] — when non-empty, only entries whose
 *     leading-slash-normalized key appears in this list are fetched.
 *     Absent or empty → download all (current behavior). Mirrors mobile's
 *     engineDownload(driveId, destDir, fileName, fileNames) precedence.
 * onProgress: Callback for progress updates
 * onComplete: Callback when done
 * onError: Callback for errors
 * RETURNS: { files: [], failed: [], totalBytes, duration, destDir }
 * destDir is the actual folder written to (after getUniqueFolderPath
 *     disambiguation). Same as `options.destDir` when no wrap; otherwise
 *     `options.destDir/<sanitized shareName>` (or `(1)`, `(2)`, etc.).
 * EXTERNAL CALLS:
 * lib/file-utils.js (safeJoin, getUniqueFilePath, ensureDir, formatBytes, formatSpeed)
 * Hyperdrive instance methods (list, get, getBlobs)
 * SECURITY: untrusted peer keys written via safeJoin (path-traversal guard)
 * RELIABILITY: per-file stall watchdog (STALL_TIMEOUT_MS) on peer disconnect
 * KEY STATE: None (stateless, all state passed via options)
 */

const path = require('path');
const fs = require('fs').promises;
const { safeJoin, sanitizeFolderName, getUniqueFilePath, getUniqueFolderPath, ensureDir, formatBytes, formatSpeed } = require('./file-utils');
const { PathTraversalError, FileStallError, EngineError } = require('./engine-errors');

// Normalize a manifest key for wanted-set membership: strip leading
// slash, coerce to string. Mirrors mobile's `normalizeKey` at
// backend/hyperdrive-engine.mjs:1359-1361.
function normalizeKey(k) {
    return String(k || '').replace(/^\//, '');
}

// Manifest file path (skip this when downloading)
const MANIFEST_PATH = '/.peardrop.json';

// Fail a single file's transfer if no data arrives for this long (peer likely
// disconnected). Keeps a dropped peer from hanging the whole download forever.
const STALL_TIMEOUT_MS = 60000;

/**
 * Download all files from a Hyperdrive
 * @param {Hyperdrive} drive - Opened hyperdrive instance
 * @param {Object} options - Download options
 * @returns {Promise<{files: Array, failed: Array, totalBytes: number, duration: number}>}
 */
async function downloadFromDrive(drive, options = {}) {
    const {
        destDir,
        totalBytes: knownTotalBytes = 0,
        shareName = null,
        fileNames = null,
        onProgress = () => {},
        onComplete = () => {},
        onError = () => {},
        onPeerConnected = () => {},
        // Fired once the destination folder is known, before any file is
        // written. Lets the caller clean up regardless of HOW the download
        // ends — including errors that carry no file list.
        onRoot = () => {},
        // Handed an abort function for the file currently in flight. Calling
        // it tears the streams down immediately — polling isCancelled() only
        // reacts when a chunk arrives, so a stalled transfer would otherwise
        // sit until the stall timeout before noticing the cancel.
        registerAborter = () => {},
        // Called before each file, and again between chunks. Returning true
        // aborts the download. Without it, "cancel" only tore down the drive
        // entry while this loop happily ran to completion.
        isCancelled = () => false,
        // Map of drive-entry key -> absolute path written by a PREVIOUS
        // attempt at this same drive. When present, that path is reused
        // instead of picking a fresh unique name.
        resumePaths = null,
        // Folder a previous attempt at this drive wrote into. Multi-file
        // shares get their own subfolder via getUniqueFolderPath(), which on
        // a resume happily produced "2 files (1)" beside "2 files" — and
        // then every file was re-fetched into the new one. Reusing the
        // original root is what makes a resume actually resume.
        resumeRoot = null
    } = options;

    const startTime = Date.now();
    const downloadedFiles = [];
    const failedFiles = [];
    let bytesDownloaded = 0;

    // Per-file selection primitive (). When a caller passes a
    // non-empty fileNames array, only entries whose leading-slash-normalized
    // key appears in the set get pushed onto filesToDownload. Mirrors mobile's
    // engineDownload at backend/hyperdrive-engine.mjs:1410-1418. Absent /
    // empty fileNames → wantedSet is null → the filter is a no-op and every
    // entry is downloaded (current behavior; dormancy guarantee).
    const wantedSet = Array.isArray(fileNames) && fileNames.length
        ? new Set(fileNames.map(normalizeKey))
        : null;

    // First pass: list all files (skip manifest)
    const filesToDownload = [];
    for await (const entry of drive.list('/')) {
        if (entry.key === MANIFEST_PATH) continue;
        if (wantedSet && !wantedSet.has(normalizeKey(entry.key))) continue;
        filesToDownload.push({ key: entry.key });
    }

    // Empty-after-filter: a caller passed a selection but nothing matched.
    // Mirror mobile's typed `receive.empty-drive` failure (mobile uses one
    // category for both "selection matched nothing" and "drive genuinely
    // empty" at hyperdrive-engine.mjs:1420-1422; desktop applies the throw
    // only to the fileNames-was-passed case, so a no-selection call on a
    // genuinely-empty drive keeps its current {files:[],failed:[],...}
    // return — dormancy guarantee for the no-fileNames path).
    if (wantedSet && filesToDownload.length === 0) {
        throw new EngineError({
            category: 'receive.empty-drive',
            cause: 'no-files-selected',
            message: 'No files in drive.',
            detail: { requested: fileNames.length },
        });
    }

    const fileCount = filesToDownload.length;
    console.log('[Downloader] Starting download:', { 
        files: fileCount, 
        totalBytes: knownTotalBytes,
        shareName 
    });
    
    // Notify that download is starting
    onPeerConnected({
        shareName,
        totalBytes: knownTotalBytes
    });
    
    // Track download progress via blobs core 'download' event
    let lastUpdate = 0;
    
    try {
        const blobs = await drive.getBlobs();
        if (blobs?.core) {
            console.log('[Downloader] Hooking into blobs core for progress');
            blobs.core.on('download', (index, bytes) => {
                bytesDownloaded += bytes;
                
                // Throttle updates to every 100ms
                const now = Date.now();
                if (now - lastUpdate > 100) {
                    lastUpdate = now;
                    
                    const elapsed = (now - startTime) / 1000;
                    const speed = elapsed > 0 ? bytesDownloaded / elapsed : 0;
                    const percent = knownTotalBytes > 0
                        ? Math.min(99, Math.round((bytesDownloaded / knownTotalBytes) * 100))
                        : -1;
                    
                    onProgress({
                        percent,
                        bytesFormatted: formatBytes(bytesDownloaded),
                        totalFormatted: knownTotalBytes > 0 ? formatBytes(knownTotalBytes) : '—',
                        speedFormatted: formatSpeed(speed)
                    });
                }
            });
        }
    } catch (err) {
        console.log('[Downloader] Could not hook blobs for progress:', err.message);
    }
    
    // Determine download root - create shareName folder for multi-file shares.
    // Sanitize the share name before using it as a folder: a hostile manifest
    // could carry `../evil` or `foo/bar` which would otherwise escape destDir.
    // A null sanitized name (empty after cleaning) falls through to no-wrap.
    const safeShareName = sanitizeFolderName(shareName);
    const isFolderShare = filesToDownload.length > 1 || (safeShareName && !safeShareName.includes('.'));
    let downloadRoot = destDir;

    if (isFolderShare && safeShareName) {
        if (resumeRoot) {
            // Resuming: continue in the folder we already populated.
            downloadRoot = resumeRoot;
            console.log('[Downloader] Resuming into existing folder:', downloadRoot);
        } else {
            // Fresh: get a unique folder (peardrop → peardrop (1) → …) so two
            // unrelated shares with the same name don't merge.
            const proposedPath = path.join(destDir, safeShareName);
            downloadRoot = await getUniqueFolderPath(proposedPath);
        }
    }
    
    // Create the download root folder
    await ensureDir(downloadRoot);
    try { onRoot(downloadRoot, downloadRoot !== destDir); } catch (_) { /* never fatal */ }
    console.log('[Downloader] Download root:', { downloadRoot, isFolderShare, shareName });
    
    // Download files with error resilience
    let filesCompleted = 0;
    
    for (const file of filesToDownload) {
        // CANCEL CHECK — between files. Carry what was already written so
        // the caller can delete it; otherwise a cancelled multi-file
        // download leaves its partial files sitting in the folder.
        if (isCancelled()) {
            const err = new Error('Download cancelled');
            err.cancelled = true;
            err.partialFiles = downloadedFiles.slice();
            err.downloadRoot = downloadRoot !== destDir ? downloadRoot : null;
            throw err;
        }
        // Declared OUTSIDE the try so the catch below can still see it. As a
        // `let` inside the try it was out of scope in the catch, so the
        // cancel cleanup threw ReferenceError, got swallowed by its own
        // catch, and the partial file survived every cancellation.
        let filePath = null;
        try {
            // SECURITY: the key comes from a remote peer's manifest and is
            // untrusted. safeJoin guarantees the write stays inside downloadRoot,
            // rejecting `../` traversal, absolute paths and leading-slash escapes.
            filePath = safeJoin(downloadRoot, file.key);
            if (!filePath) {
                throw new PathTraversalError(
                    `unsafe path outside download folder: ${file.key}`,
                    { key: file.key, root: downloadRoot },
                );
            }

            // Create parent directories if needed (for folder structure)
            const parentDir = path.dirname(filePath);
            await ensureDir(parentDir);
            
            // RESUME: if a previous attempt at this drive already wrote this
            // file, write to that same path again.
            //
            // getUniqueFilePath() exists so two unrelated shares of the same
            // filename don't clobber each other. But on a RESUME it turned
            // every retry into `movie-1.mkv`, `movie-2.mkv`… beside the
            // partial original — which is how a folder ends up with five
            // copies of the same film. Hyperdrive is content-addressed and
            // the already-fetched blocks are local, so rewriting the same
            // path is cheap and produces one correct file.
            const resumeTarget = resumePaths && resumePaths[file.key];
            // Only honour a resume path that sits inside this download's own
            // root. getUniqueFilePath is what normally stops one share
            // clobbering another's identically-named file, and this bypasses
            // it — so the bypass has to prove the target is ours.
            const resumeIsSafe = resumeTarget
                && path.resolve(resumeTarget).startsWith(path.resolve(downloadRoot) + path.sep);

            if (resumeIsSafe) {
                filePath = resumeTarget;
            } else {
                if (resumeTarget) {
                    console.warn('[Downloader] Ignoring out-of-root resume path:', resumeTarget);
                }
                filePath = await getUniqueFilePath(filePath);
            }
            
            // Use streaming for large files instead of loading into memory
            const readStream = drive.createReadStream(file.key);
            const writeStream = require('fs').createWriteStream(filePath);

            let fileSize = 0;

            // RELIABILITY: if the peer drops mid-transfer, a hyperdrive read
            // stream waits for blocks that never arrive and the promise hangs
            // forever (taking the download IPC with it). Arm an inactivity
            // watchdog: if no chunk arrives for STALL_TIMEOUT_MS, fail this file
            // so the loop can move on / surface the error instead of hanging.
            await new Promise((resolve, reject) => {
                let settled = false;
                let stallTimer = null;
                const clearStall = () => { if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; } };
                const finish = (err) => {
                    if (settled) return;
                    settled = true;
                    clearStall();
                    if (err) { readStream.destroy(); writeStream.destroy(); reject(err); }
                    else resolve();
                };
                const armStall = () => {
                    clearStall();
                    stallTimer = setTimeout(
                        () => finish(new FileStallError(
                            `stalled: no data for ${STALL_TIMEOUT_MS / 1000}s (peer may have disconnected)`,
                            { file: file.key, timeoutMs: STALL_TIMEOUT_MS },
                        )),
                        STALL_TIMEOUT_MS
                    );
                };
                // Expose an immediate abort for THIS file.
                registerAborter(() => {
                    const err = new Error('Download cancelled');
                    err.cancelled = true;
                    finish(err);
                });

                readStream.on('data', (chunk) => {
                    // CANCEL CHECK — mid-file. The between-files check alone
                    // meant cancelling a multi-GB download still streamed
                    // that entire file to disk before stopping, so "Cancel"
                    // appeared to hang for minutes and only then deleted it.
                    if (isCancelled()) {
                        const err = new Error('Download cancelled');
                        err.cancelled = true;
                        finish(err);
                        return;
                    }
                    fileSize += chunk.length;
                    armStall();
                });
                readStream.on('error', (e) => finish(e));
                writeStream.on('error', (e) => finish(e));
                writeStream.on('finish', () => finish());
                readStream.pipe(writeStream);
                armStall(); // arm immediately in case no data ever arrives
            });
            
            downloadedFiles.push({ 
                name: path.basename(filePath), 
                path: filePath, 
                size: fileSize,
                // The in-drive key this file came from. Without it, a resume
                // has to guess the mapping from the local filename — which
                // breaks the moment getUniqueFilePath renames anything.
                key: file.key
            });
            
            console.log('[Downloader] Downloaded:', path.basename(filePath), formatBytes(fileSize));
        } catch (fileErr) {
            if (fileErr && fileErr.cancelled) {
                // Remove the partially-written file: it never made it into
                // downloadedFiles, so nothing downstream knows it exists.
                if (filePath) {
                    // destroy() on the write stream is asynchronous, so the
                    // handle may still be open — and on Windows deleting an
                    // open file fails with EBUSY. Retry for ~600ms.
                    let removed = false;
                    for (let attempt = 0; attempt < 5 && !removed; attempt++) {
                        try {
                            await fs.rm(filePath, { force: true });
                            removed = true;
                        } catch (rmErr) {
                            if (attempt === 4) {
                                console.warn('[Downloader] Could not remove partial:', filePath, rmErr.message);
                            } else {
                                await new Promise(r => setTimeout(r, 120));
                            }
                        }
                    }
                    if (removed) console.log('[Downloader] Removed partial file on cancel:', filePath);
                }
                fileErr.partialFiles = downloadedFiles.slice();
                fileErr.downloadRoot = downloadRoot !== destDir ? downloadRoot : null;
                throw fileErr;
            }
            console.error('[Downloader] Failed to download file:', file.key, fileErr.message);
            failedFiles.push({ key: file.key, error: fileErr.message });
            onError({ file: file.key, error: fileErr.message });
            // Continue with other files instead of crashing
        }
        
        filesCompleted++;
        
        // Progress update based on file count
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? bytesDownloaded / elapsed : 0;
        const percent = Math.round((filesCompleted / fileCount) * 100);
        
        onProgress({
            percent,
            bytesFormatted: formatBytes(bytesDownloaded),
            totalFormatted: `${filesCompleted}/${fileCount} files`,
            speedFormatted: formatSpeed(speed)
        });
    }
    
    const duration = Date.now() - startTime;
    
    // Log any failures
    if (failedFiles.length > 0) {
        console.warn('[Downloader] Some files failed:', failedFiles);
    }
    
    const result = {
        files: downloadedFiles,
        failed: failedFiles,
        totalBytes: bytesDownloaded,
        duration,
        destDir: downloadRoot
    };
    
    onComplete(result);
    
    console.log('[Downloader] Complete:', {
        files: downloadedFiles.length,
        failed: failedFiles.length,
        totalBytes: bytesDownloaded,
        duration
    });
    
    return result;
}

module.exports = {
    downloadFromDrive
};
