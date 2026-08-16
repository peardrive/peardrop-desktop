/**
 * Tests for the per-file selection primitive on
 * downloadFromDrive.
 * The primitive is landed dormant: no caller passes `fileNames` yet.
 * These tests validate the filter behavior + the dormancy guarantee
 * (a no-fileNames call selects exactly the same files as before).
 * Streaming behavior (actual byte transfer) requires Electron per Sprint
 * 4W's ELECTRON_RUN_AS_NODE=1 finding. Same launch-required list from
 * applies.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { downloadFromDrive } = require('../lib/downloader');
const { EngineError } = require('../lib/engine-errors');

// Drive mock. `entries` is the list of manifest keys the mock's list('/')
// should yield. downloadFromDrive iterates and (this sprint) filters
// against the wanted-set BEFORE calling createReadStream, so we can
// prove selection semantics by asserting on what filesToDownload looks
// like. To assert the actual filter effect, we intercept createReadStream
// and record which keys were pulled — then no bytes actually flow.
function makeDriveMock(entries) {
    const pulled = [];
    const drive = {
        list() {
            return (async function* () {
                for (const key of entries) yield { key };
            })();
        },
        async getBlobs() {
            return { core: new EventEmitter() };
        },
        createReadStream(key) {
            pulled.push(key);
            // Return an empty stream that completes immediately. The
            // downloader pipes it into a writeStream; we get a zero-byte
            // file per pulled entry. That's enough for the assertions.
            const { Readable } = require('node:stream');
            return Readable.from([]);
        },
    };
    return { drive, pulled };
}

// Convenience: run downloadFromDrive with a fresh tmp destDir and return
// { result, pulled, tmp } for assertions. The caller is responsible for
// cleanup.
async function runDownload(entries, opts = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'peardrop-4e-'));
    const { drive, pulled } = makeDriveMock(entries);
    try {
        const result = await downloadFromDrive(drive, {
            destDir: tmp,
            totalBytes: 0,
            shareName: null,
            ...opts,
        });
        return { result, pulled, tmp };
    } catch (err) {
        // Preserve tmp on failure so tests can inspect state before it's
        // cleaned up. Caller-side cleanup happens in `finally` blocks.
        err._tmpForCleanup = tmp;
        throw err;
    }
}

function cleanupTmp(tmp) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

// Filter behavior --- //

test('fileNames subset: only matching entries are pulled', async () => {
    // Sender drive has 3 files, caller selects 2 by name.
    const { result, pulled, tmp } = await runDownload(
        ['/a.txt', '/b.txt', '/c.txt'],
        { fileNames: ['a.txt', 'c.txt'] },
    );
    try {
        // Only a.txt and c.txt got pulled; b.txt was filtered out before
        // the read stream was ever requested.
        assert.deepEqual(pulled.sort(), ['/a.txt', '/c.txt']);
        assert.equal(result.files.length, 2);
        assert.equal(result.failed.length, 0);
    } finally { cleanupTmp(tmp); }
});

test('fileNames normalization: leading slash on caller keys still matches', async () => {
    // The wanted-set should normalize both sides (mobile's normalizeKey).
    // Caller passing "/a.txt" should match drive key "/a.txt" the same as
    // if the caller passed "a.txt".
    const { pulled, tmp } = await runDownload(
        ['/a.txt', '/b.txt'],
        { fileNames: ['/a.txt'] },   // caller-side leading slash
    );
    try {
        assert.deepEqual(pulled, ['/a.txt']);
    } finally { cleanupTmp(tmp); }
});

test('fileNames normalization: caller without slash still matches keys with slash', async () => {
    // Reciprocal: caller passes "a.txt" but the drive stores "/a.txt".
    const { pulled, tmp } = await runDownload(
        ['/a.txt', '/b.txt'],
        { fileNames: ['a.txt'] },
    );
    try {
        assert.deepEqual(pulled, ['/a.txt']);
    } finally { cleanupTmp(tmp); }
});

test('fileNames subset: manifest key is skipped even if selection contains it', async () => {
    // The /.peardrop.json manifest key is filtered out before the
    // fileNames check runs. Even a mischievous selection that lists it
    // shouldn't cause the manifest to be pulled.
    const { pulled, tmp } = await runDownload(
        ['/.peardrop.json', '/a.txt'],
        { fileNames: ['.peardrop.json', 'a.txt'] },
    );
    try {
        assert.deepEqual(pulled, ['/a.txt']);
    } finally { cleanupTmp(tmp); }
});

// Dormancy: absent / empty fileNames downloads all --- //

test('dormancy: absent fileNames selects every non-manifest entry (byte-for-byte same as before)', async () => {
    // The pre-Sprint-4E-engine behavior downloaded every entry except the
    // manifest. Assert that behavior is preserved when fileNames is
    // absent.
    const { pulled, tmp } = await runDownload(
        ['/.peardrop.json', '/a.txt', '/b.txt', '/c.txt'],
        {},   // no fileNames
    );
    try {
        assert.deepEqual(pulled.sort(), ['/a.txt', '/b.txt', '/c.txt']);
    } finally { cleanupTmp(tmp); }
});

test('dormancy: fileNames: null selects every entry', async () => {
    // A caller who passes `fileNames: null` explicitly should behave
    // identically to a caller who omits the field. Guards against a
    // future refactor that changes the null-check semantics.
    const { pulled, tmp } = await runDownload(
        ['/a.txt', '/b.txt'],
        { fileNames: null },
    );
    try {
        assert.deepEqual(pulled.sort(), ['/a.txt', '/b.txt']);
    } finally { cleanupTmp(tmp); }
});

test('dormancy: fileNames: [] (empty array) selects every entry', async () => {
    // An empty array is treated as "no selection provided" — matches
    // mobile's `Array.isArray(fileNames) && fileNames.length` check.
    const { pulled, tmp } = await runDownload(
        ['/a.txt', '/b.txt'],
        { fileNames: [] },
    );
    try {
        assert.deepEqual(pulled.sort(), ['/a.txt', '/b.txt']);
    } finally { cleanupTmp(tmp); }
});

// Empty-after-filter: typed error --- //

test('empty-after-filter throws EngineError with receive.empty-drive category', async () => {
    // Selection provided, but every requested name is absent from the
    // drive. Mirror mobile's typed failure (mobile uses one category
    // for both empty cases; desktop applies the throw only to the
    // fileNames-was-passed case per the dormancy guarantee).
    let caught;
    try {
        await runDownload(
            ['/a.txt', '/b.txt'],
            { fileNames: ['does-not-exist.txt'] },
        );
    } catch (err) {
        caught = err;
    }
    assert.ok(caught, 'expected a throw');
    assert.ok(caught instanceof EngineError, 'expected an EngineError');
    assert.equal(caught.category, 'receive.empty-drive');
    assert.equal(caught.cause, 'no-files-selected');
    assert.equal(caught.message, 'No files in drive.');
    // Detail should carry how many names were requested (a caller aid,
    // not required for the failure signal but useful in logs).
    assert.equal(caught.detail && caught.detail.requested, 1);
    cleanupTmp(caught._tmpForCleanup);
});

test('empty-after-filter: partial mismatch still succeeds on the matches', async () => {
    // Selection has two names, one matches, one doesn't. The one match
    // should download; no throw. failed[] stays empty (mismatch isn't
    // per-file failure — it's a wanted-set miss, silently omitted).
    const { result, pulled, tmp } = await runDownload(
        ['/a.txt', '/b.txt'],
        { fileNames: ['a.txt', 'nonexistent.txt'] },
    );
    try {
        assert.deepEqual(pulled, ['/a.txt']);
        assert.equal(result.files.length, 1);
        assert.equal(result.failed.length, 0);
    } finally { cleanupTmp(tmp); }
});

test('dormancy: genuinely-empty drive with no fileNames returns empty arrays, does NOT throw', async () => {
    // The pre-Sprint-4E-engine behavior on an empty drive (no manifest,
    // no files) was to return {files: [], failed: [], totalBytes: 0, ...}.
    // 's typed throw is scoped to the
    // fileNames-was-passed case only, so an empty drive with no selection
    // must still return the empty-arrays shape. Dormancy lock-in.
    const { result, tmp } = await runDownload([], {});
    try {
        assert.equal(result.files.length, 0);
        assert.equal(result.failed.length, 0);
        assert.equal(result.totalBytes, 0);
        assert.ok('destDir' in result, 'destDir should still be present');
    } finally { cleanupTmp(tmp); }
});

// Precedence check (mobile compat: no legacy fileName here yet) --- //

test('desktop mirrors mobile precedence: fileNames present + non-empty wins over absent', async () => {
    // Mobile's engineDownload has a legacy `fileName` (singular) param for
    // older callers. Desktop's downloadFromDrive doesn't expose that
    // legacy param (never had it), so precedence on desktop is simply
    // "fileNames non-empty → filter; else → all". The precedence "block"
    // of this test is the sanity check that adding fileNames doesn't
    // regress the no-fileNames path.
    const A = await runDownload(['/x.txt', '/y.txt'], {});
    const B = await runDownload(['/x.txt', '/y.txt'], { fileNames: ['x.txt'] });
    try {
        assert.deepEqual(A.pulled.sort(), ['/x.txt', '/y.txt']);
        assert.deepEqual(B.pulled, ['/x.txt']);
    } finally { cleanupTmp(A.tmp); cleanupTmp(B.tmp); }
});
