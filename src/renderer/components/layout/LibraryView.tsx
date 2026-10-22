/**
 * LibraryView — the content panel body: list in grid or table form, or the
 * right empty state (nothing shared, nothing pinned, no search hits,
 * engine down).
 *
 * @example <LibraryView />
 */
import { reloadEngine } from '../../controllers/engine'
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
  const { setSearch, setStatusFilter, setPage } = useUiStore.getState()

  if (engine?.phase === 'error') {
    return (
      <EmptyState
        icon="wifi-off"
        tone="warning"
        title="The transfer engine is not running"
        body={engine.error ?? 'It failed to start. Your shares are safe and will come back once it does.'}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPage('settings')}>
              Network settings
            </Button>
            <Button size="sm" variant="primary" leading={<Icon name="refresh" className="h-3.5 w-3.5" />} onClick={() => void reloadEngine()}>
              Retry
            </Button>
          </div>
        }
      />
    )
  }

  if (!loaded) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 py-10 text-[12px] text-muted">
        <Spinner className="h-4 w-4 text-accent" /> {engine?.phase === 'reloading' ? 'Restarting engine…' : 'Loading your shares…'}
      </div>
    )
  }

  if (total === 0) {
    switch (tab) {
      case 'favorites':
        return <EmptyState icon={{ vicon: 'star' }} title="Nothing pinned yet" body={'Add files to Favorites\nfrom their ⋮ menu'} />
      case 'received':
        return (
          <EmptyState
            icon={{ vicon: 'directbox-receive' }}
            title="Nothing received yet"
            body={'Paste a link with Receive\nto download it here'}
          />
        )
      default:
        return (
          <EmptyState
            icon={{ vicon: 'directbox-send-bold' }}
            title="Nothing shared yet"
            body={'Drop a file or photo here, or use Send\nto start sharing'}
          />
        )
    }
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={{ vicon: 'search-normal' }}
        title="No matches"
        body={search ? <>Nothing here matches “{search.trim()}”.</> : 'No items match the current filter.'}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('')
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
