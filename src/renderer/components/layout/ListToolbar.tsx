/**
 * ListToolbar — the header above the list (Figma "List section"):
 *
 *   Files                         [≡ | ⊞]  [⏷ Filter]  [⇣ Recent]  [⋯]
 *
 * Title of the active sidebar list, the layout switch (list / grid), the
 * status filter, the sort menu (its label is the active sort field) and the
 * list options. On a narrow window the buttons drop their labels.
 *
 * @example <ListToolbar compact={false} />
 */
import { confirmClearCompleted, resumeAll, stopAllSharing } from '../../controllers/drive-actions'
import type { SortField } from '../../lib/drive-model'
import { cn } from '../../lib/cn'
import { api } from '../../services/client'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore, type ListTab, type StatusFilter } from '../../stores/ui-store'
import { Menu, useMenu, type MenuEntry } from '../ui/Menu'
import { VIcon, type VIconName } from '../ui/VIcon'

const SORTS: Array<[SortField, string]> = [
  ['recent', 'Recent'],
  ['status', 'Status'],
  ['size', 'Size'],
  ['name', 'Name'],
  ['peers', 'Peers'],
  ['filetype', 'File type']
]

export const LIST_TITLES: Record<ListTab, string> = { all: 'Files', shares: 'Shares', received: 'Received', favorites: 'Favorites' }

const chipButton =
  'chip flex h-[34px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold leading-[18px] text-fg transition-colors hover:bg-fg/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60'

function LayoutSwitch() {
  const view = useSettingsStore((s) => s.preferences.list.view)
  const update = useSettingsStore((s) => s.updatePreferences)
  const option = (value: 'table' | 'grid', icon: VIconName, label: string) => {
    const active = view === value
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        aria-label={label}
        title={label}
        onClick={() => void update({ list: { view: value } })}
        className={cn('flex items-center rounded-md p-1 transition-colors', active ? 'bg-tabs text-fg' : 'text-fg/70 hover:text-fg')}
      >
        <VIcon name={icon} size={18} />
      </button>
    )
  }
  return (
    <div role="radiogroup" aria-label="Layout" className="chip flex shrink-0 items-center gap-1 rounded-lg p-1">
      {option('table', 'row-vertical', 'List')}
      {option('grid', 'grid-2', 'Grid')}
    </div>
  )
}

export function ListToolbar({ compact }: { compact: boolean }) {
  const tab = useUiStore((s) => s.tab)
  const status = useUiStore((s) => s.statusFilter)
  const setStatus = useUiStore((s) => s.setStatusFilter)
  const list = useSettingsStore((s) => s.preferences.list)
  const update = useSettingsStore((s) => s.updatePreferences)
  const filterMenu = useMenu()
  const sortMenu = useMenu()
  const optionsMenu = useMenu()
  const filtered = status !== 'any'

  const statusItem = (value: StatusFilter, label: string): MenuEntry => ({ label, checked: status === value, onSelect: () => setStatus(value) })
  const filterItems: MenuEntry[] = [
    { heading: 'Status' },
    statusItem('any', 'Any status'),
    statusItem('active', 'Active & completed'),
    statusItem('transferring', 'In progress'),
    statusItem('attention', 'Needs attention')
  ]

  const sortItems: MenuEntry[] = [
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
    }))
  ]

  const optionItems: MenuEntry[] = [
    { label: 'Open downloads folder', icon: 'folder-outline', onSelect: () => void api().files.openDownloads() },
    { label: 'Resume all', icon: 'play', onSelect: () => void resumeAll() },
    { label: 'Stop all sharing', icon: 'stop', onSelect: () => void stopAllSharing() },
    { divider: true },
    { label: 'Clear list…', icon: 'trash', danger: true, onSelect: confirmClearCompleted }
  ]

  const sortLabel = SORTS.find(([f]) => f === list.sortField)?.[1] ?? 'Recent'

  return (
    <header className="drag-region -mx-4 flex h-[70px] shrink-0 items-center justify-between gap-3 px-4 py-4">
      <h1 className="min-w-0 truncate text-[18px] font-semibold leading-7 text-fg">{LIST_TITLES[tab]}</h1>
      <div className="no-drag flex items-center gap-2">
        <LayoutSwitch />
        <button
          ref={filterMenu.triggerRef}
          type="button"
          onClick={filterMenu.toggleFromTrigger}
          aria-label="Filter"
          title="Filter by status"
          className={cn(chipButton, filtered && 'border-accent/60 text-accent')}
        >
          <VIcon name="filter-square" size={18} />
          {!compact && <span>Filter</span>}
        </button>
        <Menu {...filterMenu.props} items={filterItems} width={190} />
        <button
          ref={sortMenu.triggerRef}
          type="button"
          onClick={sortMenu.toggleFromTrigger}
          aria-label={`Sort: ${sortLabel}`}
          title={`Sorted by ${sortLabel.toLowerCase()}`}
          className={chipButton}
        >
          <VIcon name="sort-descending" size={14} className={cn('transition-transform', list.sortDirection === 'asc' && '-scale-y-100')} />
          {!compact && <span>{sortLabel}</span>}
        </button>
        <Menu {...sortMenu.props} items={sortItems} width={170} />
        <button ref={optionsMenu.triggerRef} type="button" onClick={optionsMenu.toggleFromTrigger} aria-label="List options" title="List options" className={chipButton}>
          <VIcon name="more-2" size={18} />
        </button>
        <Menu {...optionsMenu.props} items={optionItems} width={200} />
      </div>
    </header>
  )
}
