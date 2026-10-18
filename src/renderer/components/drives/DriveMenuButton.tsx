/**
 * DriveMenuButton — the ⋮ button and its menu for one drive (also opened by
 * right-clicking the card, via the `menu` handle it receives).
 *
 * @example const menu = useMenu(); <DriveMenuButton drive={d} menu={menu} />
 */
import { menuItems } from '../../lib/drive-model'
import { runMenuAction } from '../../controllers/drive-actions'
import type { DriveItemModel } from '../../hooks/useDrives'
import { IconButton } from '../ui/IconButton'
import { Menu, type MenuEntry, type useMenu } from '../ui/Menu'

export interface DriveMenuButtonProps {
  drive: DriveItemModel
  menu: ReturnType<typeof useMenu>
}

export function DriveMenuButton({ drive, menu }: DriveMenuButtonProps) {
  const entries: MenuEntry[] = []
  for (const item of menuItems(drive, drive.favorite)) {
    if (item.divider) entries.push({ divider: true })
    entries.push({ label: item.label, danger: item.danger, onSelect: () => void runMenuAction(item.action, drive) })
  }
  return (
    <>
      <IconButton
        ref={menu.triggerRef}
        icon="more-vertical"
        label="More actions"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          menu.toggleFromTrigger()
        }}
      />
      <Menu {...menu.props} items={entries} />
    </>
  )
}
