/**
 * StagedFileList — files picked but not shared yet, with per-item removal
 * and the Share action (Send modal state B).
 *
 * @example <StagedFileList />
 */
import { startShare } from '../../controllers/share'
import { formatBytes, plural } from '../../lib/format'
import { useStagedFilesStore } from '../../stores/staged-files-store'
import { Button } from '../../components/ui/Button'
import { FileTypeIcon, FolderGlyph } from '../../components/ui/FileTypeIcon'
import { IconButton } from '../../components/ui/IconButton'

export function StagedFileList() {
  const files = useStagedFilesStore((s) => s.files)
  const removeAt = useStagedFilesStore((s) => s.removeAt)
  const clear = useStagedFilesStore((s) => s.clear)
  const total = files.reduce((n, f) => n + (f.size || 0), 0)
  const count = files.reduce((n, f) => n + (f.type === 'folder' ? f.fileCount || 0 : 1), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between pb-2 pt-4">
        <span className="text-[12px] font-bold">
          Ready to share · <span className="text-muted">{plural(count, 'file')} · {formatBytes(total)}</span>
        </span>
        <Button size="xs" variant="ghost" onClick={clear}>
          Clear all
        </Button>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {files.map((f, i) => (
          <li key={f.path} className="flex items-center gap-3 rounded-xl bg-fg/[0.04] px-3 py-2">
            {f.type === 'folder' ? <FolderGlyph className="h-8 w-8" /> : <FileTypeIcon name={f.name} className="h-8 w-8" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold" title={f.path}>
                {f.name}
              </div>
              <div className="text-[11px] text-muted">
                {f.type === 'folder' ? `${plural(f.fileCount ?? 0, 'file')} · ` : ''}
                {formatBytes(f.size)}
              </div>
            </div>
            <IconButton icon="close" label={`Remove ${f.name}`} size="sm" tone="danger" onClick={() => removeAt(i)} />
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" block className="mt-4" onClick={() => void startShare()} disabled={!files.length}>
        Share {files.length > 1 ? `${files.length} items` : ''}
      </Button>
    </div>
  )
}
