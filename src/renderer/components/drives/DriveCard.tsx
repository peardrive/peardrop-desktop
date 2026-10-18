/**
 * DriveCard — one share/download in the two-column grid (Figma #12).
 *
 * Thumbnail · title (+ gold star when favourited) · status line · progress
 * bar while transferring · contextual buttons · ⋮ menu. Click opens the file
 * (or the folder modal); right-click opens the menu at the pointer.
 *
 * @example <DriveCard drive={item} fileCount={matchCount} highlighted={id === highlightId} />
 */
import { memo, useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { isInFlight } from '../../lib/drive-model'
import { cancelRemoval, openDrive, runRowAction } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'
import { useDrivesStore } from '../../stores/drives-store'
import { Icon } from '../ui/Icon'
import { useMenu } from '../ui/Menu'
import { ProgressBar } from '../ui/Progress'
import { Spinner } from '../ui/Spinner'
import { DriveMenuButton } from './DriveMenuButton'
import { CancellingOverlay, DeleteCountdown } from './DriveOverlays'
import { DriveRowActions } from './DriveRowActions'
import { DriveStatusLine } from './DriveStatusLine'
import { DriveThumb } from './DriveThumb'

export interface DriveCardProps {
  drive: DriveItemModel
  /** File count to show (narrowed while searching). */
  fileCount?: number
  highlighted?: boolean
}

export const DriveCard = memo(function DriveCard({ drive, fileCount, highlighted }: DriveCardProps) {
  const menu = useMenu()
  const ref = useRef<HTMLDivElement>(null)
  const pending = useDrivesStore((s) => s.pendingDeletes[drive.id])
  const cancelling = useDrivesStore((s) => s.cancelling.has(drive.id))

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [highlighted])

  const showProgress = drive.progress != null && drive.progress < 1 && isInFlight(drive) && drive.status !== 'interrupted'
  const busy = !!pending || cancelling

  return (
    <div
      ref={ref}
      data-drive-id={drive.id}
      onClick={() => !busy && openDrive(drive)}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!busy && !drive.isPlaceholder) menu.openAt({ x: e.clientX, y: e.clientY })
      }}
      className={cn(
        'group relative flex min-w-0 cursor-default items-center gap-4 rounded-card px-3 py-3.5 transition-colors',
        !busy && 'hover:bg-fg/[0.04]',
        highlighted && 'animate-highlight'
      )}
    >
      {drive.isPlaceholder ? (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-fg/[0.06]">
          <Spinner className="h-6 w-6 text-warning" />
        </div>
      ) : (
        <DriveThumb drive={drive} title={drive.title} />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[16px] font-bold text-fg" title={drive.title}>
            {drive.title}
          </span>
          {drive.favorite && <Icon name="star" className="h-3.5 w-3.5 shrink-0 text-star" label="Favorite" />}
        </div>
        <DriveStatusLine drive={drive} fileCount={fileCount} />
        {showProgress && <ProgressBar value={drive.progress ?? 0} tone="warning" className="mt-1" />}
      </div>

      <DriveRowActions drive={drive} onAction={(a) => runRowAction(a, drive)} />
      {!drive.isPlaceholder && <DriveMenuButton drive={drive} menu={menu} />}

      {pending && <DeleteCountdown pending={pending} onUndo={() => cancelRemoval(drive.id)} />}
      {!pending && cancelling && <CancellingOverlay />}
    </div>
  )
})
