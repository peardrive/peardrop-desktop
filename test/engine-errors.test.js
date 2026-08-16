/**
 * Tests for lib/engine-errors.js — mirrors mobile's
 * src/lib/__tests__/engineErrors.test.ts against the desktop shape.
 * The wire-shape decision for desktop ( resolution 1) is
 * different from mobile — desktop's `failure()` returns
 * `{success:false, error:<string>, errorDetail:<obj>}` not mobile's
 * `{ok:false, error:EngineError}`. The base-class semantics (toJSON,
 * toString, wrapError idempotency, category strings) are shared and
 * tested identically.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    EngineError,
    PathTraversalError,
    FileStallError,
    wrapError,
    failure,
} = require('../lib/engine-errors');

// EngineError base class --- //

test('EngineError: constructs with category / cause / message / detail', () => {
    const err = new EngineError({
        category: 'receive.stall',
        cause: 'file-stall',
        message: 'stalled: no data for 60s',
        detail: { destPath: '/x/y' },
    });
    assert.equal(err.category, 'receive.stall');
    assert.equal(err.cause, 'file-stall');
    assert.equal(err.message, 'stalled: no data for 60s');
    assert.deepEqual(err.detail, { destPath: '/x/y' });
});

test('EngineError: is throwable and catchable as Error', () => {
    let caught;
    try {
        throw new EngineError({
            category: 'receive.no-session',
            cause: 'session-not-found',
        });
    } catch (e) {
        caught = e;
    }
    assert.ok(caught instanceof Error);
    assert.ok(caught instanceof EngineError);
    assert.equal(caught.category, 'receive.no-session');
});

test('EngineError.toJSON: produces wire shape without name/stack leak', () => {
    const err = new EngineError({
        category: 'receive.path-traversal',
        cause: 'peer-path-traversal',
        message: 'unsafe path outside download folder: ../evil',
    });
    const j = err.toJSON();
    assert.deepEqual(j, {
        category: 'receive.path-traversal',
        cause: 'peer-path-traversal',
        message: 'unsafe path outside download folder: ../evil',
    });
    // Stack and name must not leak into the serialized shape.
    assert.ok(!('stack' in j));
    assert.ok(!('name' in j));
});

test('EngineError.toJSON: omits detail when undefined', () => {
    const err = new EngineError({ category: 'x', cause: 'y', message: 'z' });
    assert.deepEqual(err.toJSON(), { category: 'x', cause: 'y', message: 'z' });
});

test('EngineError.toJSON: includes detail when present', () => {
    const err = new EngineError({
        category: 'x',
        cause: 'y',
        message: 'z',
        detail: { code: 'ENOENT', path: '/tmp' },
    });
    assert.deepEqual(err.toJSON(), {
        category: 'x',
        cause: 'y',
        message: 'z',
        detail: { code: 'ENOENT', path: '/tmp' },
    });
});

test('EngineError: JSON.stringify calls toJSON automatically (IPC wire shape)', () => {
    const err = new EngineError({
        category: 'receive.invalid-link',
        cause: 'invalid-link',
        message: 'expect peardrop:// + 64 hex chars',
    });
    // Simulate the RPC transport: JSON.stringify → JSON.parse.
    const wire = JSON.parse(JSON.stringify({ errorDetail: err }));
    assert.deepEqual(wire, {
        errorDetail: {
            category: 'receive.invalid-link',
            cause: 'invalid-link',
            message: 'expect peardrop:// + 64 hex chars',
        },
    });
});

test('EngineError.toString: returns the message', () => {
    const err = new EngineError({
        category: 'receive.stall',
        cause: 'file-stall',
        message: 'stalled: no data for 60s',
    });
    assert.equal(String(err), 'stalled: no data for 60s');
});

test('EngineError.toString: falls back to category:cause when message is empty', () => {
    // `??` treats "" as a valid string, so an explicit empty message
    // stays empty; toString falls back to "category:cause".
    const explicit = new EngineError({ category: 'x', cause: 'y', message: '' });
    assert.equal(explicit.message, '');
    assert.equal(String(explicit), 'x:y');

    // Undefined message uses `??` chain → cause becomes the message.
    const noMessage = new EngineError({ category: 'x', cause: 'y' });
    assert.equal(noMessage.message, 'y');
    assert.equal(String(noMessage), 'y');
});

// wrapError --- //

test('wrapError: idempotent on an existing EngineError', () => {
    const inner = new EngineError({ category: 'a.b', cause: 'c' });
    const outer = wrapError(inner, {
        category: 'should-not-override',
        cause: 'should-not-override',
    });
    assert.strictEqual(outer, inner);
    assert.equal(outer.category, 'a.b');
});

test('wrapError: promotes a raw fs error, preserving code in detail', () => {
    const raw = Object.assign(new Error('EACCES: permission denied'), {
        code: 'EACCES',
    });
    const wrapped = wrapError(raw, {
        category: 'manifest.write-fail',
        cause: 'manifest-write-fail',
    });
    assert.ok(wrapped instanceof EngineError);
    assert.equal(wrapped.category, 'manifest.write-fail');
    assert.equal(wrapped.cause, 'manifest-write-fail');
    assert.equal(wrapped.message, 'EACCES: permission denied');
    assert.deepEqual(wrapped.detail, { code: 'EACCES' });
});

test('wrapError: uses default category when none provided', () => {
    const raw = new Error('boom');
    const wrapped = wrapError(raw);
    assert.equal(wrapped.category, 'internal.unexpected');
});

test('wrapError: preserves originalName when the underlying class is non-Error', () => {
    class TypeishError extends Error {
        constructor(m) {
            super(m);
            this.name = 'TypeishError';
        }
    }
    const wrapped = wrapError(new TypeishError('bad'), {
        category: 'internal.unexpected',
        cause: 'unknown',
    });
    assert.equal(wrapped.detail.originalName, 'TypeishError');
});

// failure() — desktop wire shape --- //

test('failure() returns the desktop wire shape (success:false + error string + errorDetail obj)', () => {
    const res = failure(
        'receive.no-session',
        'session-not-found',
        'Session not found — open the link first.',
    );
    // Desktop's shape is NOT mobile's {ok, error:EngineError}. It's the
    // legacy renderer-compatible {success, error:string} plus a new
    // structured sibling errorDetail. This is the wire-shape resolution
    // from .
    assert.equal(res.success, false);
    assert.equal(typeof res.error, 'string');
    assert.equal(res.error, 'Session not found — open the link first.');
    assert.deepEqual(res.errorDetail, {
        category: 'receive.no-session',
        cause: 'session-not-found',
        message: 'Session not found — open the link first.',
    });
});

test('failure(): errorDetail contains detail when provided', () => {
    const res = failure(
        'receive.file-not-found',
        'file-not-found',
        'File not found: foo.txt',
        { fileName: 'foo.txt' },
    );
    assert.deepEqual(res.errorDetail, {
        category: 'receive.file-not-found',
        cause: 'file-not-found',
        message: 'File not found: foo.txt',
        detail: { fileName: 'foo.txt' },
    });
});

// Typed subclasses: category lock-ins --- //

test('PathTraversalError: category is exactly "receive.path-traversal"', () => {
    const err = new PathTraversalError('bad', { key: '../evil' });
    // Lock-in: if anyone renames the category string, this test fails.
    // The string is wire contract — mobile emits the same one, so a
    // rename here would break cross-platform consumers.
    assert.equal(err.category, 'receive.path-traversal');
    assert.equal(err.cause, 'peer-path-traversal');
    assert.equal(err.name, 'PathTraversalError');
    assert.ok(err instanceof EngineError);
    assert.ok(err instanceof Error);
});

test('PathTraversalError: carries detail through toJSON', () => {
    const err = new PathTraversalError('bad', { key: '../evil', root: '/dl' });
    assert.deepEqual(err.toJSON(), {
        category: 'receive.path-traversal',
        cause: 'peer-path-traversal',
        message: 'bad',
        detail: { key: '../evil', root: '/dl' },
    });
});

test('FileStallError: category is exactly "receive.stall"', () => {
    const err = new FileStallError('stalled', { file: '/x', timeoutMs: 60000 });
    // Lock-in on the category string.
    assert.equal(err.category, 'receive.stall');
    assert.equal(err.cause, 'file-stall');
    assert.equal(err.name, 'FileStallError');
    assert.ok(err instanceof EngineError);
});

test('FileStallError: JSON round-trip preserves category/cause/detail', () => {
    const err = new FileStallError('stalled: no data for 60s', {
        file: '/x/y',
        timeoutMs: 60000,
    });
    const wire = JSON.parse(JSON.stringify(err));
    assert.equal(wire.category, 'receive.stall');
    assert.equal(wire.cause, 'file-stall');
    assert.equal(wire.message, 'stalled: no data for 60s');
    assert.deepEqual(wire.detail, { file: '/x/y', timeoutMs: 60000 });
});

test('Typed subclasses: instanceof chain (subclass → EngineError → Error) works both ways', () => {
    const p = new PathTraversalError('x');
    const s = new FileStallError('y');
    // Direct type check.
    assert.ok(p instanceof PathTraversalError);
    assert.ok(s instanceof FileStallError);
    // Base type check — the IPC handlers' `error instanceof EngineError`
    // path uses this to decide whether to attach errorDetail.
    assert.ok(p instanceof EngineError);
    assert.ok(s instanceof EngineError);
    // Cross-check (a PathTraversalError is NOT a FileStallError).
    assert.ok(!(p instanceof FileStallError));
    assert.ok(!(s instanceof PathTraversalError));
});
