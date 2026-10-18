/**
 * App bootstrap: load settings, library metadata and the drive snapshot,
 * then subscribe to every push channel. Called once from main.tsx.
 */
import { sanitizeLibrary } from '@shared/library'
import { api } from '../services/client'
import { useMetaStore } from '../stores/meta-store'
import { useSettingsStore } from '../stores/settings-store'
import { useDrivesStore } from '../stores/drives-store'
import { handleTransferEvent } from './events'
import { applySnapshot } from './library'

/**
 * Favorites/aliases used to live in the old renderer's localStorage.
 * Import them once into library.json (same file:// origin in production).
 */
async function importLegacyLocalStorage() {
  try {
    if (localStorage.getItem('peardrop.library.imported') === '1') return
    const favs = JSON.parse(localStorage.getItem('peardrop.favorites.v1') || '[]')
    const aliases = JSON.parse(localStorage.getItem('peardrop.aliases.v1') || '{}')
    const legacy = sanitizeLibrary({ favorites: favs, aliases })
    if (legacy.favorites.length || Object.keys(legacy.aliases).length) {
      useMetaStore.getState().load(await api().library.import(legacy))
    }
    localStorage.setItem('peardrop.library.imported', '1')
  } catch {
    /* nothing to import */
  }
}

export async function bootApp(): Promise<void> {
  const client = api()
  const settings = useSettingsStore.getState()

  // Subscribe first so nothing emitted during loading is lost.
  client.transfers.onEvent(handleTransferEvent)
  client.settings.onChange((p) => useSettingsStore.getState().setPreferences(p))
  client.engine.onStatus((s) => useSettingsStore.getState().setEngine(s))

  const [prefs, info, library, engine] = await Promise.all([
    client.settings.get(),
    client.app.info(),
    client.library.get(),
    client.engine.status()
  ])
  settings.setPreferences(prefs)
  settings.setAppInfo(info)
  settings.setEngine(engine)
  useMetaStore.getState().load(library)
  void importLegacyLocalStorage()
  document.title = info.profile ? `${info.identity.productName} — ${info.profile}` : info.identity.productName

  try {
    applySnapshot(await client.transfers.snapshot())
  } catch {
    // Engine still starting (or failed): 'library-loaded' arrives when it is up.
    useDrivesStore.setState({ loaded: engine.phase === 'error' })
  }
}
