/**
 * Tests for the manifest truncation hint (computeTruncation helper).
 * Runs under `node --test`.
 * The helper is what openDrive and _resumeSeekingDrive use to produce the
 * `truncated` field on their return values. We test the pure helper here;
 * the two integration sites read it and pass it through unchanged, so
 * getting the helper right gets both flows right.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTruncation } = require('../lib/file-utils');

// The receive-side cap — same value as `DRIVE_MANIFEST_MAX_FILES` in
// lib/hyperdrive-manager.js. Kept local to the tests to avoid coupling
// test coverage to a specific constant location.
const CAP = 1000;

test('computeTruncation: 500 declared, cap 1000 → null (under cap)', () => {
    assert.equal(computeTruncation(500, CAP), null);
});

test('computeTruncation: 1000 declared, cap 1000 → null (at cap, no truncation)', () => {
    // Exactly at the cap is NOT truncation — the slice returns all of them.
    assert.equal(computeTruncation(1000, CAP), null);
});

test('computeTruncation: 1001 declared, cap 1000 → { available: 1001, shown: 1000 } (edge case just above cap)', () => {
    assert.deepEqual(computeTruncation(1001, CAP), {
        available: 1001,
        shown: 1000,
    });
});

test('computeTruncation: 1500 declared, cap 1000 → { available: 1500, shown: 1000 }', () => {
    assert.deepEqual(computeTruncation(1500, CAP), {
        available: 1500,
        shown: 1000,
    });
});

test('computeTruncation: 0 declared, cap 1000 → null (empty manifest)', () => {
    assert.equal(computeTruncation(0, CAP), null);
});

test('computeTruncation: non-number declared → null (defensive fallback)', () => {
    // Called with undefined or a string, the helper returns null rather
    // than throwing — the caller is a boundary between a peer's untyped
    // JSON and our engine, and a bad type shouldn't crash the open.
    assert.equal(computeTruncation(undefined, CAP), null);
    assert.equal(computeTruncation('lots', CAP), null);
    assert.equal(computeTruncation(null, CAP), null);
});

test('computeTruncation: non-number cap → null (defensive fallback)', () => {
    assert.equal(computeTruncation(500, undefined), null);
    assert.equal(computeTruncation(500, null), null);
});

test('computeTruncation: field names exactly match mobile — { available, shown }', () => {
    // The point of this test is to fail loudly if anyone renames the fields.
    // Mobile's engine uses these exact keys; if desktop ever drifts, UI code
    // that consumes both sides will break silently on one platform.
    const result = computeTruncation(2000, 1000);
    assert.deepEqual(Object.keys(result).sort(), ['available', 'shown']);
    assert.equal(typeof result.available, 'number');
    assert.equal(typeof result.shown, 'number');
});
