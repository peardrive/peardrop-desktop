/**
 * MODULE: lib/file-utils.js
 * PURPOSE: Pure file system utilities - no P2P knowledge
 * EXPORTS:
 * safeJoin(root, relativePath) - Containment-checked path join (null if escapes root)
 * normalizeUserPath(rawPath) - Trim, decode file:// URI if present, resolve to absolute
 * sanitizeFolderName(raw) - Strip separators/reserved chars/traversal from a share name; null if empty
 * computeTruncation(declaredCount, maxCount) - Manifest-truncation hint shape or null
 * getUniqueFilePath(filePath) - Append (1), (2) etc. if file exists
 * getUniqueFolderPath(folderPath) - Append (1), (2) etc. if folder exists
 * ensureDir(dirPath) - Create directory recursively
 * formatBytes(bytes) - Human readable size
 * formatSpeed(bytesPerSec) - Human readable speed
 * EXTERNAL CALLS: fs.promises, path
 * KEY STATE: None (stateless utilities)
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * Join an untrusted relative path onto a trusted root, guaranteeing the
 * result stays INSIDE root. Defends against path-traversal (`../`), absolute
 * paths, and drive-letter / leading-slash escapes coming from a remote peer's
 * drive manifest. Returns the contained absolute path, or null if the input
 * would escape root (or resolves to root itself, which is not a valid file).
 * @param {string} root - Trusted base directory
 * @param {string} relativePath - Untrusted path from a peer/manifest
 * @returns {string|null}
 */
function safeJoin(root, relativePath) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
    // Strip any leading slashes/backslashes so the path is treated as relative,
    // and neutralize NUL bytes which can truncate paths in some syscalls.
    const cleaned = relativePath.replace(/\0/g, '').replace(/^[/\\]+/, '');
    if (cleaned.length === 0) return null;
    const resolvedRoot = path.resolve(root);
    const target = path.resolve(resolvedRoot, cleaned);
    // Must be strictly below root (root + separator), never root itself.
    if (target !== resolvedRoot && target.startsWith(resolvedRoot + path.sep)) {
        return target;
    }
    return null;
}

/**
 * Normalize a user-provided path at the trust boundary. Callers pass this
 * anything that came from a file picker, drag-and-drop, CLI arg, or IPC
 * message — anywhere the user (or a system component acting on the user's
 * behalf) hands us a path we haven't seen yet.
 * Currently handles:
 * non-string / null / undefined input → throws
 * leading and trailing whitespace → stripped
 * empty after trim → throws
 * `file://` URIs → prefix stripped, decoded via decodeURI, extra leading
 *     slash before a Windows drive letter dropped (Linux and macOS emit
 *     `file:///path` where the leading slash is the absolute root; Windows
 *     emits `file:///C:/path` where the leading slash before the drive
 *     letter is a URI artifact and must not survive)
 * all other inputs → passed through
 * Then `path.resolve` is called so the return value is always an absolute
 * path — subsequent callers can assume that.
 * Design intent: this is the single sender-side path-normalization
 * boundary. If a future bug shows up (a new OS returns a weird path
 * format, drag-and-drop encodes something unexpectedly, network-mounted
 * paths need special handling), this function is where the fix goes. All
 * sender-side entry points run every user-provided path through here
 * before doing anything else with it.
 * @param {string} rawPath - Untrusted path from user input
 * @returns {string} - Absolute normalized path
 * @throws {Error} - If input is not a non-empty string after trim
 */
