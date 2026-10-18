/**
 * Settings store: preferences (persisted by main in preferences.json), app
 * info and the engine's live status. Components read slices with selectors;
 * writes go through the actions so main stays the source of truth.
 */
import { create } from 'zustand'
import type { AppInfo } from '@shared/app-info'
import type { EngineStatus } from '@shared/engine'
import { DEFAULT_PREFERENCES, type Preferences, type PreferencesPatch } from '@shared/preferences'
import { api } from '../services/client'

interface SettingsState {
  preferences: Preferences
  appInfo: AppInfo | null
  engine: EngineStatus | null
  /** Apply a patch optimistically, then persist via main. */
  updatePreferences(patch: PreferencesPatch): Promise<void>
  setPreferences(p: Preferences): void
  setEngine(s: EngineStatus): void
  setAppInfo(info: AppInfo): void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  preferences: DEFAULT_PREFERENCES,
  appInfo: null,
  engine: null,
  async updatePreferences(patch) {
    const prev = get().preferences
    const optimistic = { ...prev } as Record<string, unknown>
    for (const [k, v] of Object.entries(patch)) optimistic[k] = { ...(prev as unknown as Record<string, object>)[k], ...(v as object) }
    set({ preferences: optimistic as unknown as Preferences })
    try {
      set({ preferences: await api().settings.update(patch) })
    } catch {
      set({ preferences: prev })
    }
  },
  setPreferences: (preferences) => set({ preferences }),
  setEngine: (engine) => set({ engine }),
  setAppInfo: (appInfo) => set({ appInfo })
}))
