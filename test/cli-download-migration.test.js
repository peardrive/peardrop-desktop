/**
 * Tests for the receive migration.
 * Covers:
 * downloadFromDrive now returns a `destDir` field pointing at the actual
 *     folder written to (post getUniqueFolderPath disambiguation).
 * formatCliError from bin/peardrop renders typed EngineError instances as
 *     "category: message" and passes raw errors through unchanged.
 * NOT covered (Electron-launch-required, listed in the closing summary for
 * the end gate):
 * Actual streaming byte transfer (OOM regression check).
 * Stall watchdog firing on peer disconnect.
 * Path-traversal defense triggering on a hostile manifest.
 * Individual-file collision handling in practice.
 * Mobile interop.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { downloadFromDrive } = require('../lib/downloader');
const {
    EngineError,
    PathTraversalError,
    FileStallError,
} = require('../lib/engine-errors');

// downloadFromDrive return shape --- //

// Minimal drive-like mock: enough surface for downloadFromDrive to run
// through its early-exit path (empty file list) and return without touching
// the network. The test asserts on the shape, not on transfer behavior.
function makeEmptyDriveMock() {
    return {
        // drive.list('/') is an async iterator. We give it an empty one.
        list() {
            return (async function* () {})();
        },
        // drive.getBlobs() returns something with .core (an EventEmitter). The
        // downloader hooks the 'download' event; nothing needs to fire here
        // because we ship zero files.
        async getBlobs() {
            return { core: new EventEmitter() };
        },
        // drive.createReadStream / drive.get are never called on the empty
        // path but stubbed so an inadvertent call fails loudly.
        createReadStream() {
            throw new Error('createReadStream should not be called with empty file list');
        },
        async get() {
            throw new Error('get should not be called with empty file list');
        },
    };
}

test('downloadFromDrive: return includes destDir (no wrap case)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peardrop-4f-'));
    try {
        const drive = makeEmptyDriveMock();
        const result = await downloadFromDrive(drive, {
            destDir: tmp,
            totalBytes: 0,
            shareName: null,  // no wrap
        });
        assert.equal(result.destDir, tmp, 'destDir should equal input destDir when there is no folder wrap');
        // Sanity: full return shape.
        assert.deepEqual(Object.keys(result).sort(), ['destDir', 'duration', 'failed', 'files', 'totalBytes']);
        assert.deepEqual(result.files, []);
        assert.deepEqual(result.failed, []);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('downloadFromDrive: return includes destDir (folder wrap case)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peardrop-4f-'));
    try {
        const drive = makeEmptyDriveMock();
        // A shareName with no dot triggers the folder-wrap path even for an
        // empty file list — the isFolderShare condition is `(files > 1 ||
        // (shareName && !shareName.includes('.')))`.
        const result = await downloadFromDrive(drive, {
            destDir: tmp,
            totalBytes: 0,
            shareName: 'my-project',
        });
        // destDir should be inside tmp, wrapped in `my-project` (or a
        // `(1)`-disambiguated variant if the folder happened to exist).
        assert.ok(result.destDir.startsWith(tmp + path.sep),
            `destDir "${result.destDir}" should be inside "${tmp}"`);
        // The folder was created by ensureDir; verify it exists on disk.
        assert.ok(fs.existsSync(result.destDir), 'wrapped folder should exist on disk');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('downloadFromDrive: destDir disambiguates when folder already exists (R7)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peardrop-4f-'));
    try {
        // Pre-create a folder that matches the sanitized shareName.
        const preExisting = path.join(tmp, 'my-project');
        fs.mkdirSync(preExisting, { recursive: true });

        const drive = makeEmptyDriveMock();
        const result = await downloadFromDrive(drive, {
            destDir: tmp,
            totalBytes: 0,
            shareName: 'my-project',
        });
        // The disambiguation should have picked `my-project (1)`.
        assert.notEqual(result.destDir, preExisting,
            'destDir should NOT reuse the pre-existing folder');
        assert.ok(result.destDir.includes('(1)'),
            `destDir "${result.destDir}" should contain "(1)" from getUniqueFolderPath`);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

// CLI formatCliError renders typed errors correctly --- //
// We inline the helper (matching bin/peardrop lines 38-46) rather than
// spawning the CLI as a subprocess — the CLI's `main().catch` and
// `process.exit(1)` are hard to intercept and the helper is pure.

function formatCliError(err) {
    if (err instanceof EngineError) {
        return `${err.category}: ${err.message}`;
    }
    return err && err.message ? err.message : String(err);
}

test('formatCliError: renders EngineError as "category: message"', () => {
    const err = new EngineError({
        category: 'receive.no-session',
        cause: 'session-not-found',
        message: 'Session not found',
    });
    assert.equal(formatCliError(err), 'receive.no-session: Session not found');
});

test('formatCliError: renders PathTraversalError (Sprint 4D lock-in) with category prefix', () => {
    const err = new PathTraversalError('unsafe path outside download folder: ../evil', {
        key: '../evil',
    });
    assert.equal(
        formatCliError(err),
        'receive.path-traversal: unsafe path outside download folder: ../evil',
    );
});

test('formatCliError: renders FileStallError (Sprint 4D lock-in) with category prefix', () => {
    const err = new FileStallError('stalled: no data for 60s', {
        file: '/big.mp4',
    });
    assert.equal(formatCliError(err), 'receive.stall: stalled: no data for 60s');
});

test('formatCliError: passes raw Error through unchanged', () => {
    const err = new Error('legacy raw error');
    assert.equal(formatCliError(err), 'legacy raw error');
});

test('formatCliError: handles Error with no message', () => {
    const err = new Error();
    // Falls back to String(err) → "Error" from Error.prototype.toString.
    // (Documented in notes as the ergonomic-edge-case fallback.)
    assert.equal(formatCliError(err), 'Error');
});

test('formatCliError: handles non-Error thrown values', () => {
    assert.equal(formatCliError('a bare string'), 'a bare string');
    assert.equal(formatCliError(42), '42');
    assert.equal(formatCliError(null), 'null');
});

// Migration correctness: openDrive no longer exposes downloadAll / downloadFile --- //
// A tripwire. If a future refactor accidentally reintroduces the closures,
// this test fails and forces a decision. We inspect the module's source
// rather than instantiate a manager (which needs a HyperdriveManager).

test('openDrive return no longer exposes downloadAll or downloadFile closures', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'hyperdrive-manager.js'),
        'utf8',
    );
    // Any closure named downloadAll/downloadFile in the openDrive scope
    // would appear as `downloadAll:` or `downloadFile:` in an object literal.
    // Grep the source string for those key patterns.
    assert.ok(!/^\s*downloadAll:/m.test(src),
        'downloadAll closure should be retired from openDrive return');
    assert.ok(!/^\s*downloadFile:/m.test(src),
        'downloadFile closure should be retired from openDrive return');
    // Sanity: the drive field the CLI now uses should be present.
    assert.ok(/^\s*drive,/m.test(src) || /\bdrive:\s*drive\b/.test(src),
        'openDrive return should expose the drive');
    // Sanity: the close closure the CLI still uses should still be present.
    assert.ok(/^\s*close:/m.test(src),
        'close closure should still be present');
});
