/**
 * DriveGrid — the expanded layout: wide cards in two columns (one when the
 * content area is too narrow for two, e.g. a small window or a large
 * interface size).
 *
 * @example <DriveGrid items={items} search={q} highlightId={hid} />
 */
import { matchingFileCount } from '../../lib/drive-model'
import type { DriveItemModel } from '../../hooks/useDrives'
import { DriveCard } from './DriveCard'

export interface DriveGridProps {
  items: DriveItemModel[]
  search: string
  highlightId: string | null
}

export function DriveGrid({ items, search, highlightId }: DriveGridProps) {
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 min-[860px]:grid-cols-2">
      {items.map((d) => {
        const hits = search ? matchingFileCount(d, search) : d.files.length
        return (
          <div key={d.id} className="min-w-0 border-b border-fg/[0.06]">
            <DriveCard drive={d} fileCount={search && hits > 0 ? hits : d.files.length} highlighted={highlightId === d.id} />
          </div>
        )
      })}
    </div>
  )
}
