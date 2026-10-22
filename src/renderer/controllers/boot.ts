/**
 * App bootstrap: load settings, library metadata and the drive snapshot,
 * then subscribe to every push channel. Called once from main.tsx.
 */
import { sanitizeLibrary } from '@shared/library'
import { api } from '../services/client'
import { useMetaStore } from '../stores/meta-store'
import { useSettingsStore } from '../stores/settings-store'
import { useDrivesStore } from '../stores/drives-store'
import { useReceiveStore } from '../stores/receive-store'
import { useWindowStore } from '../stores/window-store'
import { handleTransferEvent } from './events'
import { applySnapshot } from './library'
import { syncReceiveTasks } from './receive'
import { useNetworkStore } from '../stores/network-store'
import { runAppCommand } from './app-commands'

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

function setQueueOwnership(tasks: Parameters<typeof syncReceiveTasks>[0]) {
  useReceiveStore.getState().setTasks(tasks)
}

export async function bootApp(): Promise<void> {
  const client = api()
  const settings = useSettingsStore.getState()

  // Subscribe first so nothing emitted during loading is lost.
  client.transfers.onEvent(handleTransferEvent)
  client.settings.onChange((p) => useSettingsStore.getState().setPreferences(p))
  client.engine.onStatus((s) => useSettingsStore.getState().setEngine(s))
  client.receive.onChange(syncReceiveTasks)
  client.network.onStats((s) => useNetworkStore.getState().setStats(s))
  client.app.onCommand(runAppCommand)
  client.window.onState((s) => useWindowStore.getState().setState(s))
  void client.window.state().then((s) => useWindowStore.getState().setState(s)).catch(() => undefined)

  const [prefs, info, library, engine] = await Promise.all([
    client.settings.get(),
    client.app.info(),
    client.library.get(),
    client.engine.status()
  ])
  settings.setPreferences(prefs)
  settings.setAppInfo(info)
  // Drag regions apply only to the frameless macOS window (see styles/index.css).
  document.documentElement.dataset.windowFrame = info.windowFrame
  settings.setEngine(engine)
  useMetaStore.getState().load(library)
  void importLegacyLocalStorage()
  document.title = info.profile ? `${info.identity.productName} — ${info.profile}` : info.identity.productName

  // The queue first, so drives it owns are not drawn as "Disconnected".
  const [tasks, stats] = await Promise.all([client.receive.list().catch(() => []), client.network.stats().catch(() => null)])
  setQueueOwnership(tasks)
  if (stats) useNetworkStore.getState().setStats(stats)

  try {
    applySnapshot(await client.transfers.snapshot())
  } catch {
    // Engine still starting (or failed): 'library-loaded' arrives when it is up.
    useDrivesStore.setState({ loaded: engine.phase === 'error' })
  }
  syncReceiveTasks(tasks)
}
