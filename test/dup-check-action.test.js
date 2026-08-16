/**
 * Tests for lib/dup-check-action.js — the pure three-way decision the
 * renderer makes after `hyperdrive-check-duplicate` returns.
 * The load-bearing rule is: a duplicate hit with `localStatus: 'missing'`
 * (leftover stub from a cancelled/crashed open, or manual file deletion)
 * must produce a `confirm-redownload` action rather than a dead
 * "Already downloaded" block. That's the Cluster 3 renderer fix.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { decideDupCheckAction } = require('../lib/dup-check-action');

test('not a duplicate → proceed', () => {
    const out = decideDupCheckAction({ isDuplicate: false });
    assert.equal(out.action, 'proceed');
});

test('duplicate + localStatus:available → block', () => {
    const out = decideDupCheckAction({
        isDuplicate: true,
        localStatus: 'available',
        driveId: 'd1',
        existingDrive: { id: 'd1', name: 'MyShare' },
    });
    assert.equal(out.action, 'block');
    assert.equal(out.driveId, 'd1');
    assert.equal(out.existingDrive.name, 'MyShare');
});

test('duplicate + localStatus:missing → confirm-redownload (the Cluster 3 fix)', () => {
    const out = decideDupCheckAction({
        isDuplicate: true,
        localStatus: 'missing',
        driveId: 'stub_1',
    });
    assert.equal(out.action, 'confirm-redownload');
    assert.equal(out.driveId, 'stub_1');
});

test('duplicate with no localStatus → block (defensive default)', () => {
    // If the backend ever forgets to include localStatus, we should NOT
    // silently start a re-download. Blocking matches the pre-sprint
    // behavior, so the fallback is at least no worse than what shipped.
    const out = decideDupCheckAction({
        isDuplicate: true,
        driveId: 'd2',
    });
    assert.equal(out.action, 'block');
});

test('duplicate with unknown localStatus → block (defensive default)', () => {
    // Same reasoning as above: anything we don't recognize gets blocked,
    // never proceeded silently.
    const out = decideDupCheckAction({
        isDuplicate: true,
        localStatus: 'inconclusive',
        driveId: 'd3',
    });
    assert.equal(out.action, 'block');
});

test('null / undefined input → proceed (nothing to key against)', () => {
    // If the IPC call returned nothing at all, treat it as not-a-duplicate
    // rather than blocking a user's paste. Pre-sprint behavior was identical.
    assert.equal(decideDupCheckAction(null).action, 'proceed');
    assert.equal(decideDupCheckAction(undefined).action, 'proceed');
});

test('existingDrive is preserved through the block action', () => {
    // The renderer uses existingDrive.id to highlight the row — verify the
    // shape flows through.
    const existingDrive = { id: 'd1', name: 'MyShare', files: [{ name: 'a.txt' }] };
    const out = decideDupCheckAction({
        isDuplicate: true,
        localStatus: 'available',
        driveId: 'd1',
        existingDrive,
    });
    assert.equal(out.existingDrive, existingDrive);
});

test('existingDrive omitted → block action carries null (does not crash)', () => {
    // Defensive: the backend always sends existingDrive today, but the
    // renderer should tolerate a payload without it. Absence must not
    // throw or produce a truthy dangling reference.
    const out = decideDupCheckAction({ isDuplicate: true, localStatus: 'available', driveId: 'd1' });
    assert.equal(out.existingDrive, null);
});
