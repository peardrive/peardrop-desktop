/**
 * MODULE: lib/selection-logic.js
 * PURPOSE: Pure selection-state helpers for the receive-selection
 *          modal. Extracted from the modal DOM code so the mapping decisions
 *          (all-selected → download-all, empty → disabled, summed bytes) can
 *          be unit-tested under `node --test` without launching Electron.
 * DESIGN NOTE:
 *   The renderer holds a `Set<string>` of selected file names as its state;
 *   these helpers operate on that set + the full file list. Membership uses
 *   raw file names as they came from `openResult.files[i].name` — no
 * normalization here. The primitive on the receive side
 *   handles leading-slash normalization on its own (`normalizeKey` in
 *   lib/downloader.js). Callers should pass names verbatim from the manifest.
 * EXPORTS (via window.PearSelectionLogic, also module.exports for tests):
 * computeStats(files, selectedSet)
 *       → { selectedCount, totalCount, selectedBytes, totalBytes, allSelected }
 * toFileNames(files, selectedSet)
 *       → string[] of selected file names, in the same order as `files`
 * shouldPassFileNames(files, selectedSet)
 *       → boolean: false when the caller can/should use the download-all path
 *                  (empty selection OR all-selected) — mirrors the dormancy
 * contract of the primitive.
 * isConfirmDisabled(files, selectedSet)
 *       → boolean: true when no files are selected (button-disabled guard)
 * toggleAll(files, selectedSet, checked)
 *       → new Set<string> — pure, does not mutate the input
 * toggleOne(selectedSet, name, checked)
 *       → new Set<string> — pure, does not mutate the input
 * primaryLabel(files, selectedSet)
 *       → "Download all" or "Download selected (N)"
 * KEY STATE: none (pure functions)
 */
(function (root) {
    'use strict';

    // Stats ------------------------------------------------------------

    function computeStats(files, selectedSet) {
        const list = Array.isArray(files) ? files : [];
        const set = selectedSet instanceof Set ? selectedSet : new Set();
        let selectedBytes = 0;
        let totalBytes = 0;
        let selectedCount = 0;
        for (const f of list) {
            const size = Number(f?.size) || 0;
            totalBytes += size;
            if (set.has(f?.name)) {
                selectedCount += 1;
                selectedBytes += size;
            }
        }
        return {
            selectedCount,
            totalCount: list.length,
            selectedBytes,
            totalBytes,
            allSelected: list.length > 0 && selectedCount === list.length,
        };
    }

    // Mapping to fileNames --------------------------------------------

    function toFileNames(files, selectedSet) {
        const list = Array.isArray(files) ? files : [];
        const set = selectedSet instanceof Set ? selectedSet : new Set();
        const out = [];
        for (const f of list) {
            if (set.has(f?.name)) out.push(f.name);
        }
        return out;
    }

    // When the user has everything checked (or nothing checked), we want the
    // download-all path — no filter, dormancy of the 4E-engine primitive
    // preserved. The renderer passes NO `fileNames` field in that case, so the
    // engine's `wantedSet` is null and every entry is downloaded. This is the
    // fast-path guarantee: open → confirm-without-touching → same behavior as
    // pre-4E-ui.
    function shouldPassFileNames(files, selectedSet) {
        const { selectedCount, totalCount } = computeStats(files, selectedSet);
        if (selectedCount === 0) return false;
        if (selectedCount === totalCount) return false;
        return true;
    }

    // UI state helpers ------------------------------------------------

    // Empty selection = disable the confirm button. Prefer this to letting the
    // receive.empty-drive typed throw surface: don't teach the user by
    // triggering an error.
    function isConfirmDisabled(files, selectedSet) {
        const { selectedCount } = computeStats(files, selectedSet);
        return selectedCount === 0;
    }

    function primaryLabel(files, selectedSet) {
        const { selectedCount, totalCount, allSelected } = computeStats(files, selectedSet);
        if (allSelected || selectedCount === 0) return 'Download all';
        return `Download selected (${selectedCount})`;
    }

    // Pure mutations (return new set) ---------------------------------

    function toggleAll(files, selectedSet, checked) {
        const list = Array.isArray(files) ? files : [];
        if (checked) {
            const out = new Set();
            for (const f of list) if (f?.name) out.add(f.name);
            return out;
        }
        return new Set();
    }

    function toggleOne(selectedSet, name, checked) {
        const out = new Set(selectedSet instanceof Set ? selectedSet : []);
        if (checked) out.add(name);
        else out.delete(name);
        return out;
    }

    const PearSelectionLogic = {
        computeStats,
        toFileNames,
        shouldPassFileNames,
        isConfirmDisabled,
        primaryLabel,
        toggleAll,
        toggleOne,
    };

    if (typeof module === 'object' && module.exports) module.exports = PearSelectionLogic;
    if (root) root.PearSelectionLogic = PearSelectionLogic;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
