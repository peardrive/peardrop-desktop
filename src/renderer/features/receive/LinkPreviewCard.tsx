/**
 * LinkPreviewCard — what a pasted link holds, shown in the Receive modal
 * in place of the QR options: a spinner while the sender is looked up, then
 * the share's name, size and files, or a note that the sender is offline.
 *
 * @example <LinkPreviewCard preview={null} />   // loading
 */
import type { LinkPreview } from '@shared/transfer'
import { formatBytes, timeAgo } from '../../lib/format'
import { FileTypeIcon, FolderGlyph } from '../../components/ui/FileTypeIcon'
import { Icon } from '../../components/ui/Icon'
import { Spinner } from '../../components/ui/Spinner'

const SHELL = 'flex min-h-[180px] flex-1 flex-col rounded-xl border border-fg/10 bg-fg/[0.03]'

/** `preview` null = still looking. */
export function LinkPreviewCard({ preview }: { preview: LinkPreview | null }) {
  if (!preview) {
    return (
      <div className={`${SHELL} items-center justify-center gap-3 text-muted`} aria-live="polite">
        <Spinner className="h-7 w-7 text-accent" />
        <span className="text-[13px] font-bold text-fg">Previewing share…</span>
        <span className="text-[12px]">Getting share details from the sender</span>
      </div>
    )
  }

  if (preview.status !== 'found') {
    return (
      <div className={`${SHELL} items-center justify-center gap-3 px-6 text-center text-muted`} aria-live="polite">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Icon name="wifi-off" className="h-7 w-7" />
        </span>
        <span className="text-[13px] font-bold text-fg">The sender is offline</span>
        <span className="text-[12px]">Download anyway: PearDrop keeps trying and starts when they are back</span>
      </div>
    )
  }

  const single = preview.totalFiles === 1
  const title = preview.name || (single ? preview.files[0]?.name : null) || 'Shared files'
  const more = preview.totalFiles - preview.files.length
  const meta = [
    single ? null : `${preview.totalFiles} files`,
    formatBytes(preview.totalBytes),
    preview.createdAt ? `shared ${timeAgo(preview.createdAt)}` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`${SHELL} min-h-0 overflow-hidden`} aria-live="polite">
      <div className="flex items-center gap-3 border-b border-fg/10 px-4 py-3">
        {single ? <FileTypeIcon name={title} className="h-10 w-10 shrink-0" /> : <FolderGlyph className="h-10 w-10 shrink-0" />}
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-fg" title={title}>
            {title}
          </div>
          <div className="text-[12px] text-muted">{meta}</div>
        </div>
      </div>

      {!single && (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {preview.files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1">
              <FileTypeIcon name={f.name} className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-fg" title={f.name}>
                {f.name}
              </span>
              <span className="shrink-0 text-[11px] text-muted">{formatBytes(f.size)}</span>
            </li>
          ))}
          {more > 0 && <li className="px-2 py-1 text-[11px] font-semibold text-subtle">+ {more} more</li>}
        </ul>
      )}
    </div>
  )
}
