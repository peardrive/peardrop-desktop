/**
 * Structured errors for the engine.
 *
 * Every engine failure, thrown or returned as `{ success: false, error }`,
 * carries:
 *   - category: dot-namespaced bucket, stable across releases
 *               (e.g. "receive.stall"). Callers may branch on the prefix.
 *   - cause:    short machine-readable id within the category
 *               (e.g. "file-stall").
 *   - message:  human-readable, for logs and the UI. Never for control flow.
 *   - detail:   optional JSON-serializable payload (offending path, error
 *               code, size, …).
 *
 * `toJSON()` produces a plain object with those four fields, so an error
 * crosses IPC as `errorDetail` next to the plain string `error`.
 * `toString()` returns the message, so `String(err)` degrades cleanly.
 *
 * The taxonomy is documented in Desktop_Alignment/notes.md: keep it in sync
 * when adding categories.
 */

export interface EngineErrorJSON {
  category: string
  cause: string
  message: string
  detail?: unknown
}

export interface EngineErrorOptions {
  category?: string
  cause?: string
  message?: string
  detail?: unknown
}

/** The desktop wire shape for a typed failure. */
export interface FailureResult {
  success: false
  error: string
  errorDetail: EngineErrorJSON
}

export class EngineError extends Error {
  readonly category: string
  override readonly cause: string
  /** Only present when given, so `'detail' in err` stays meaningful. */
  declare readonly detail?: unknown

  constructor({ category, cause, message, detail }: EngineErrorOptions = {}) {
    super(message ?? cause ?? String(category ?? 'unknown'))
    this.name = 'EngineError'
    this.category = String(category ?? 'internal.unexpected')
    this.cause = String(cause ?? 'unknown')

    if (detail !== undefined) {
      this.detail = detail
    }
  }

  toJSON(): EngineErrorJSON {
    const json: EngineErrorJSON = {
      category: this.category,
      cause: this.cause,
      message: this.message
    }

    if (this.detail !== undefined) {
      json.detail = this.detail
    }

    return json
  }

  override toString(): string {
    return this.message || `${this.category}:${this.cause}`
  }
}

/**
 * A peer-provided path would escape the download folder (`../evil`, an
 * absolute path, …) and the receive-side guard refused to write it.
 * Mirrors mobile's PathTraversalError.
 */
export class PathTraversalError extends EngineError {
  constructor(message: string, detail?: unknown) {
    super({
      category: 'receive.path-traversal',
      cause: 'peer-path-traversal',
      message,
      detail
    })
    this.name = 'PathTraversalError'
  }
}

/**
 * No data arrived for a file (or the file list) for the stall timeout, so
 * the transfer gave up on it. Mirrors mobile's FileStallError.
 */
export class FileStallError extends EngineError {
  constructor(message: string, detail?: unknown) {
    super({
      category: 'receive.stall',
      cause: 'file-stall',
      message,
      detail
    })
    this.name = 'FileStallError'
  }
}

/**
 * Turn any caught value (usually from fs, hyperdrive or hyperswarm) into an
 * EngineError. An existing EngineError is returned unchanged. The original
 * error's `code` and class name are kept in `detail` when useful.
 */
export function wrapError(err: unknown, opts: EngineErrorOptions = {}): EngineError {
  if (err instanceof EngineError) {
    return err
  }

  const raw = (err ?? {}) as { code?: string; message?: string; name?: string }
  const extraDetail = (opts.detail ?? {}) as Record<string, unknown>

  return new EngineError({
    category: opts.category || 'internal.unexpected',
    cause: opts.cause || raw.code || 'unknown',
    message: opts.message || String(raw.message || err),
    detail: {
      ...extraDetail,
      ...(raw.code ? { code: raw.code } : {}),
      ...(raw.name && raw.name !== 'Error' ? { originalName: raw.name } : {})
    }
  })
}

/**
 * Build the desktop wire shape for a typed failure:
 * `{ success: false, error: <message>, errorDetail: <structured> }`.
 */
export function failure(category: string, cause: string, message?: string, detail?: unknown): FailureResult {
  const err = new EngineError({ category, cause, message, detail })

  return {
    success: false,
    error: err.toString(),
    errorDetail: err.toJSON()
  }
}
