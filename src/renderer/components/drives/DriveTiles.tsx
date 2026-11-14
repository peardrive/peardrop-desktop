/**
 * DriveTiles — the grid layout: thumbnail-first tiles, like icon view in
 * Finder, with the details underneath.
 *
 *   ┌──────────────┐
 *   │  thumbnail   │   ← square, fills the tile; 📁 and ⋮ appear in its corner on hover
 *   └──────────────┘
 *   Title ★
 *   Picture • 1.2 MB
 *   Active – 1.2 MB/s
 *   [progress bar while transferring]
 *   [state buttons: resume / cancel / retry …]
 *
 * Tiles are as wide as the "Grid tiles" setting (Settings → Appearance) and
 * as many fit the row. Clicking the thumbnail or the title opens the file;
 * right-click opens the ⋮ menu at the pointer. Same hover bubble as the other
 * layouts.
 *
 * @example <DriveTiles items={items} search={q} highlightId={hid} />
 */
import { memo, useEffect, useRef } from 'react'
import type { TileSize } from '@shared/preferences'
import { cn } from '../../lib/cn'
import { isInFlight, matchingFileCount } from '../../lib/drive-model'
import { cancelRemoval, runRowAction } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'
import { useDrivesStore } from '../../stores/drives-store'
import { useSettingsStore } from '../../stores/settings-store'
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

/** Smallest tile width per setting; tiles stretch to fill the row. */
const TILE_MIN_WIDTH: Record<TileSize, number> = { small: 132, medium: 168, large: 220 }

export interface DriveTilesProps {
  items: DriveItemModel[]
  search: string
  highlightId: string | null
}

export function DriveTiles({ items, search, highlightId }: DriveTilesProps) {
  const tileSize = useSettingsStore((s) => s.preferences.list.tileSize)
  return (
    <div className="grid gap-x-3 gap-y-2 px-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN_WIDTH[tileSize]}px, 1fr))` }}>
      {items.map((d) => {
        const hits = search ? matchingFileCount(d, search) : d.files.length
        return <DriveTile key={d.id} drive={d} fileCount={search && hits > 0 ? hits : d.files.length} highlighted={highlightId === d.id} />
      })}
    </div>
  )
}

const DriveTile = memo(function DriveTile({ drive, fileCount, highlighted }: { drive: DriveItemModel; fileCount: number; highlighted: boolean }) {
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
        'group relative flex min-w-0 cursor-default flex-col gap-2 rounded-card p-2 transition-colors',
        !busy && 'hover:bg-fg/[0.04]',
        highlighted && 'animate-highlight'
      )}
    >
      <div className="relative">
        {drive.isPlaceholder ? (
          <div className="flex aspect-square w-full items-center justify-center rounded-[9px] bg-fg/[0.06]" title={drive.shareLink}>
            {drive.receive?.phase === 'waiting' ? (
              <VIcon name="directbox-receive" size={36} className="text-warning" />
            ) : (
              <Spinner className="h-6 w-6 text-warning" />
            )}
          </div>
        ) : (
          <DriveOpenTarget drive={drive} disabled={busy} decorative className="block w-full rounded-[9px]">
            <DriveThumb drive={drive} title={drive.title} fill className="bg-fg/[0.05]" />
          </DriveOpenTarget>
        )}
        {/* Folder + ⋮ sit in the thumbnail's corner; shown on hover, or always while the menu is open. */}
        {!drive.isPlaceholder && (
          <div
            className={cn(
              'absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-canvas/80 p-0.5 backdrop-blur-sm transition-opacity',
              menu.props.open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
            )}
          >
            <DriveRevealButton drive={drive} disabled={busy} />
            <DriveMenuButton drive={drive} menu={menu} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <div className="flex min-w-0 items-center gap-1">
          {drive.isPlaceholder ? (
            <span className="truncate text-[12px] font-semibold text-fg" title={drive.title}>
              {drive.title}
            </span>
          ) : (
            <DriveOpenTarget drive={drive} disabled={busy} className="min-w-0 truncate text-[12px] font-semibold text-fg">
              {drive.title}
            </DriveOpenTarget>
          )}
          {drive.favorite && <Icon name="star" className="h-3 w-3 shrink-0 text-star" label="Favorite" />}
        </div>
        <DriveStatusLine drive={drive} fileCount={fileCount} showSize wrap />
        {showProgress && <ProgressBar value={drive.progress ?? 0} tone="warning" className="mt-1" />}
        <DriveRowActions drive={drive} exclude={['open']} onAction={(a) => runRowAction(a, drive)} className="mt-1" />
      </div>

      {pending && <DeleteCountdown pending={pending} onUndo={() => cancelRemoval(drive.id)} />}
      {!pending && cancelling && <CancellingOverlay />}
    </div>
  )
})
