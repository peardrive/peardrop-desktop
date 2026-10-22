/**
 * DriveRevealButton — the folder icon on a drive card or row: shows the
 * drive's file in Explorer / Finder. Same action as "Show in Folder" in the
 * ⋮ menu, and shown under the same condition: only once the drive has a
 * file on this machine.
 *
 * @example <DriveRevealButton drive={d} disabled={busy} />
 */
import { runMenuAction } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'
import { IconButton } from '../ui/IconButton'

export interface DriveRevealButtonProps {
  drive: DriveItemModel
  disabled?: boolean
}

export function DriveRevealButton({ drive, disabled }: DriveRevealButtonProps) {
  const hasLocalFile = !drive.isPlaceholder && drive.files.some((f) => f.path)
  if (!hasLocalFile) {
    return null
  }

  return (
    <IconButton
      icon="folder-outline"
      label="Show in Folder"
      size="sm"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        void runMenuAction('show-in-folder', drive)
      }}
    />
  )
}
