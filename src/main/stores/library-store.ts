/**
 * library.json — favorites and aliases (local display names) per drive id.
 */
import { ALIAS_MAX_LEN, sanitizeLibrary, type LibraryData } from '@shared/library'
import type { Logger } from '../logger'
import { JsonStore } from './json-store'

export class LibraryStore extends JsonStore<LibraryData> {
  constructor(file: string, log?: Logger) {
    super(file, sanitizeLibrary, log)
  }

  setFavorite(id: string, favorite: boolean): Promise<LibraryData> {
    return this.update((lib) => {
      const set = new Set(lib.favorites)
      if (favorite) set.add(id)
      else set.delete(id)
      return { ...lib, favorites: [...set] }
    })
  }

  /** Empty/null alias clears it (that is also the "reset name" path). */
  setAlias(id: string, alias: string | null): Promise<LibraryData> {
    return this.update((lib) => {
      const aliases = { ...lib.aliases }
      const clean = (alias ?? '').trim().slice(0, ALIAS_MAX_LEN)
      if (clean) aliases[id] = clean
      else delete aliases[id]
      return { ...lib, aliases }
    })
  }

  /** Drop everything stored about a drive that no longer exists. */
  forget(id: string): Promise<LibraryData> {
    return this.update((lib) => {
      const aliases = { ...lib.aliases }
      delete aliases[id]
      return { ...lib, aliases, favorites: lib.favorites.filter((f) => f !== id) }
    })
  }

  /** One-time import (e.g. from the old renderer's localStorage); existing entries win. */
  importFrom(data: LibraryData): Promise<LibraryData> {
    return this.update((lib) => ({
      version: 1,
      favorites: [...new Set([...lib.favorites, ...data.favorites])],
      aliases: { ...data.aliases, ...lib.aliases }
    }))
  }
}