function normalizeUserPath(rawPath) {
    if (typeof rawPath !== 'string') {
        throw new Error(`normalizeUserPath: expected string, got ${typeof rawPath}`);
    }
    let str = rawPath.trim();
    if (str.length === 0) {
        throw new Error('normalizeUserPath: path is empty');
    }
    if (/^file:\/\//i.test(str)) {
        let pathPart = str.replace(/^file:\/\//i, '');
        // On Windows `file:///C:/path` becomes `/C:/path`; strip the extra
        // leading slash so `path.resolve` handles the drive letter correctly.
        if (/^\/[a-zA-Z]:/.test(pathPart)) {
            pathPart = pathPart.slice(1);
        }
        try {
            str = decodeURI(pathPart);
        } catch {
            str = pathPart;
        }
    }
    return path.resolve(str);
}

/**
 * Sanitize a share name from a remote peer's manifest before using it as
 * a folder name on disk. The name comes from the sender and is not
 * trustworthy — it may contain path separators, reserved characters, or
 * `..` traversal segments. This helper strips anything that could escape
 * the destination directory or fail on the host filesystem.
 * Steps, applied in order:
 *   1. Backslashes → forward slashes (normalize separator form).
 *   2. `..` segments removed anywhere they appear.
 *   3. Path separators and Windows-reserved chars replaced with `_`.
 *   4. Leading dots stripped (`.hidden` etc. become `hidden`).
 *   5. Runs of whitespace collapsed to a single space; then trimmed.
 * Returns `null` when the result is empty (all-whitespace, all-punctuation,
 * or literally empty input). Callers must treat null as "no wrap" — do
 * NOT `path.join` a null result.
 * Field-for-field mirror of the mobile client's `sanitizeFolderName` at
 * `backend/hyperdrive-engine.mjs:1347-1357`. Kept identical so both sides
 * produce the same folder name for the same manifest.
 * @param {string} raw - Untrusted share name from a peer's manifest
 * @returns {string|null}
 */
function sanitizeFolderName(raw) {
    if (!raw) return null;
    const cleaned = String(raw)
        .replace(/\\/g, '/')
        .replace(/\.\./g, '')
        .replace(/[/:*?"<>|]/g, '_')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || null;
}

/**
 * Compute a truncation hint for a manifest that declared more files than
 * the receive-side cap allows. Returns { available, shown } when truncation
 * happened, or null when it didn't. The shape and field names match the
 * mobile client's `truncated` field on `engineOpenDrive`'s return value,
 * so any UI code consuming this can treat both sides identically.
 * @param {number} declaredCount - The count the manifest declared (before slice)
 * @param {number} maxCount - The receiver cap (DRIVE_MANIFEST_MAX_FILES)
 * @returns {{ available: number, shown: number } | null}
 */
function computeTruncation(declaredCount, maxCount) {
    if (typeof declaredCount !== 'number' || typeof maxCount !== 'number') return null;
    if (declaredCount > maxCount) {
        return { available: declaredCount, shown: maxCount };
    }
    return null;
}

/**
 * Get a unique file path by appending (1), (2), etc. if file exists
 * Similar to macOS behavior: file.txt → file (1).txt → file (2).txt
 * @param {string} filePath - Original file path
 * @returns {Promise<string>} - Unique file path
 */
async function getUniqueFilePath(filePath) {
    // Check if file exists
    try {
        await fs.access(filePath);
    } catch {
        // File doesn't exist, use original path
        return filePath;
    }
    
    // File exists, generate unique name
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    
    let counter = 1;
    let newPath;
    
    while (true) {
        newPath = path.join(dir, `${baseName} (${counter})${ext}`);
        try {
            await fs.access(newPath);
            counter++;
        } catch {
            // This path doesn't exist, use it
            return newPath;
        }
        
        // Safety limit
        if (counter > 1000) {
            throw new Error('Too many duplicate files');
        }
    }
}

/**
 * Ensure a directory exists, creating it recursively if needed
 * @param {string} dirPath - Directory path
 */
async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Get a unique folder path by appending (1), (2), etc. if folder exists
 * Similar to macOS behavior: folder → folder (1) → folder (2)
 * Works cross-platform (macOS, Windows, Linux)
 * @param {string} folderPath - Original folder path
 * @returns {Promise<string>} - Unique folder path
 */
async function getUniqueFolderPath(folderPath) {
    // Check if folder exists
    try {
        await fs.access(folderPath);
    } catch {
        // Folder doesn't exist, use original path
        return folderPath;
    }
    
    // Folder exists, generate unique name
    const parentDir = path.dirname(folderPath);
    const folderName = path.basename(folderPath);
    
    let counter = 1;
    let newPath;
    
    while (true) {
        newPath = path.join(parentDir, `${folderName} (${counter})`);
        try {
            await fs.access(newPath);
            counter++;
        } catch {
            // This path doesn't exist, use it
            return newPath;
        }
        
        // Safety limit
        if (counter > 1000) {
            throw new Error('Too many duplicate folders');
        }
    }
}

/**
 * Format bytes as human readable string
 * @param {number} bytes 
 * @returns {string} - e.g., "1.5 MB"
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Format speed as human readable string
 * @param {number} bytesPerSec 
 * @returns {string} - e.g., "1.5 MB/s"
 */
function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
    return formatBytes(bytesPerSec) + '/s';
}

module.exports = {
    safeJoin,
    normalizeUserPath,
    sanitizeFolderName,
    computeTruncation,
    getUniqueFilePath,
    getUniqueFolderPath,
    ensureDir,
    formatBytes,
    formatSpeed
};
