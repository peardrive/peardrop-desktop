/**
 * Tests for sanitizeFolderName in lib/file-utils.js.
 * The helper is a field-for-field port of mobile's `sanitizeFolderName`
 * (backend/hyperdrive-engine.mjs:1347-1357). Same regex family, same
 * order of operations, same empty-result-returns-null contract. If either
 * side ever diverges, these tests should fail on desktop and the mobile
 * equivalents should fail on mobile — divergence would be visible.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeFolderName } = require('../lib/file-utils');

test('sanitizeFolderName: plain ASCII name passes through', () => {
    assert.equal(sanitizeFolderName('MyProject'), 'MyProject');
});

test('sanitizeFolderName: traversal segments are stripped', () => {
    // `../evil` → the `..` is removed and the `/` becomes `_`, so what
    // remains is `_evil`. Critically, the return value contains no path
    // separator — path.join(destDir, sanitized) cannot escape destDir.
    const out = sanitizeFolderName('../evil');
    assert.equal(out, '_evil');
    assert.ok(!out.includes('/'), 'must not contain forward slash');
    assert.ok(!out.includes('\\'), 'must not contain backslash');
    assert.ok(!out.includes('..'), 'must not contain a traversal segment');
});

test('sanitizeFolderName: deeper traversal is still contained', () => {
    // Multiple traversal attempts — all removed. Trailing filename kept.
    // Input has four `..` groups, so four slashes survive `..` removal,
    // and each becomes `_` in the separator-replacement step.
    const out = sanitizeFolderName('../../../../etc/passwd');
    assert.equal(out, '____etc_passwd');
    assert.ok(!out.includes('/'));
});

test('sanitizeFolderName: Windows-illegal chars in a legit name', () => {
    // Colons, angle brackets, quotes, pipes, `?`, `*` all become `_`.
    // `/` (POSIX separator) is also mapped to `_` so a name like
    // "MyDoc: v2 / Draft" ends up as a single-level folder name.
    const out = sanitizeFolderName('MyDoc: v2 / Draft');
    assert.equal(out, 'MyDoc_ v2 _ Draft');
    assert.ok(!out.includes(':'));
    assert.ok(!out.includes('/'));
});

test('sanitizeFolderName: leading dots stripped', () => {
    assert.equal(sanitizeFolderName('.hidden'), 'hidden');
    assert.equal(sanitizeFolderName('...triple'), 'triple');
    // Non-leading dots are preserved.
    assert.equal(sanitizeFolderName('a.b.c'), 'a.b.c');
});

test('sanitizeFolderName: whitespace collapsed and trimmed', () => {
    assert.equal(sanitizeFolderName('  spaced   out  name  '), 'spaced out name');
    // Tabs and newlines are whitespace too.
    assert.equal(sanitizeFolderName('mixed\twhitespace\nname'), 'mixed whitespace name');
});

test('sanitizeFolderName: empty result returns null (all-punctuation)', () => {
    // A name that reduces to nothing after cleaning returns null.
    // Callers must treat null as "no wrap".
    assert.equal(sanitizeFolderName('...'), null);
    assert.equal(sanitizeFolderName('..'), null);
});

test('sanitizeFolderName: empty result returns null (all-whitespace)', () => {
    assert.equal(sanitizeFolderName('   '), null);
    assert.equal(sanitizeFolderName('\t\n'), null);
});

test('sanitizeFolderName: empty string returns null', () => {
    assert.equal(sanitizeFolderName(''), null);
});

test('sanitizeFolderName: null / undefined return null', () => {
    // The `!raw` guard catches both without throwing.
    assert.equal(sanitizeFolderName(null), null);
    assert.equal(sanitizeFolderName(undefined), null);
});

test('sanitizeFolderName: zero as input returns null', () => {
    // Number 0 is falsy — the `!raw` guard treats it as "no name" and
    // returns null. This matches mobile's behavior exactly.
    assert.equal(sanitizeFolderName(0), null);
});

test('sanitizeFolderName: unicode names pass through untouched', () => {
    // Non-ASCII, no reserved chars, no separators → returned as-is.
    assert.equal(sanitizeFolderName('日本語'), '日本語');
    assert.equal(sanitizeFolderName('café résumé'), 'café résumé');
});

test('sanitizeFolderName: backslash sequences are normalized to forward slash, then replaced', () => {
    // `\\` → `/` → `_`. So a Windows-style traversal in the manifest
    // (`..\\evil`) is neutralized the same way as its POSIX cousin.
    const out = sanitizeFolderName('..\\evil');
    assert.equal(out, '_evil');
});

test('sanitizeFolderName: mixed slashes with a real name', () => {
    const out = sanitizeFolderName('folder\\sub/name');
    assert.equal(out, 'folder_sub_name');
});

test('sanitizeFolderName: null result must not be usable as a path segment', () => {
    // Documenting the caller contract: a null return signals "no wrap".
    // Every caller in downloader.js and hyperdrive-manager.js checks
    // truthiness on the return value before path.join. This test is a
    // lock-in for the null-return contract so a future refactor that
    // "helpfully" returned "" or "unnamed" instead of null would break
    // this test and force the caller update at the same time.
    const out = sanitizeFolderName('..');
    assert.equal(out, null);
    assert.notEqual(out, '');
    assert.notEqual(out, 'unnamed');
});
