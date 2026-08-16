/**
 * Tests for lib/selection-logic.js — the pure selection-state helpers behind
 * the receive-selection modal.
 * The modal UI itself needs Electron to test (checkbox events, disabled state,
 * cancel behavior). These tests cover the mapping decisions that must be
 * correct regardless of the DOM: all-selected → download-all fast path,
 * empty-selection → button-disabled, count/bytes math, pure-mutation semantics.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    computeStats,
    toFileNames,
    shouldPassFileNames,
    isConfirmDisabled,
    primaryLabel,
    toggleAll,
    toggleOne,
} = require('../lib/selection-logic');

const FILES = [
    { name: 'a.txt', size: 100 },
    { name: 'b.txt', size: 250 },
    { name: 'c.txt', size: 400 },
];

// computeStats ------------------------------------------------------------

test('computeStats: empty selection over full list', () => {
    const stats = computeStats(FILES, new Set());
    assert.equal(stats.selectedCount, 0);
    assert.equal(stats.totalCount, 3);
    assert.equal(stats.selectedBytes, 0);
    assert.equal(stats.totalBytes, 750);
    assert.equal(stats.allSelected, false);
});

test('computeStats: full selection sums correctly', () => {
    const stats = computeStats(FILES, new Set(['a.txt', 'b.txt', 'c.txt']));
    assert.equal(stats.selectedCount, 3);
    assert.equal(stats.selectedBytes, 750);
    assert.equal(stats.allSelected, true);
});

test('computeStats: partial selection sums only selected', () => {
    const stats = computeStats(FILES, new Set(['a.txt', 'c.txt']));
    assert.equal(stats.selectedCount, 2);
    assert.equal(stats.selectedBytes, 500);
    assert.equal(stats.allSelected, false);
});

test('computeStats: empty file list → allSelected is false', () => {
    // Edge case: no files at all shouldn't claim "all selected" — the empty
    // set matches the empty list, but there's nothing to download either.
    const stats = computeStats([], new Set());
    assert.equal(stats.allSelected, false);
    assert.equal(stats.totalCount, 0);
});

test('computeStats: missing size on a file counts as zero, not NaN', () => {
    const stats = computeStats(
        [{ name: 'x', size: null }, { name: 'y', size: 200 }],
        new Set(['x', 'y'])
    );
    assert.equal(stats.selectedBytes, 200);
    assert.equal(stats.totalBytes, 200);
});

// toFileNames -------------------------------------------------------------

test('toFileNames: preserves file-list order, not set iteration order', () => {
    // Sets have insertion order in JS but it's not the list order. Assert that
    // the output tracks the FILES order, so callers get a stable ordering.
    const set = new Set(['c.txt', 'a.txt']); // reverse insertion order
    const out = toFileNames(FILES, set);
    assert.deepEqual(out, ['a.txt', 'c.txt']);
});

test('toFileNames: names not in file list are silently ignored', () => {
    const set = new Set(['a.txt', 'ghost.txt']);
    const out = toFileNames(FILES, set);
    assert.deepEqual(out, ['a.txt']);
});

// shouldPassFileNames (the dormancy contract) -----------------------------

test('shouldPassFileNames: all-selected → false (download-all fast path)', () => {
    // Critical: when the user has everything checked, the caller should NOT
    // pass fileNames. This preserves the dormancy: null
    // fileNames → null wantedSet → download every entry, byte-for-byte the
    // same as pre-4E behavior.
    const set = new Set(['a.txt', 'b.txt', 'c.txt']);
    assert.equal(shouldPassFileNames(FILES, set), false);
});

test('shouldPassFileNames: empty selection → false (avoid empty-drive throw)', () => {
    // Belt-and-braces: if the empty guard on the button fails somehow, this
    // still steers to download-all rather than triggering the
    // receive.empty-drive typed throw from downloader.js. The button-disabled
    // logic (isConfirmDisabled) is the primary defense; this is defense in
    // depth.
    assert.equal(shouldPassFileNames(FILES, new Set()), false);
});

test('shouldPassFileNames: partial selection → true (filter path)', () => {
    assert.equal(shouldPassFileNames(FILES, new Set(['a.txt'])), true);
    assert.equal(shouldPassFileNames(FILES, new Set(['a.txt', 'b.txt'])), true);
});

// isConfirmDisabled (empty-selection guard) -------------------------------

test('isConfirmDisabled: empty selection → true (button disabled)', () => {
    assert.equal(isConfirmDisabled(FILES, new Set()), true);
});

test('isConfirmDisabled: any selection → false', () => {
    assert.equal(isConfirmDisabled(FILES, new Set(['a.txt'])), false);
    assert.equal(isConfirmDisabled(FILES, new Set(['a.txt', 'b.txt', 'c.txt'])), false);
});

// primaryLabel ------------------------------------------------------------

test('primaryLabel: all-selected → "Download all"', () => {
    assert.equal(primaryLabel(FILES, new Set(['a.txt', 'b.txt', 'c.txt'])), 'Download all');
});

test('primaryLabel: empty → "Download all" (button will be disabled anyway)', () => {
    // Label stays consistent when disabled — the disabled state carries the
    // "can't fire" signal; the label doesn't need to become "Download 0".
    assert.equal(primaryLabel(FILES, new Set()), 'Download all');
});

test('primaryLabel: partial → "Download selected (N)"', () => {
    assert.equal(primaryLabel(FILES, new Set(['a.txt'])), 'Download selected (1)');
    assert.equal(primaryLabel(FILES, new Set(['a.txt', 'c.txt'])), 'Download selected (2)');
});

// toggleAll / toggleOne: purity + correctness -----------------------------

test('toggleAll(checked=true): returns new set containing every file name', () => {
    const original = new Set(['a.txt']);
    const out = toggleAll(FILES, original, true);
    assert.notEqual(out, original, 'must be a new set (purity)');
    assert.equal(out.size, 3);
    assert.ok(out.has('a.txt') && out.has('b.txt') && out.has('c.txt'));
    // Original untouched:
    assert.equal(original.size, 1);
});

test('toggleAll(checked=false): returns empty set', () => {
    const original = new Set(['a.txt', 'b.txt', 'c.txt']);
    const out = toggleAll(FILES, original, false);
    assert.notEqual(out, original);
    assert.equal(out.size, 0);
    assert.equal(original.size, 3, 'original untouched');
});

test('toggleOne(check=true): adds; toggleOne(check=false): removes', () => {
    const s0 = new Set(['a.txt']);
    const s1 = toggleOne(s0, 'b.txt', true);
    assert.ok(s1.has('a.txt') && s1.has('b.txt'));
    assert.equal(s0.size, 1, 'original untouched');

    const s2 = toggleOne(s1, 'a.txt', false);
    assert.ok(!s2.has('a.txt') && s2.has('b.txt'));
    assert.equal(s1.size, 2, 's1 untouched');
});

// End-to-end: the mapping the modal actually performs on confirm ---------

test('confirm path: partial selection maps to filter, all-selected maps to null', () => {
    // Simulates what the modal does on the confirm button: check
    // shouldPassFileNames, then either pass toFileNames() or null.
    function mapConfirm(files, set) {
        return shouldPassFileNames(files, set)
            ? { fileNames: toFileNames(files, set) }
            : { fileNames: null };
    }

    // Partial → filter path
    assert.deepEqual(
        mapConfirm(FILES, new Set(['a.txt', 'c.txt'])),
        { fileNames: ['a.txt', 'c.txt'] }
    );

    // All → download-all path (fileNames: null; engine's wantedSet stays null)
    assert.deepEqual(
        mapConfirm(FILES, new Set(['a.txt', 'b.txt', 'c.txt'])),
        { fileNames: null }
    );

    // Empty guarded upstream, but if it slips through: also download-all.
    // (The button-disabled state in the modal should never let this reach
    // mapConfirm, but the mapping is defensive on its own.)
    assert.deepEqual(
        mapConfirm(FILES, new Set()),
        { fileNames: null }
    );
});
