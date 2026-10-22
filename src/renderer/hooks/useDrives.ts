import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { displayTitle, driveMatches, sortDrives, type DriveStatus, type DriveView } from '../lib/drive-model'
import { useDrivesStore } from '../stores/drives-store'
import { useMetaStore } from '../stores/meta-store'
import { useSettingsStore } from '../stores/settings-store'
import { useUiStore, type ListTab, type StatusFilter } from '../stores/ui-store'

/** A card plus everything derived from user metadata. */
export interface DriveItemModel extends DriveView {
  title: string
  favorite: boolean
}

const STATUS_GROUPS: Record<Exclude<StatusFilter, 'any'>, DriveStatus[]> = {
  active: ['sharing', 'complete'],
  transferring: ['downloading', 'connecting', 'initiating', 'interrupted'],
  attention: ['inactive', 'error', 'missing', 'lost', 'unreachable']
}

/** One drive by id, enriched with title/favorite. */
export function useDrive(id: string | null | undefined): DriveItemModel | null {
  const drive = useDrivesStore((s) => (id ? s.drives[id] : undefined))
  const aliases = useMetaStore((s) => s.aliases)
  const favorites = useMetaStore((s) => s.favorites)
  return useMemo(
    () => (drive ? { ...drive, title: displayTitle(drive, aliases), favorite: favorites.has(drive.id) } : null),
    [drive, aliases, favorites]
  )
}

/** Does a card belong to a sidebar list? */
export function inTab(d: Pick<DriveItemModel, 'kind' | 'favorite'>, tab: ListTab): boolean {
  switch (tab) {
    case 'all':
      return true
    case 'shares':
      return d.kind === 'share'
    case 'received':
      return d.kind === 'download'
    case 'favorites':
      return d.favorite
  }
}

/** How many cards each sidebar list holds (for the counters). */
export function useTabCounts(): Record<ListTab, number> {
  const { drives, order } = useDrivesStore(useShallow((s) => ({ drives: s.drives, order: s.order })))
  const favorites = useMetaStore((s) => s.favorites)
  return useMemo(() => {
    const counts: Record<ListTab, number> = { all: 0, shares: 0, received: 0, favorites: 0 }
    for (const id of order) {
      const d = drives[id]
      if (!d) continue
      counts.all++
      if (d.kind === 'share') counts.shares++
      else counts.received++
      if (favorites.has(id)) counts.favorites++
    }
    return counts
  }, [drives, order, favorites])
}

/**
 * The list the main view renders: sidebar list (All/Shares/Received/Favorites) → status
 * filters → search → sort. Everything is derived; nothing is copied into
 * component state, so a progress tick re-renders only what changed.
 */
export function useVisibleDrives(): { items: DriveItemModel[]; total: number } {
  const { drives, order } = useDrivesStore(useShallow((s) => ({ drives: s.drives, order: s.order })))
  const { aliases, favorites } = useMetaStore(useShallow((s) => ({ aliases: s.aliases, favorites: s.favorites })))
  const { tab, search, statusFilter } = useUiStore(useShallow((s) => ({ tab: s.tab, search: s.search, statusFilter: s.statusFilter })))
  const { sortField, sortDirection } = useSettingsStore(useShallow((s) => s.preferences.list))

  return useMemo(() => {
    const all = order.map((id) => drives[id]).filter(Boolean)
    const enriched: DriveItemModel[] = all.map((d) => ({ ...d, title: displayTitle(d, aliases), favorite: favorites.has(d.id) }))
    const inList = enriched.filter((d) => inTab(d, tab))
    const filtered = inList.filter(
      (d) => (statusFilter === 'any' || STATUS_GROUPS[statusFilter].includes(d.status)) && driveMatches(d, d.title, search)
    )
    return { items: sortDrives(filtered, sortField, sortDirection, (d) => d.title), total: inList.length }
  }, [drives, order, aliases, favorites, tab, search, statusFilter, sortField, sortDirection])
}
