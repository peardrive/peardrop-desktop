/**
 * DriveTable — the compact table view of the list (Figma #13):
 * Name · Type · Size · Status · actions.
 *
 * @example <DriveTable items={items} highlightId={hid} />
 */
import { memo, useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { CATEGORY_LABEL, categoryOf } from '../../lib/file-types'
import { formatBytes } from '../../lib/format'
import { isGroup, sourceName, statusPresentation } from '../../lib/drive-model'
import { cancelRemoval, openDrive, runRowAction } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'
import { useDrivesStore } from '../../stores/drives-store'
import { Icon } from '../ui/Icon'
import { useMenu } from '../ui/Menu'
import { ProgressBar } from '../ui/Progress'
import { Badge } from '../ui/StatusText'
import { DriveMenuButton } from './DriveMenuButton'
import { CancellingOverlay, DeleteCountdown } from './DriveOverlays'
import { DriveRowActions } from './DriveRowActions'
import { DriveThumb } from './DriveThumb'

const COLS = 'grid grid-cols-[minmax(0,1fr)_120px_100px_170px_auto] items-center gap-4'

export function DriveTable({ items, highlightId }: { items: DriveItemModel[]; highlightId: string | null }) {
  return (
    <div className="px-2" role="table">
      <div role="row" className={cn(COLS, 'sticky top-0 z-[1] border-b border-line/70 bg-panel px-3 pb-2 pt-1 text-xs font-bold uppercase tracking-wider text-subtle')}>
        <span>Name</span>
        <span>Type</span>
        <span>Size</span>
        <span>Status</span>
        <span className="w-[120px]" />
      </div>
      {items.map((d) => (
        <DriveTableRow key={d.id} drive={d} highlighted={highlightId === d.id} />
      ))}
    </div>
  )
}

/** One table row. */
const DriveTableRow = memo(function DriveTableRow({ drive, highlighted }: { drive: DriveItemModel; highlighted: boolean }) {
  const menu = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const pending = useDrivesStore((s) => s.pendingDeletes[drive.id])
  const cancelling = useDrivesStore((s) => s.cancelling.has(drive.id))
  const { label, tone } = statusPresentation(drive)
  const type = isGroup(drive) ? 'Folder' : CATEGORY_LABEL[categoryOf(sourceName(drive))]
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlighted])
  return (
    <div
      ref={ref}
      role="row"
      onClick={() => !pending && !cancelling && openDrive(drive)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!drive.isPlaceholder) menu.openAt({ x: e.clientX, y: e.clientY })
      }}
      className={cn(COLS, 'relative rounded-xl border-b border-line/40 px-3 py-2 transition-colors hover:bg-fg/[0.04]', highlighted && 'animate-highlight')}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DriveThumb drive={drive} title={drive.title} size={36} className="rounded-[9px]" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{drive.title}</span>
            {drive.favorite && <Icon name="star" className="h-3 w-3 shrink-0 text-star" />}
          </div>
          {drive.progress != null && drive.progress < 1 && (drive.status === 'downloading' || drive.status === 'sharing') && (
            <ProgressBar value={drive.progress} tone="warning" className="mt-1 h-1" />
          )}
        </div>
      </div>
      <span className="truncate text-sm text-muted">
        {type}
        {isGroup(drive) && ` · ${drive.files.length}`}
      </span>
      <span className="tabular text-sm text-muted">{formatBytes(drive.size)}</span>
      <span>
        <Badge tone={tone}>{label}</Badge>
      </span>
      <div className="flex items-center justify-end gap-1">
        <DriveRowActions drive={drive} onAction={(a) => runRowAction(a, drive)} />
        {!drive.isPlaceholder && <DriveMenuButton drive={drive} menu={menu} />}
      </div>
      {pending && <DeleteCountdown pending={pending} onUndo={() => cancelRemoval(drive.id)} />}
      {!pending && cancelling && <CancellingOverlay />}
    </div>
  )
})
