/**
 * DriveOpenTarget — the only part of a drive card or row that opens the
 * file (or the folder modal): its thumbnail and its title. The rest of the
 * row is inert, so a click that misses the ⋮ menu or an action button never
 * plays the file.
 *
 * @example <DriveOpenTarget drive={d} disabled={busy}>{d.title}</DriveOpenTarget>
 */
import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { openDrive } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'

export interface DriveOpenTargetProps {
  drive: DriveItemModel
  /** No opening while the drive is being removed or cancelled. */
  disabled?: boolean
  /** The thumbnail duplicates the title's action: keep it out of the tab order. */
  decorative?: boolean
  className?: string
  children: ReactNode
}

export function DriveOpenTarget({ drive, disabled, decorative, className, children }: DriveOpenTargetProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      tabIndex={decorative ? -1 : undefined}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `Open ${drive.title}`}
      title={drive.title}
      onClick={(e) => {
        e.stopPropagation()
        openDrive(drive)
      }}
      className={cn(
        'cursor-pointer rounded-[6px] text-left disabled:cursor-default',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        !decorative && 'hover:underline disabled:hover:no-underline',
        className
      )}
    >
      {children}
    </button>
  )
}
