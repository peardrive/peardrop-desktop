/**
 * Local-only library metadata, persisted as ~/.peardrop/library.json.
 *
 * Favorites and aliases (user-chosen display names) are presentation data:
 * they never reach peers and never touch the engine's drives-state.json, so
 * a rename is always reversible. Keeping them in the data folder (instead of
 * browser localStorage) means they survive a reinstall alongside the drives
 * they describe.
 */

export const ALIAS_MAX_LEN = 120

export interface LibraryData {
  version: 1
  favorites: string[]
  aliases: Record<string, string>
}

export const EMPTY_LIBRARY: LibraryData = { version: 1, favorites: [], aliases: {} }

export function sanitizeLibrary(input: unknown): LibraryData {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const favorites = Array.isArray(src.favorites)
    ? [...new Set(src.favorites.filter((x: unknown): x is string => typeof x === 'string' && !!x))]
    : []
  const aliases: Record<string, string> = {}
  if (src.aliases && typeof src.aliases === 'object' && !Array.isArray(src.aliases)) {
    for (const [id, name] of Object.entries(src.aliases)) {
      if (typeof name === 'string' && name.trim()) aliases[id] = name.trim().slice(0, ALIAS_MAX_LEN)
    }
  }
  return { version: 1, favorites, aliases }
}
