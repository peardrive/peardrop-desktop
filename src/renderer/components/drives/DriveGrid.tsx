/**
 * DriveGrid — the card grid. Columns are fluid (`auto-fill`, ≥ 280px each):
 * one column in the smallest window, two in the default 900px window, and
 * as many as fit on a full-screen window, so a big screen shows more items
 * instead of wider ones.
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-1">
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
