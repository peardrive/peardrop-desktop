/**
 * RenameModal — set a local display name (alias) for a card. Never renames
 * a file on disk and never reaches peers; an empty name resets to the
 * original.
 *
 * @example openModal({ type: 'rename', driveId })
 */
import { useState } from 'react'
import { ALIAS_MAX_LEN } from '@shared/library'
import { baseTitle, FOLDER_PLACEHOLDER } from '../../lib/drive-model'
import { useDrive } from '../../hooks/useDrives'
import { useMetaStore } from '../../stores/meta-store'
import { toast } from '../../stores/toast-store'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'

export function RenameModal({ driveId, onClose, isTop }: { driveId: string; onClose: () => void; isTop: boolean }) {
  const drive = useDrive(driveId)
  const alias = useMetaStore((s) => s.aliases[driveId] ?? '')
  const setAlias = useMetaStore((s) => s.setAlias)
  const [value, setValue] = useState(alias)
  if (!drive) return null
  const original = baseTitle(drive.name, drive.files.length)

  const commit = async (next: string) => {
    const clean = next.trim().slice(0, ALIAS_MAX_LEN)
    onClose()
    // Silence is the honest response to a no-op.
    if (clean === alias) return
    await setAlias(driveId, clean || null)
    toast.success(clean ? 'Renamed' : 'Name reset')
  }

  return (
    <Modal title="Rename" size="compact" onClose={onClose} isTop={isTop}>
      <p className="text-sm leading-relaxed text-muted">Only changes how this appears in PearDrop. Files on disk — and what peers see — stay the same.</p>
      <label className="mb-2 mt-5 block text-xs font-bold uppercase tracking-wider text-subtle" htmlFor="rename-input">
        Display name
      </label>
      <TextField
        id="rename-input"
        autoFocus
        value={value}
        maxLength={ALIAS_MAX_LEN}
        placeholder={original}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void commit(value)}
      />
      <div className="mt-2 flex min-h-[24px] items-center justify-between gap-3 px-1 text-xs text-muted">
        <span className="truncate">{original !== FOLDER_PLACEHOLDER && <>Original name: <span className="font-semibold text-fg/80">{original}</span></>}</span>
        {alias && (
          <button type="button" className="shrink-0 font-bold text-accent-strong hover:underline" onClick={() => void commit('')}>
            Reset to original
          </button>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void commit(value)}>
          Save
        </Button>
      </div>
    </Modal>
  )
}
