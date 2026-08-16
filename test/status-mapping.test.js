/**
 * Tests for lib/status-mapping.js — the pure decision that turns
 * (drive.state, resumeErrors presence) into a display status.
 * The core assertion is that a drive whose manifest state is `active` but
 * whose hydrate failed at boot renders as `inactive` — never `sharing`.
 * That's the truthfulness gap Sprint 5A closed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { STATE_TO_STATUS, deriveStatus } = require('../lib/status-mapping');

// Sanity on the exported map ----------------------------------------------

test('STATE_TO_STATUS covers every backend state', () => {
    // Backend DriveState enum: creating, active, seeking, paused, errored
    // (also has a STOPPED legacy alias that normalizes to inactive server-side,
    // never reaches the renderer as a distinct state).
    assert.equal(STATE_TO_STATUS.active, 'sharing');
    assert.equal(STATE_TO_STATUS.paused, 'paused');
    assert.equal(STATE_TO_STATUS.errored, 'error');
    assert.equal(STATE_TO_STATUS.seeking, 'connecting');
    assert.equal(STATE_TO_STATUS.creating, 'connecting');
});

// The resumeErrors merge (the load-bearing rule) --------------------------

test('active + resumeError → inactive (the Cluster 1 fix)', () => {
    const drive = { id: 'drive_x', state: 'active' };
    const resumeErrors = { drive_x: { error: 'Storage directory missing', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'inactive');
});

test('active + no resumeError → sharing', () => {
    const drive = { id: 'drive_y', state: 'active' };
    assert.equal(deriveStatus(drive, {}), 'sharing');
});

test('seeking + resumeError → inactive', () => {
    // Boot resume attempts a seeking drive; if that hydrate throws (e.g. the
    // stored corestore path is gone), the manifest state stays `seeking` per
    // the no-persist-ERRORED policy — so the merge has to catch this too.
    const drive = { id: 'd', state: 'seeking' };
    const resumeErrors = { d: { error: 'Corestore open failed', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'inactive');
});

test('seeking + no resumeError → connecting (unchanged)', () => {
    const drive = { id: 'd', state: 'seeking' };
    assert.equal(deriveStatus(drive, {}), 'connecting');
});

test('paused + resumeError → paused (the resume-error signal does not override paused)', () => {
    // A user-paused drive should render as paused regardless of any lingering
    // resumeError. The `inactive` mapping is specifically for drives whose
    // manifest state would otherwise say they're running.
    const drive = { id: 'd', state: 'paused' };
    const resumeErrors = { d: { error: 'stale', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'paused');
});

test('errored + resumeError → error (unaffected)', () => {
    const drive = { id: 'd', state: 'errored' };
    const resumeErrors = { d: { error: 'stale', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'error');
});

// Explicit status override -----------------------------------------------

test('drive with explicit status field wins over any mapping', () => {
    // The renderer sometimes constructs synthetic entries with a status
    // (e.g. the connecting placeholder before a real drive lands). Those
    // must render as-provided.
    const drive = { id: 'temp', status: 'downloading', state: 'active' };
    const resumeErrors = { temp: { error: 'x', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'downloading');
});

// resumeErrors accepts both plain object and Map -------------------------

test('resumeErrors as a plain object is honored', () => {
    const drive = { id: 'a', state: 'active' };
    assert.equal(deriveStatus(drive, { a: { error: 'x', at: 1 } }), 'inactive');
});

test('resumeErrors as a Map is honored', () => {
    const drive = { id: 'a', state: 'active' };
    const m = new Map();
    m.set('a', { error: 'x', at: 1 });
    assert.equal(deriveStatus(drive, m), 'inactive');
});

test('resumeErrors null/undefined does not throw', () => {
    const drive = { id: 'a', state: 'active' };
    assert.equal(deriveStatus(drive, null), 'sharing');
    assert.equal(deriveStatus(drive, undefined), 'sharing');
});

// Unknown state falls through to `sharing` (pre-sprint contract) ---------

test('unknown state without resumeError falls back to sharing (pre-sprint contract)', () => {
    // Matches the pre-sprint renderer fallback at renderer.js:1252:
    // `drive.status || STATE_TO_STATUS[drive.state] || 'sharing'`.
    const drive = { id: 'a', state: 'weird-future-state' };
    assert.equal(deriveStatus(drive, {}), 'sharing');
});

test('unknown state WITH resumeError still becomes inactive', () => {
    // The merge should still fire — the fallback baseStatus is `sharing`,
    // which is one of the two statuses the merge rule catches.
    const drive = { id: 'a', state: 'weird-future-state' };
    const resumeErrors = { a: { error: 'x', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'inactive');
});

// driveId lookup covers both `id` and `driveId` fields -------------------

test('lookup uses drive.id first, then drive.driveId', () => {
    // Backend payloads sometimes carry `driveId`; renderer normalizes to
    // `id`. The mapping must work regardless of which shape it sees.
    const drive = { driveId: 'canonical', state: 'active' };
    const resumeErrors = { canonical: { error: 'x', at: 1 } };
    assert.equal(deriveStatus(drive, resumeErrors), 'inactive');
});

// Defensive nulls --------------------------------------------------------

test('null drive does not throw', () => {
    // The renderer shouldn't hand us null, but if it does the mapping should
    // fall through to the default rather than crashing.
    assert.equal(deriveStatus(null, {}), 'sharing');
});
