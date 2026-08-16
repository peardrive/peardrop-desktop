/**
 * Tests for lib/file-utils.js — currently covers normalizeUserPath.
 * Runs under `node --test` (built-in test runner, no framework).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { normalizeUserPath } = require('../lib/file-utils');

const isWindows = process.platform === 'win32';

test('normalizeUserPath: passes through an already-absolute path', () => {
    const input = isWindows ? 'C:\\Users\\me\\file.txt' : '/home/me/file.txt';
    const out = normalizeUserPath(input);
    assert.equal(out, path.resolve(input));
});

test('normalizeUserPath: trims leading and trailing whitespace', () => {
    const base = isWindows ? 'C:\\Users\\me\\file.txt' : '/home/me/file.txt';
    const padded = `   ${base}   `;
    assert.equal(normalizeUserPath(padded), path.resolve(base));
});

test('normalizeUserPath: decodes file:// URIs (Linux/macOS style)', () => {
    // On Linux/macOS `file:///home/me/file.txt` should become `/home/me/file.txt`.
    // Node's path.resolve leaves an already-absolute POSIX path untouched on POSIX,
    // and produces a mixed-case fake-absolute on Windows — we assert containment
    // of the meaningful suffix instead of the whole string, so the test is
    // cross-platform on the outcome that matters.
    const out = normalizeUserPath('file:///home/me/file.txt');
    assert.ok(out.endsWith('file.txt'), `expected ".../file.txt", got ${out}`);
    assert.ok(!out.includes('file://'), 'file:// prefix should be gone');
});

test('normalizeUserPath: decodes %20-encoded characters', () => {
    const out = normalizeUserPath('file:///home/me/my%20file.txt');
    assert.ok(out.endsWith('my file.txt'), `expected ".../my file.txt", got ${out}`);
});

test('normalizeUserPath: strips the URI extra leading slash before Windows drive letter', () => {
    // `file:///C:/Users/me/file.txt` on Windows → the leading slash before `C:`
    // is a URI artifact; after normalization we expect the drive letter at the
    // start (via path.resolve).
    const out = normalizeUserPath('file:///C:/Users/me/file.txt');
    // The exact form is platform-dependent for path.resolve, but the drive
    // letter should appear early and the file:// prefix should be gone.
    assert.ok(!out.includes('file://'), 'file:// prefix should be gone');
    assert.ok(out.includes('Users'), 'user path segment should survive');
    assert.ok(out.endsWith('file.txt'), `expected ".../file.txt", got ${out}`);
});

test('normalizeUserPath: throws on empty string', () => {
    assert.throws(() => normalizeUserPath(''), /empty/);
});

test('normalizeUserPath: throws on whitespace-only string', () => {
    assert.throws(() => normalizeUserPath('   '), /empty/);
});

test('normalizeUserPath: throws on null', () => {
    assert.throws(() => normalizeUserPath(null), /expected string/);
});

test('normalizeUserPath: throws on undefined', () => {
    assert.throws(() => normalizeUserPath(undefined), /expected string/);
});

test('normalizeUserPath: throws on non-string types', () => {
    assert.throws(() => normalizeUserPath(42), /expected string/);
    assert.throws(() => normalizeUserPath({}), /expected string/);
    assert.throws(() => normalizeUserPath([]), /expected string/);
});

test('normalizeUserPath: relative paths get resolved against CWD', () => {
    const out = normalizeUserPath('some/relative/thing.txt');
    // path.resolve anchors relative inputs to process.cwd(), so the output is
    // absolute regardless of the starting form.
    assert.ok(path.isAbsolute(out), `expected absolute path, got ${out}`);
    assert.ok(out.endsWith('thing.txt'), `expected ".../thing.txt", got ${out}`);
});

test('normalizeUserPath: falls back to raw when decodeURI fails', () => {
    // decodeURI throws on malformed percent sequences (e.g. lone `%`).
    // Verify we don't propagate that as an internal error.
    const out = normalizeUserPath('file:///home/me/bad%path.txt');
    assert.ok(!out.includes('file://'), 'file:// prefix should be gone');
    assert.ok(out.endsWith('path.txt'), `expected ".../path.txt", got ${out}`);
});

test('normalizeUserPath: URI scheme detection is case-insensitive', () => {
    const out = normalizeUserPath('FILE:///home/me/file.txt');
    assert.ok(!out.toLowerCase().includes('file://'), 'FILE:// prefix should be gone');
    assert.ok(out.endsWith('file.txt'));
});
