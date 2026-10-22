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

// Type and size need a wide window; name, status and actions always fit.
const COLS = 'grid grid-cols-[minmax(0,1fr)_minmax(0,124px)_96px] lg:grid-cols-[minmax(0,1fr)_90px_72px_124px_96px] items-center gap-3'

export function DriveTable({ items, highlightId }: { items: DriveItemModel[]; highlightId: string | null }) {
  return (
    <div className="px-2" role="table">
      <div role="row" className={cn(COLS, 'sticky top-0 z-[1] border-b border-fg/[0.08] bg-panel px-2 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle')}>
        <span>Name</span>
        <span className="hidden lg:block">Type</span>
        <span className="hidden lg:block">Size</span>
        <span>Status</span>
        <span className="w-[96px]" />
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
      className={cn(COLS, 'relative rounded-lg border-b border-fg/[0.06] px-2 py-1.5 transition-colors hover:bg-fg/[0.04]', highlighted && 'animate-highlight')}
    >
      <div className="flex min-w-0 items-center gap-3">
        <DriveThumb drive={drive} title={drive.title} size={28} className="rounded-[7px]" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-semibold">{drive.title}</span>
            {drive.favorite && <Icon name="star" className="h-3 w-3 shrink-0 text-star" />}
          </div>
          {drive.progress != null && drive.progress < 1 && (drive.status === 'downloading' || drive.status === 'sharing') && (
            <ProgressBar value={drive.progress} tone="warning" className="mt-1 h-1" />
          )}
        </div>
      </div>
      <span className="hidden truncate text-[11px] text-muted lg:block">
        {type}
        {isGroup(drive) && ` · ${drive.files.length}`}
      </span>
      <span className="tabular hidden text-[11px] text-muted lg:block">{formatBytes(drive.size)}</span>
      <span className="min-w-0 truncate">
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
