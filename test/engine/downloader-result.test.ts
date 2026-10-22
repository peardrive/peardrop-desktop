/**
 * downloadFromDrive's result shape.
 * Covers:
 * downloadFromDrive now returns a `destDir` field pointing at the actual
 *     folder written to (post getUniqueFolderPath disambiguation).
 * NOT covered (Electron-launch-required, listed in the closing summary for
 * the end gate):
 * Actual streaming byte transfer (OOM regression check).
 * Stall watchdog firing on peer disconnect.
 * Path-traversal defense triggering on a hostile manifest.
 * Individual-file collision handling in practice.
 * Mobile interop.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import { downloadFromDrive } from '@engine/hyperdrive/downloader';

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

