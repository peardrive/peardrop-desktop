/**
 * The logging interface the engine writes to.
 *
 * The engine only depends on this shape; the main process provides the
 * implementation (LogManager in src/main/logger.ts).
 */
export interface Logger {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
  /** Derive a logger with a nested scope, e.g. "engine" → "engine:hyperdrive". */
  child(scope: string): Logger
}
