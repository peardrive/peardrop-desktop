/**
 * MODULE: lib/status-mapping.js
 * PURPOSE: Pure mapping from (backend drive.state, resumeErrors presence) to
 *          the renderer's display status. Extracted so the decision can be
 *          unit-tested under `node --test` without launching Electron.
 * DESIGN NOTE:
 *   The backend deliberately does NOT persist ERRORED for transient hydrate
 *   failures (see hyperdrive-manager.js:1420-1424 "resume failures are usually
 *   transient; persisting ERRORED permanently demoted good drives"). So a
 *   drive whose corestore couldn't be reopened at boot keeps its manifest
 *   state as `active` (or `seeking`), and the failure lives only in the
 *   in-memory `resumeErrors` map.
 *   Without this mapping, such a drive rendered as "Sharing" — the exact
 *   truthfulness gap this module closes. When resumeErrors carries an entry
 *   for the drive AND the drive's state would otherwise show as sharing or
 *   connecting, the display switches to a neutral `inactive` status
 *   (dimmed, no animation, Retry-available) so the UI tells the truth
 *   without alarming on a transient boot failure.
 * EXPORTS (via window.PearStatusMapping, also module.exports for tests):
 * STATE_TO_STATUS - the backend→display map
 * deriveStatus(drive, resumeErrors)
 *       → the display status string, taking resumeErrors into account
 * KEY STATE: none (pure functions)
 */
(function (root) {
    'use strict';

    // Backend DriveState → renderer display status. Unchanged from the
    // pre-sprint mapping in renderer.js; kept here as the single source.
    const STATE_TO_STATUS = {
        active: 'sharing',
        paused: 'paused',
        errored: 'error',
        seeking: 'connecting',
        creating: 'connecting'
    };

    // Derive the display status for a single drive, taking resumeErrors into
    // account. `resumeErrors` is expected to be a plain object keyed by
    // driveId (this is the shape sent over IPC), OR a Map (renderer may
    // choose to hold it as a Map). Both are handled.
    // Rules:
    //  1. If the drive already carries an explicit `status` field, that wins
    //     (renderer sometimes constructs synthetic entries with a status).
    //  2. If resumeErrors has an entry for the drive AND the backend state
    //     would otherwise render as `sharing` or `connecting`, return
    //     `inactive` — the drive isn't actually running, don't render it as
    //     healthy or in-progress.
    //  3. Otherwise fall back to the STATE_TO_STATUS map, or `sharing` if
    //     nothing matches (matches the pre-sprint fallback at
    //     renderer.js:1252).
    function deriveStatus(drive, resumeErrors) {
        if (drive && drive.status) return drive.status;

        const state = drive && drive.state;
        const id = drive && (drive.id || drive.driveId);

        const hasResumeError = id && hasResumeErrorFor(resumeErrors, id);
        const baseStatus = STATE_TO_STATUS[state] || 'sharing';

        if (hasResumeError && (baseStatus === 'sharing' || baseStatus === 'connecting')) {
            return 'inactive';
        }
        return baseStatus;
    }

    function hasResumeErrorFor(resumeErrors, id) {
        if (!resumeErrors) return false;
        if (typeof resumeErrors.has === 'function') return resumeErrors.has(id);
        return Object.prototype.hasOwnProperty.call(resumeErrors, id);
    }

    const PearStatusMapping = { STATE_TO_STATUS, deriveStatus };

    if (typeof module === 'object' && module.exports) module.exports = PearStatusMapping;
    if (root) root.PearStatusMapping = PearStatusMapping;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
