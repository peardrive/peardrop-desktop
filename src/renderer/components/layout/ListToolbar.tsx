/**
 * ListToolbar — search field plus the Filter and List-options menus that
 * sit at the top of the content panel.
 *
 * @example <ListToolbar />
 */
import { confirmClearCompleted, resumeAll, stopAllSharing } from '../../controllers/drive-actions'
import type { SortField } from '../../lib/drive-model'
import { cn } from '../../lib/cn'
import { api } from '../../services/client'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore, type KindFilter, type StatusFilter } from '../../stores/ui-store'
import { IconButton } from '../ui/IconButton'
import { Menu, useMenu, type MenuEntry } from '../ui/Menu'
import { SearchField } from '../ui/SearchField'

const SORTS: Array<[SortField, string]> = [
  ['recent', 'Recent'],
  ['status', 'Status'],
  ['size', 'Size'],
  ['name', 'Name'],
  ['peers', 'Peers'],
  ['filetype', 'File type']
]

export function ListToolbar() {
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  const kind = useUiStore((s) => s.kindFilter)
  const status = useUiStore((s) => s.statusFilter)
  const setKind = useUiStore((s) => s.setKindFilter)
  const setStatus = useUiStore((s) => s.setStatusFilter)
  const list = useSettingsStore((s) => s.preferences.list)
  const update = useSettingsStore((s) => s.updatePreferences)
  const filterMenu = useMenu()
  const optionsMenu = useMenu()
  const filtered = kind !== 'all' || status !== 'any'

  const kindItem = (value: KindFilter, label: string): MenuEntry => ({ label, checked: kind === value, onSelect: () => setKind(value) })
  const statusItem = (value: StatusFilter, label: string): MenuEntry => ({ label, checked: status === value, onSelect: () => setStatus(value) })

  const filterItems: MenuEntry[] = [
    { heading: 'Show' },
    kindItem('all', 'Everything'),
    kindItem('share', 'My shares'),
    kindItem('download', 'Downloads'),
    { divider: true },
    { heading: 'Status' },
    statusItem('any', 'Any status'),
    statusItem('active', 'Active & completed'),
    statusItem('transferring', 'In progress'),
    statusItem('attention', 'Needs attention')
  ]

  const optionItems: MenuEntry[] = [
    { heading: 'Sort by' },
    ...SORTS.map<MenuEntry>(([field, label]) => ({
      label,
      checked: list.sortField === field,
      hint: list.sortField === field ? (list.sortDirection === 'desc' ? '↓' : '↑') : undefined,
      // Picking the active field again flips its direction.
      onSelect: () =>
        void update({
          list: list.sortField === field ? { sortDirection: list.sortDirection === 'desc' ? 'asc' : 'desc' } : { sortField: field, sortDirection: 'desc' }
        })
    })),
    { divider: true },
    { heading: 'View' },
    { label: 'Grid', icon: 'grid', checked: list.view === 'grid', onSelect: () => void update({ list: { view: 'grid' } }) },
    { label: 'Table', icon: 'table', checked: list.view === 'table', onSelect: () => void update({ list: { view: 'table' } }) },
    { divider: true },
    { label: 'Open downloads folder', icon: 'folder-outline', onSelect: () => void api().files.openDownloads() },
    { label: 'Resume all', icon: 'play', onSelect: () => void resumeAll() },
    { label: 'Stop all sharing', icon: 'stop', onSelect: () => void stopAllSharing() },
    { label: 'Clear list…', icon: 'trash', danger: true, onSelect: confirmClearCompleted }
  ]

  return (
    <div className="flex items-center gap-3 px-4 pb-2 pt-4">
      <SearchField value={search} onChange={setSearch} className="flex-1" />
      <IconButton
        ref={filterMenu.triggerRef}
        icon="filter"
        label="Filter"
        iconClassName="h-5 w-5"
        onClick={filterMenu.toggleFromTrigger}
        className={cn(filtered && 'bg-accent/15 text-accent-strong')}
      />
      <Menu {...filterMenu.props} items={filterItems} width={220} />
      <IconButton ref={optionsMenu.triggerRef} icon="more-triangle" label="List options" iconClassName="h-5 w-5" onClick={optionsMenu.toggleFromTrigger} />
      <Menu {...optionsMenu.props} items={optionItems} width={240} />
    </div>
  )
}
