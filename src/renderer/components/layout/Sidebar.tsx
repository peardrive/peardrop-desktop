/**
 * Sidebar — PearDrop Figma "Full sidebar" (160px) and "Collapsed sidebar"
 * (65px, one icon column).
 *
 *   [▣ toggle]
 *   [↑ Send] [↓ Receive]
 *   Lists: All · Shares · Received · Favorites   (active one tinted + count)
 *   …
 *   [network status card]                        (NetworkPanel)
 *   [⚙ Settings]
 *
 * The user folds it with the toggle (remembered in preferences); on a
 * window narrower than SIDEBAR_FOLD_WIDTH it is always folded and the
 * toggle is hidden.
 *
 * @example <Sidebar collapsed={false} canToggle />
 */
import type { ReactNode } from 'react'
import { openSend } from '../../controllers/share'
import { useTabCounts } from '../../hooks/useDrives'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore, type ListTab } from '../../stores/ui-store'
import { VIcon, type VIconName } from '../ui/VIcon'
import { NetworkPanel } from './NetworkPanel'
import { MacWindowControls, useWindowFrame } from './WindowControls'

const LISTS: Array<{ tab: ListTab; label: string; icon: VIconName }> = [
  { tab: 'all', label: 'All', icon: 'directbox-notif' },
  { tab: 'shares', label: 'Shares', icon: 'directbox-send' },
  { tab: 'received', label: 'Received', icon: 'directbox-receive' },
  { tab: 'favorites', label: 'Favorites', icon: 'star' }
]

export interface SidebarProps {
  collapsed: boolean
  /** False when the window is too narrow to unfold it. */
  canToggle: boolean
}

function SideButton({
  collapsed,
  label,
  onClick,
  className,
  children,
  active
}: {
  collapsed: boolean
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center rounded-lg py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        collapsed ? 'justify-center' : 'px-2',
        className
      )}
    >
      {children}
    </button>
  )
}

export function Sidebar({ collapsed, canToggle }: SidebarProps) {
  const tab = useUiStore((s) => s.tab)
  const page = useUiStore((s) => s.page)
  const setTab = useUiStore((s) => s.setTab)
  const setPage = useUiStore((s) => s.setPage)
  const openModal = useUiStore((s) => s.openModal)
  const update = useSettingsStore((s) => s.updatePreferences)
  const counts = useTabCounts()
  const frame = useWindowFrame()

  const showList = (t: ListTab) => {
    setTab(t)
    setPage('main')
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col justify-between gap-3 border-r-2 border-[rgb(var(--pd-panel)/0.6)] bg-gradient-to-b from-panel to-canvas px-3 transition-[width] duration-200',
        // Folded: 65px (Figma); 76px with the Mac traffic lights so their 52px row keeps 12px margins.
        collapsed ? cn('py-3', frame === 'mac' ? 'w-[76px]' : 'w-[65px]') : 'w-[160px] py-5'
      )}
    >
      <div className={cn('flex min-h-0 flex-col', collapsed ? 'items-center gap-3' : 'items-end gap-4')}>
        {/* Title-bar row: window controls + sidebar toggle; the empty space drags the window. */}
        <div
          className={cn(
            'drag-region -mx-3 flex w-[calc(100%+24px)]',
            // Folded: the traffic lights keep their row (never a column), centred in the sidebar.
            collapsed ? '-mt-3 flex-col items-center gap-3 px-0 pt-3' : '-mt-5 items-center justify-between gap-2 px-3 pt-5'
          )}
        >
          {frame === 'mac' ? <MacWindowControls /> : !collapsed && <span aria-hidden />}
          {canToggle ? (
            <button
              type="button"
              onClick={() => void update({ layout: { sidebarCollapsed: !collapsed } })}
              title={collapsed ? 'Open sidebar' : 'Close sidebar'}
              aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
              className="no-drag flex items-center rounded-md text-fg/90 transition-colors hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <VIcon name="grid-4" size={20.832} />
            </button>
          ) : (
            !collapsed && <span className="h-[20.832px]" aria-hidden />
          )}
        </div>

        {/* Scrolls on a short window; the title-bar row above stays put (and unclipped). */}
        <div className={cn('flex min-h-0 w-full flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', collapsed ? 'items-center gap-3' : 'items-end gap-4')}>
          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              onClick={openSend}
              title="Send"
              aria-label={collapsed ? 'Send' : undefined}
              className={cn(
                'flex w-full items-center gap-1 overflow-hidden rounded-lg bg-accent px-3 py-1 text-[12px] font-semibold leading-5 text-accent-on transition-[filter] hover:brightness-110 active:brightness-95',
                collapsed && 'justify-center'
              )}
            >
              <VIcon name="arrow-up" size={16.666} />
              {!collapsed && 'Send'}
            </button>
            <button
              type="button"
              onClick={() => openModal({ type: 'receive' })}
              title="Receive"
              aria-label={collapsed ? 'Receive' : undefined}
              className={cn(
                'flex w-full items-center gap-1 overflow-hidden rounded-lg border border-accent px-3 py-1 text-[12px] font-semibold leading-5 text-accent backdrop-blur-[9px] transition-colors hover:bg-accent/10',
                collapsed && 'justify-center'
              )}
            >
              <VIcon name="arrow-down" size={16.666} />
              {!collapsed && 'Receive'}
            </button>
          </div>

          <nav aria-label="Lists" className="flex w-full flex-col justify-center gap-3">
            {collapsed ? (
              <div className="h-px w-full bg-fg/20" aria-hidden />
            ) : (
              <div className="px-2 text-[13px] font-semibold leading-[21px] text-muted">Lists</div>
            )}
            <div className="flex w-full flex-col gap-2">
              {LISTS.map((l) => {
                const active = page === 'main' && tab === l.tab
                return (
                  <SideButton
                    key={l.tab}
                    collapsed={collapsed}
                    label={l.label}
                    active={active}
                    onClick={() => showList(l.tab)}
                    className={cn(active ? 'bg-[var(--pd-tab-active)]' : 'hover:bg-fg/[0.06]', !collapsed && 'justify-between')}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <VIcon name={l.icon} size={20} className={active ? 'text-accent' : 'text-fg'} />
                      {!collapsed && <span className="truncate text-[11px] font-semibold leading-[21px] text-fg">{l.label}</span>}
                    </span>
                    {!collapsed && active && <span className="tabular text-[11px] font-semibold leading-[21px] text-accent">{counts[l.tab]}</span>}
                  </SideButton>
                )
              })}
            </div>
          </nav>
        </div>
      </div>

      <div className="flex w-full flex-col gap-3">
        <NetworkPanel collapsed={collapsed} />
        <SideButton
          collapsed={collapsed}
          label="Settings"
          active={page === 'settings'}
          onClick={() => setPage(page === 'settings' ? 'main' : 'settings')}
          className={cn('h-10 py-2', page === 'settings' ? 'text-accent' : 'text-fg hover:text-accent', !collapsed && 'px-0')}
        >
          <span className="flex items-center gap-2">
            <VIcon name="setting-2" size={20.832} />
            {!collapsed && <span className="text-[11px] font-semibold leading-5 text-fg">Settings</span>}
          </span>
        </SideButton>
      </div>
    </aside>
  )
}
