/**
 * User preferences, persisted as ~/.peardrop/preferences.json.
 *
 * The main process owns the file; the renderer reads and patches it over IPC.
 * `sanitizePreferences` is the only way data from disk (or the renderer)
 * becomes a Preferences object, so a hand-edited or older file can never
 * put the app into an invalid state.
 */

/** Every theme, in picker order (palettes live in renderer/theme/themes.ts). */
export const THEME_IDS = ['void', 'pear', 'ocean', 'paper', 'ember', 'forest', 'lavender', 'rose', 'slate', 'cream', 'synth'] as const
export type ThemeId = (typeof THEME_IDS)[number]
/** 'system' follows the OS appearance (Pear dark ⇄ Paper). */
export type ThemePreference = ThemeId | 'system'

/** Themes with a light background (native title bar, scrollbars and `system` use this). */
export const LIGHT_THEME_IDS: readonly ThemeId[] = ['pear', 'paper', 'cream']
/** What `system` resolves to. */
export const SYSTEM_THEMES = { dark: 'void', light: 'paper' } as const satisfies Record<'dark' | 'light', ThemeId>

/** Ids used before the theme set grew (older preferences.json files). */
const LEGACY_THEME_IDS: Record<string, ThemeId> = { dark: 'void', light: 'paper' }

/** Light or dark appearance of a theme preference ('system' stays 'system'). */
export function themeScheme(pref: ThemePreference): 'dark' | 'light' | 'system' {
  if (pref === 'system') return 'system'
  return LIGHT_THEME_IDS.includes(pref) ? 'light' : 'dark'
}

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
  layout: {
    /** The user folded the sidebar to icons (it also folds by itself on narrow windows). */
    sidebarCollapsed: boolean
    /** The network panel at the bottom of the sidebar shows peers and speeds. */
    networkDetails: boolean
  }
  background: {
    /** Closing the window keeps PearDrop running in the tray / menu bar. */
    closeToTray: boolean
    /** Start PearDrop (hidden in the tray) when the user signs in. */
    openAtLogin: boolean
    /** The one-time "still running in the tray" notice was shown. */
    trayNoticeShown: boolean
  }
}

export const DEFAULT_PREFERENCES: Preferences = {
  version: 1,
  appearance: { theme: 'void' },
  network: { bootstrap: '' },
  list: { view: 'grid', sortField: 'recent', sortDirection: 'desc' },
  diagnostics: { debug: false },
  layout: { sidebarCollapsed: false, networkDetails: false },
  background: { closeToTray: true, openAtLogin: false, trayNoticeShown: false }
}

/** Deep-partial patch accepted by `settings.update`. */
export type PreferencesPatch = {
  [K in keyof Preferences]?: Preferences[K] extends object ? Partial<Preferences[K]> : Preferences[K]
}

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback

/** Coerce anything (old file, partial patch result) into valid Preferences. */
export function sanitizePreferences(input: unknown): Preferences {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const d = DEFAULT_PREFERENCES
  return {
    version: 1,
    appearance: {
      theme: pick(LEGACY_THEME_IDS[src.appearance?.theme] ?? src.appearance?.theme, [...THEME_IDS, 'system'] as const, d.appearance.theme)
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
      debug: bool(src.diagnostics?.debug, d.diagnostics.debug)
    },
    layout: {
      sidebarCollapsed: bool(src.layout?.sidebarCollapsed, d.layout.sidebarCollapsed),
      networkDetails: bool(src.layout?.networkDetails, d.layout.networkDetails)
    },
    background: {
      closeToTray: bool(src.background?.closeToTray, d.background.closeToTray),
      openAtLogin: bool(src.background?.openAtLogin, d.background.openAtLogin),
      trayNoticeShown: bool(src.background?.trayNoticeShown, d.background.trayNoticeShown)
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
