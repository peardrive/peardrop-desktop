/**
 * TopBar — Shares/Favorites tabs on the left (attached to the panel below),
 * Send · Receive · Settings on the right. On macOS it doubles as the
 * window drag region (hidden-inset title bar).
 *
 * @example <TopBar />
 */
import { openSend } from '../../controllers/share'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore, type ListTab } from '../../stores/ui-store'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { SegmentedControl } from '../ui/SegmentedControl'

export function TopBar() {
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  const openModal = useUiStore((s) => s.openModal)
  const setPage = useUiStore((s) => s.setPage)
  const isMac = useSettingsStore((s) => s.appInfo?.platform === 'darwin')

  return (
    <header className={cn('drag-region flex items-end justify-between gap-4 px-4', isMac ? 'pt-9' : 'pt-4')}>
      <SegmentedControl<ListTab>
        variant="tabs"
        ariaLabel="Library"
        value={tab}
        onChange={setTab}
        className="no-drag"
        options={[
          { value: 'shares', label: 'Shares' },
          { value: 'favorites', label: 'Favorites' }
        ]}
      />
      <div className="no-drag flex items-center gap-3 pb-2">
        <Button variant="soft" leading={<Icon name="arrow-up" className="h-4 w-4" />} onClick={openSend}>
          Send
        </Button>
        <Button variant="soft" leading={<Icon name="arrow-down" className="h-4 w-4" />} onClick={() => openModal({ type: 'receive' })}>
          Receive
        </Button>
        <IconButton icon="gear" label="Settings" tone="solid" onClick={() => setPage('settings')} iconClassName="h-5 w-5" />
      </div>
    </header>
  )
}
