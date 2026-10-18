/**
 * Favorites and aliases (local display names), persisted in library.json by
 * main. Kept apart from the drives store because they are user metadata,
 * not engine state — a drive's title is always derived as
 * `aliases[id] || baseTitle(name)` at render time, so there is nothing to
 * keep in sync when either changes.
 */
import { create } from 'zustand'
import type { LibraryData } from '@shared/library'
import { api } from '../services/client'

interface MetaState {
  favorites: ReadonlySet<string>
  aliases: Readonly<Record<string, string>>
  load(data: LibraryData): void
  setFavorite(id: string, favorite: boolean): Promise<void>
  setAlias(id: string, alias: string | null): Promise<void>
  forget(id: string): Promise<void>
}

const fromData = (d: LibraryData) => ({ favorites: new Set(d.favorites), aliases: d.aliases })

export const useMetaStore = create<MetaState>((set, get) => ({
  favorites: new Set(),
  aliases: {},
  load: (data) => set(fromData(data)),
  async setFavorite(id, favorite) {
    const favorites = new Set(get().favorites)
    if (favorite) favorites.add(id)
    else favorites.delete(id)
    set({ favorites })
    set(fromData(await api().library.setFavorite(id, favorite)))
  },
  async setAlias(id, alias) {
    const aliases = { ...get().aliases }
    if (alias && alias.trim()) aliases[id] = alias.trim()
    else delete aliases[id]
    set({ aliases })
    set(fromData(await api().library.setAlias(id, alias)))
  },
  async forget(id) {
    if (!get().favorites.has(id) && !get().aliases[id]) return
    set(fromData(await api().library.forget(id)))
  }
}))
