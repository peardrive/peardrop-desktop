/**
 * DriveThumb — the square thumbnail at the left of a card/row.
 * Folder → teal folder glyph; single file → real preview (image / video
 * poster) when available, else the category icon.
 *
 * @example <DriveThumb drive={drive} title={drive.title} size={56} />
 */
import { cn } from '../../lib/cn'
import type { DriveView } from '../../lib/drive-model'
import { isGroup } from '../../lib/drive-model'
import { useThumbnail } from '../../hooks/useThumbnail'
import { FileTypeIcon, FolderGlyph } from '../ui/FileTypeIcon'

export interface DriveThumbProps {
  drive: Pick<DriveView, 'files' | 'name'>
  title: string
  size?: number
  /** Fill the parent's width as a square (grid tiles) instead of a fixed `size`. */
  fill?: boolean
  className?: string
}

export function DriveThumb({ drive, title, size = 40, fill, className }: DriveThumbProps) {
  const group = isGroup(drive)
  const file = !group ? drive.files[0] : undefined
  const { src, onError } = useThumbnail(file?.path, file?.name ?? title)
  return (
    <div
      className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]', src ? 'bg-black/30' : '', fill && 'aspect-square w-full', className)}
      style={fill ? undefined : { width: size, height: size }}
    >
      {group ? (
        <FolderGlyph className={fill ? 'h-[56%] w-[56%]' : 'h-[78%] w-[78%]'} />
      ) : src ? (
        <img src={src} alt="" draggable={false} onError={onError} className="h-full w-full object-cover" />
      ) : (
        <FileTypeIcon name={file?.name ?? drive.name} className={fill ? 'h-[46%] w-[46%]' : 'h-[70%] w-[70%]'} />
      )}
    </div>
  )
}
