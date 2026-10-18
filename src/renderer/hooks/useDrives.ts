import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { displayTitle, driveMatches, sortDrives, type DriveStatus, type DriveView } from '../lib/drive-model'
import { useDrivesStore } from '../stores/drives-store'
import { useMetaStore } from '../stores/meta-store'
import { useSettingsStore } from '../stores/settings-store'
import { useUiStore, type StatusFilter } from '../stores/ui-store'

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

/**
 * The list the main view renders: tab (Shares/Favorites) → kind/status
 * filters → search → sort. Everything is derived; nothing is copied into
 * component state, so a progress tick re-renders only what changed.
 */
export function useVisibleDrives(): { items: DriveItemModel[]; total: number } {
  const { drives, order } = useDrivesStore(useShallow((s) => ({ drives: s.drives, order: s.order })))
  const { aliases, favorites } = useMetaStore(useShallow((s) => ({ aliases: s.aliases, favorites: s.favorites })))
  const { tab, search, kindFilter, statusFilter } = useUiStore(
    useShallow((s) => ({ tab: s.tab, search: s.search, kindFilter: s.kindFilter, statusFilter: s.statusFilter }))
  )
  const { sortField, sortDirection } = useSettingsStore(useShallow((s) => s.preferences.list))

  return useMemo(() => {
    const all = order.map((id) => drives[id]).filter(Boolean)
    const enriched: DriveItemModel[] = all.map((d) => ({ ...d, title: displayTitle(d, aliases), favorite: favorites.has(d.id) }))
    const filtered = enriched.filter(
      (d) =>
        (tab !== 'favorites' || d.favorite) &&
        (kindFilter === 'all' || d.kind === kindFilter) &&
        (statusFilter === 'any' || STATUS_GROUPS[statusFilter].includes(d.status)) &&
        driveMatches(d, d.title, search)
    )
    return { items: sortDrives(filtered, sortField, sortDirection, (d) => d.title), total: tab === 'favorites' ? enriched.filter((d) => d.favorite).length : enriched.length }
  }, [drives, order, aliases, favorites, tab, search, kindFilter, statusFilter, sortField, sortDirection])
}
