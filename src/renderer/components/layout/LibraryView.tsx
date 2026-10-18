/**
 * LibraryView — the content panel body: list in grid or table form, or the
 * right empty state (nothing shared, nothing pinned, no search hits,
 * engine down).
 *
 * @example <LibraryView />
 */
import { reloadEngine } from '../../controllers/engine'
import { openSend } from '../../controllers/share'
import { useVisibleDrives } from '../../hooks/useDrives'
import { useDrivesStore } from '../../stores/drives-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore } from '../../stores/ui-store'
import { DriveGrid } from '../drives/DriveGrid'
import { DriveTable } from '../drives/DriveTable'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Icon } from '../ui/Icon'
import { Spinner } from '../ui/Spinner'

export function LibraryView() {
  const { items, total } = useVisibleDrives()
  const loaded = useDrivesStore((s) => s.loaded)
  const highlightId = useDrivesStore((s) => s.highlightId)
  const view = useSettingsStore((s) => s.preferences.list.view)
  const engine = useSettingsStore((s) => s.engine)
  const tab = useUiStore((s) => s.tab)
  const search = useUiStore((s) => s.search)
  const { setSearch, setKindFilter, setStatusFilter, openModal, setPage } = useUiStore.getState()

  if (engine?.phase === 'error') {
    return (
      <EmptyState
        icon="wifi-off"
        tone="warning"
        title="The transfer engine is not running"
        body={engine.error ?? 'It failed to start. Your shares are safe and will come back once it does.'}
        action={
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setPage('settings')}>
              Network settings
            </Button>
            <Button variant="primary" leading={<Icon name="refresh" />} onClick={() => void reloadEngine()}>
              Retry
            </Button>
          </div>
        }
      />
    )
  }

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-muted">
        <Spinner className="h-5 w-5 text-accent" /> {engine?.phase === 'reloading' ? 'Restarting engine…' : 'Loading your shares…'}
      </div>
    )
  }

  if (total === 0) {
    return tab === 'favorites' ? (
      <EmptyState icon="star" tone="muted" title="Nothing pinned yet" body="Add shares to Favorites from their ⋮ menu to keep them here." />
    ) : (
      <EmptyState
        icon="folder-outline"
        tone="accent"
        title="Nothing shared yet"
        body="Drop files anywhere in this window, or use Send. Paste a link with Receive to download."
        action={
          <div className="flex gap-3">
            <Button variant="primary" leading={<Icon name="arrow-up" />} onClick={openSend}>
              Send files
            </Button>
            <Button variant="soft" leading={<Icon name="arrow-down" />} onClick={() => openModal({ type: 'receive' })}>
              Receive
            </Button>
          </div>
        }
      />
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon="search"
        title="No matches"
        body={search ? <>Nothing here matches “{search.trim()}”.</> : 'No items match the current filter.'}
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setSearch('')
              setKindFilter('all')
              setStatusFilter('any')
            }}
          >
            Clear search & filters
          </Button>
        }
      />
    )
  }

  return view === 'table' ? <DriveTable items={items} highlightId={highlightId} /> : <DriveGrid items={items} search={search} highlightId={highlightId} />
}
