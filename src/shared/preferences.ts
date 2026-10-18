/**
 * User preferences, persisted as ~/.peardrop/preferences.json.
 *
 * The main process owns the file; the renderer reads and patches it over IPC.
 * `sanitizePreferences` is the only way data from disk (or the renderer)
 * becomes a Preferences object, so a hand-edited or older file can never
 * put the app into an invalid state.
 */

export const THEME_IDS = ['dark', 'light'] as const
export type ThemeId = (typeof THEME_IDS)[number]
/** 'system' follows the OS appearance. */
export type ThemePreference = ThemeId | 'system'

export type ListViewMode = 'grid' | 'table'
export type SortField = 'recent' | 'status' | 'size' | 'name' | 'peers' | 'filetype'
export type SortDirection = 'asc' | 'desc'

export interface Preferences {
  version: 1
  appearance: {
    theme: ThemePreference
  }
  network: {
    /** Custom DHT bootstrap address(es), "host:port[, host:port]". Empty = public DHT. */
    bootstrap: string
  }
  list: {
    view: ListViewMode
    sortField: SortField
    sortDirection: SortDirection
  }
  diagnostics: {
    /** Mirror verbose logs to the console (the log file always records). */
    debug: boolean
  }
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  appearance: { theme: 'dark' },
  network: { bootstrap: '' },
  list: { view: 'grid', sortField: 'recent', sortDirection: 'desc' },
  diagnostics: { debug: false }
}

/** Deep-partial patch accepted by `settings.update`. */
export type PreferencesPatch = {
  [K in keyof Preferences]?: Preferences[K] extends object ? Partial<Preferences[K]> : Preferences[K]
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** Coerce anything (old file, partial patch result) into valid Preferences. */
export function sanitizePreferences(input: unknown): Preferences {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const d = DEFAULT_PREFERENCES
  return {
    version: 1,
    appearance: {
      theme: pick(src.appearance?.theme, [...THEME_IDS, 'system'] as const, d.appearance.theme)
    },
    network: {
      bootstrap: typeof src.network?.bootstrap === 'string' ? src.network.bootstrap.trim() : d.network.bootstrap
    },
    list: {
      view: pick(src.list?.view, ['grid', 'table'] as const, d.list.view),
      sortField: pick(src.list?.sortField, ['recent', 'status', 'size', 'name', 'peers', 'filetype'] as const, d.list.sortField),
      sortDirection: pick(src.list?.sortDirection, ['asc', 'desc'] as const, d.list.sortDirection)
    },
    diagnostics: {
      debug: typeof src.diagnostics?.debug === 'boolean' ? src.diagnostics.debug : d.diagnostics.debug
    }
  }
}

/** Apply a patch section-by-section, then sanitize. */
export function mergePreferences(current: Preferences, patch: PreferencesPatch): Preferences {
  const next: Record<string, unknown> = { ...current }
  for (const [section, value] of Object.entries(patch)) {
    const base = (current as unknown as Record<string, unknown>)[section]
    next[section] = value && typeof value === 'object' && base && typeof base === 'object'
      ? { ...(base as object), ...(value as object) }
      : value
  }
  return sanitizePreferences(next)
}
