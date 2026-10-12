/**
 * MODULE: lib/engine-errors.js
 * PURPOSE: Structured error taxonomy for the engine layer
 * Every engine failure — thrown or returned via {success:false, error} —
 * carries:
 * category: dot-namespaced bucket, stable across releases
 *     (e.g. "receive.stall", "receive.path-traversal"). Callers may
 *     branch on prefix.
 * cause: short machine-readable identifier within the category
 *     (e.g. "file-stall", "peer-path-traversal").
 * message: human-readable, for logs and (eventually) UI. Never for
 *     control flow.
 * detail?: JSON-serializable structured payload — offending path,
 *     original error code, size, etc.
 * Wire transport. `toJSON()` produces a plain object with the four
 * fields; `JSON.stringify` calls it automatically. The receive-path IPC
 * handlers in main.js attach `errorDetail: error.toJSON()` as a sibling
 * of the existing string `error` field, so the renderer keeps its
 * current string-error shape while structured data becomes available
 * alongside it for future surfacing.
 * `toString()` returns the message so defensive `String(err)` in
 * consumers degrades cleanly to the message.
 * The taxonomy is documented in Desktop_Alignment/notes.md — every
 * category string is listed there, marked shared-with-mobile vs
 * desktop-only. Keep the doc in sync when adding categories.
 * EXPORTS:
 * EngineError (class) — the base
 * PathTraversalError (class extends EngineError) — receive.path-traversal
 * FileStallError (class extends EngineError) — receive.stall
 * wrapError(err, opts) — idempotent-on-EngineError wrapper
 * failure(category, cause, message, detail) — returns desktop wire shape
 * EXTERNAL CALLS: none — pure JS
 * KEY STATE: none (stateless)
 */

class EngineError extends Error {
    constructor({ category, cause, message, detail } = {}) {
        super(message ?? cause ?? String(category ?? 'unknown'));
        this.name = 'EngineError';
        this.category = String(category ?? 'internal.unexpected');
        this.cause = String(cause ?? 'unknown');
        if (detail !== undefined) this.detail = detail;
    }

    toJSON() {
        const out = {
            category: this.category,
            cause: this.cause,
            message: this.message,
        };
        if (this.detail !== undefined) out.detail = this.detail;
        return out;
    }

    toString() {
        return this.message || `${this.category}:${this.cause}`;
    }
}

/**
 * Path-traversal defense error. Thrown when a peer-provided key would
 * escape the download root — e.g. `../evil` or an absolute path — and
 * the receive-side guard rejects the write. Field-for-field mirror of
 * mobile's PathTraversalError at path-safe.mjs:25-35.
 * The `name` is preserved as "PathTraversalError" so stack traces read
 * cleanly and any test tripwire keying on the class name still works.
 */
class PathTraversalError extends EngineError {
    constructor(message, detail) {
        super({
            category: 'receive.path-traversal',
            cause: 'peer-path-traversal',
            message,
            detail,
        });
        this.name = 'PathTraversalError';
    }
}

/**
 * Per-file stall-watchdog error. Thrown when the receive stream sees no
 * data for STALL_TIMEOUT_MS (60 s) and gives up on the file so the loop
 * can move on. Mirror of mobile's FileStallError at
 * hyperdrive-engine.mjs:1279-1288.
 */
class FileStallError extends EngineError {
    constructor(message, detail) {
        super({
            category: 'receive.stall',
            cause: 'file-stall',
            message,
            detail,
        });
        this.name = 'FileStallError';
    }
}

/**
 * Wrap an arbitrary caught value (usually from fs, hyperdrive, or
 * hyperswarm) into an EngineError. Idempotent on an existing
 * EngineError. Preserves the underlying error's code / name in
 * `detail.code` / `detail.originalName` when useful.
 * @param {unknown} err - Value caught in a try/catch
 * @param {{category?, cause?, message?, detail?}} opts - Category and cause fallbacks
 * @returns {EngineError}
 */
function wrapError(err, { category, cause, message, detail } = {}) {
    if (err instanceof EngineError) return err;
    return new EngineError({
        category: category || 'internal.unexpected',
        cause: cause || (err && err.code) || 'unknown',
        message: message || String((err && err.message) || err),
        detail: {
            ...(detail || {}),
            ...(err && err.code ? { code: err.code } : {}),
            ...(err && err.name && err.name !== 'Error' ? { originalName: err.name } : {}),
        },
    });
}

/**
 * Small helper producing the desktop wire shape for a typed failure:
 *   { success: false, error: <human string>, errorDetail: <structured obj> }
 * Desktop-adapted from mobile's `failure(category, cause, message, detail)`
 * which returns `{ ok: false, error: EngineError }`. The wire-shape
 * decision ( resolution 1) keeps `success` as the
 * top-level key and `error` as a human string, adding `errorDetail`
 * alongside for structured consumption. Renderers keep working;
 * new code can branch on `errorDetail.category`.
 * @param {string} category
 * @param {string} cause
 * @param {string} [message]
 * @param {object} [detail]
 * @returns {{success: false, error: string, errorDetail: object}}
 */
function failure(category, cause, message, detail) {
    const err = new EngineError({ category, cause, message, detail });
    return {
        success: false,
        error: err.toString(),
        errorDetail: err.toJSON(),
    };
}

module.exports = {
    EngineError,
    PathTraversalError,
    FileStallError,
    wrapError,
    failure,
};
