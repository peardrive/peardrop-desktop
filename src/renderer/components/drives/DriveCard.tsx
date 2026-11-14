/**
 * DriveCard — one share/download in the expanded layout (two wide columns).
 *
 *   [ 64px thumbnail ]  Title ★                       [state buttons] [📁] [⋮]
 *                       Picture • 1.2 MB • Active – 1.2 MB/s
 *                       [progress bar while transferring]
 *
 * Clicking the thumbnail or the title opens the file (or the folder modal);
 * there is no Open button. Transient state buttons (resume, cancel, retry …)
 * stay visible; everything else is in the ⋮ menu, which right-click also
 * opens at the pointer.
 *
 * @example <DriveCard drive={item} fileCount={matchCount} highlighted={id === highlightId} />
 */
import { memo, useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'
import { isInFlight } from '../../lib/drive-model'
import { cancelRemoval, runRowAction } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'
import { useDrivesStore } from '../../stores/drives-store'
import { Icon } from '../ui/Icon'
import { useMenu } from '../ui/Menu'
import { ProgressBar } from '../ui/Progress'
import { Spinner } from '../ui/Spinner'
import { VIcon } from '../ui/VIcon'
import { DriveMenuButton } from './DriveMenuButton'
import { DriveOpenTarget } from './DriveOpenTarget'
import { DriveRevealButton } from './DriveRevealButton'
import { CancellingOverlay, DeleteCountdown } from './DriveOverlays'
import { DriveRowActions } from './DriveRowActions'
import { DriveStatusLine } from './DriveStatusLine'
import { DriveThumb } from './DriveThumb'

const THUMB = 64

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
      onContextMenu={(e) => {
        e.preventDefault()
        if (!busy && !drive.isPlaceholder) menu.openAt({ x: e.clientX, y: e.clientY })
      }}
      className={cn(
        'group relative flex min-w-0 cursor-default items-center gap-3.5 rounded-card px-2.5 py-2.5 transition-colors',
        !busy && 'hover:bg-fg/[0.04]',
        highlighted && 'animate-highlight'
      )}
    >
      {drive.isPlaceholder ? (
        <div className="flex shrink-0 items-center justify-center rounded-[9px] bg-fg/[0.06]" style={{ width: THUMB, height: THUMB }} title={drive.shareLink}>
          {drive.receive?.phase === 'waiting' ? (
            <VIcon name="directbox-receive" size={26} className="text-warning" />
          ) : (
            <Spinner className="h-5 w-5 text-warning" />
          )}
        </div>
      ) : (
        <DriveOpenTarget drive={drive} disabled={busy} decorative className="shrink-0 rounded-[9px]">
          <DriveThumb drive={drive} title={drive.title} size={THUMB} />
        </DriveOpenTarget>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {drive.isPlaceholder ? (
            <span className="truncate text-[13px] font-semibold text-fg" title={drive.title}>
              {drive.title}
            </span>
          ) : (
            <DriveOpenTarget drive={drive} disabled={busy} className="min-w-0 truncate text-[13px] font-semibold text-fg">
              {drive.title}
            </DriveOpenTarget>
          )}
          {drive.favorite && <Icon name="star" className="h-3 w-3 shrink-0 text-star" label="Favorite" />}
        </div>
        <DriveStatusLine drive={drive} fileCount={fileCount} showSize />
        {showProgress && <ProgressBar value={drive.progress ?? 0} tone="warning" className="mt-1" />}
      </div>

      <div className="flex shrink-0 items-center gap-1 self-start pt-0.5">
        <DriveRowActions drive={drive} exclude={['open']} onAction={(a) => runRowAction(a, drive)} />
        <DriveRevealButton drive={drive} disabled={busy} />
        {!drive.isPlaceholder && <DriveMenuButton drive={drive} menu={menu} />}
      </div>

      {pending && <DeleteCountdown pending={pending} onUndo={() => cancelRemoval(drive.id)} />}
      {!pending && cancelling && <CancellingOverlay />}
    </div>
  )
})
