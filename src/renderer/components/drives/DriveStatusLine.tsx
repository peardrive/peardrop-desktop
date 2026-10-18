/**
 * DriveStatusLine — the muted line under a card's title:
 *   [📄 3 Files •] [Picture •] Active – 1.2 MB/s
 * File count for folders, a type prefix for healthy single files, the
 * coloured status, and the live rate while bytes move.
 *
 * @example <DriveStatusLine drive={drive} fileCount={drive.files.length} />
 */
import { formatSpeed } from '../../lib/format'
import { isGroup, statusPresentation, typePrefix, type DriveView } from '../../lib/drive-model'
import { Icon } from '../ui/Icon'
import { StatusText } from '../ui/StatusText'

export interface DriveStatusLineProps {
  drive: DriveView
  /** Shown file count (narrowed while a search matches files inside). */
  fileCount?: number
}

export function DriveStatusLine({ drive, fileCount }: DriveStatusLineProps) {
  const { label, tone, moving } = statusPresentation(drive)
  const prefix = typePrefix(drive)
  const count = fileCount ?? drive.files.length
  const speed = moving ? formatSpeed(drive.speed) : ''
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
      {isGroup(drive) && (
        <>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Icon name="file" className="h-3.5 w-3.5 opacity-70" />
            {count} File{count !== 1 ? 's' : ''}
          </span>
          <span aria-hidden>•</span>
        </>
      )}
      {prefix && (
        <>
          <span className="whitespace-nowrap font-semibold text-fg/90">{prefix}</span>
          <span aria-hidden>•</span>
        </>
      )}
      <StatusText tone={tone} className="truncate">
        {label}
      </StatusText>
      {speed && (
        <span className="tabular whitespace-nowrap">
          <span aria-hidden>– </span>
          {speed}
        </span>
      )}
    </div>
  )
}
