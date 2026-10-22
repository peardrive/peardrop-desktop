/**
 * FolderModal — Figma #22: a multi-file share's contents in the same
 * two-column grid as the main list, with its own search (seeded from the
 * list search when files inside matched), live status and Copy Link.
 *
 * @example openModal({ type: 'folder', driveId })
 */
import { useEffect, useMemo, useState } from 'react'
import { nameMatches, statusPresentation } from '../../lib/drive-model'
import { formatBytes, plural } from '../../lib/format'
import { useCopy } from '../../hooks/useCopy'
import { useDrive } from '../../hooks/useDrives'
import { api } from '../../services/client'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../../components/ui/Button'
import { FolderGlyph } from '../../components/ui/FileTypeIcon'
import { Modal } from '../../components/ui/Modal'
import { SearchField } from '../../components/ui/SearchField'
import { StatusText } from '../../components/ui/StatusText'
import { FolderFileRow } from './FolderFileRow'

export function FolderModal({ driveId, onClose, isTop }: { driveId: string; onClose: () => void; isTop: boolean }) {
  const drive = useDrive(driveId)
  const listQuery = useUiStore((s) => s.search)
  const files = drive?.files ?? []
  // Seed the list's query only if it matches files inside (a folder can also
  // match on its own name, and filtering by that would show nothing).
  const [query, setQuery] = useState(() => (listQuery.trim() && files.some((f) => nameMatches(f.name, listQuery)) ? listQuery.trim() : ''))
  const [exists, setExists] = useState<Record<string, boolean>>({})
  const { copied, copy } = useCopy()

  const pathsKey = files.map((f) => f.path ?? '').join('|')
  useEffect(() => {
    const paths = files.map((f) => f.path).filter((p): p is string => !!p)
    if (!paths.length) return
    let alive = true
    api()
      .files.exists(paths)
      .then((r) => alive && setExists(r))
      .catch(() => undefined)
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathsKey])

  const shown = useMemo(() => files.filter((f) => nameMatches(f.name, query)), [files, query])
  if (!drive) return null
  const total = files.reduce((n, f) => n + (f.size || 0), 0)
  const { label, tone } = statusPresentation(drive)

  return (
    <Modal onClose={onClose} isTop={isTop} footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <div className="flex items-center gap-4 pb-4">
        <FolderGlyph className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold">{drive.title}</h2>
          <div className="text-[12px] text-muted">{files.length ? `${plural(files.length, 'file')} · ${formatBytes(total)}` : 'Empty folder'}</div>
          <StatusText tone={tone} className="text-[12px]">
            {label}
          </StatusText>
        </div>
        {drive.shareLink && (
          <Button variant="primary" size="sm" className="min-w-[104px]" onClick={() => void copy(drive.shareLink)}>
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
        )}
      </div>
      <SearchField value={query} onChange={setQuery} placeholder="Search in this folder" />
      <div className="mt-1 h-5 px-4 text-[12px] font-semibold text-warning">{query && !shown.length && files.length > 0 ? `No files match “${query.trim()}”` : ''}</div>
      {files.length === 0 ? (
        <p className="py-10 text-center text-[12px] text-muted">This folder has no files yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          {shown.map((f) => (
            <FolderFileRow key={f.key ?? f.path ?? f.name} file={f} missing={!!f.path && exists[f.path] === false} />
          ))}
        </div>
      )}
    </Modal>
  )
}
