/** Typed view of engine/engine-errors.js. */
export interface EngineErrorJSON {
  category: string
  cause: string
  message: string
  detail?: unknown
}
export class EngineError extends Error {
  constructor(opts?: { category?: string; cause?: string; message?: string; detail?: unknown })
  category: string
  cause: string
  detail?: unknown
  toJSON(): EngineErrorJSON
}
export class PathTraversalError extends EngineError {}
export class FileStallError extends EngineError {}
export function wrapError(err: unknown, opts?: Record<string, unknown>): EngineError
