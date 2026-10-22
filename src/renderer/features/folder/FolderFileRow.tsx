/**
 * FolderFileRow — one file inside the folder modal: preview, name, size and
 * Open (or "Removed" when the file is gone from disk).
 *
 * @example <FolderFileRow file={f} missing={!exists[f.path]} />
 */
import type { DriveFile } from '@shared/transfer'
import { openLocalFile } from '../../controllers/drive-actions'
import { cn } from '../../lib/cn'
import { formatBytes } from '../../lib/format'
import { useThumbnail } from '../../hooks/useThumbnail'
import { Button } from '../../components/ui/Button'
import { FileTypeIcon } from '../../components/ui/FileTypeIcon'

export function FolderFileRow({ file, missing }: { file: DriveFile; missing: boolean }) {
  const { src, onError } = useThumbnail(missing ? null : file.path, file.name)
  const open = () => !missing && void openLocalFile(file.path)
  return (
    <div onClick={open} className={cn('flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors', !missing && 'hover:bg-fg/[0.05]')}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">
        {src ? <img src={src} alt="" onError={onError} className="h-full w-full object-cover" /> : <FileTypeIcon name={file.name} className="h-8 w-8" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[12px] font-semibold', missing && 'text-muted line-through')} title={file.name}>
          {file.name}
        </div>
        <div className={cn('text-[11px]', missing ? 'font-semibold text-danger' : 'text-muted')}>{missing ? 'File removed' : formatBytes(file.size)}</div>
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={missing || !file.path}
        onClick={(e) => {
          e.stopPropagation()
          open()
        }}
      >
        {missing ? 'Removed' : 'Open'}
      </Button>
    </div>
  )
}
