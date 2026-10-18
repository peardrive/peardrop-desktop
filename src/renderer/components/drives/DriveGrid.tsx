/**
 * DriveGrid — the two-column card grid with a centre divider and row
 * separators (Figma #12). Rows that a filter hides simply are not rendered,
 * so separators always follow what is on screen.
 *
 * @example <DriveGrid items={items} search={q} highlightId={hid} />
 */
import { matchingFileCount } from '../../lib/drive-model'
import type { DriveItemModel } from '../../hooks/useDrives'
import { cn } from '../../lib/cn'
import { DriveCard } from './DriveCard'

export interface DriveGridProps {
  items: DriveItemModel[]
  search: string
  highlightId: string | null
}

export function DriveGrid({ items, search, highlightId }: DriveGridProps) {
  const lastRowStart = items.length - (items.length % 2 === 0 ? 2 : 1)
  return (
    <div className="relative grid grid-cols-2 gap-x-12 px-2">
      {items.length > 1 && <div aria-hidden className="pointer-events-none absolute bottom-2 left-1/2 top-2 w-px bg-line/70" />}
      {items.map((d, i) => {
        const hits = search ? matchingFileCount(d, search) : d.files.length
        return (
          <div key={d.id} className={cn('min-w-0 py-1', i < lastRowStart && 'border-b border-line/60')}>
            <DriveCard drive={d} fileCount={search && hits > 0 ? hits : d.files.length} highlighted={highlightId === d.id} />
          </div>
        )
      })}
    </div>
  )
}
