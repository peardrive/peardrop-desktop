/**
 * AppShell — window frame (PearDrop Figma, 2026): the sidebar on the left,
 * and on the right either the list section (header + rounded list container
 * with search) or a full-page route (Settings, Report a bug).
 *
 * The sidebar folds to an icon column when the user asks for it, and always
 * on a narrow window (the smallest window size). On Windows a theme-coloured
 * title bar strip sits on top for the native caption buttons.
 *
 * @example <AppShell />
 */
import { lazy, Suspense } from 'react'
import { useNarrowWindow } from '../../hooks/useViewport'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore } from '../../stores/ui-store'
import { SearchField } from '../ui/SearchField'
import { LibraryView } from './LibraryView'
import { ListToolbar } from './ListToolbar'
import { Sidebar } from './Sidebar'
import { useWindowFrame, WindowsTitleBar } from './WindowControls'

const SettingsPage = lazy(() => import('../../features/settings/SettingsPage'))
const ReportBugPage = lazy(() => import('../../features/report-bug/ReportBugPage'))

function ListSection({ compact }: { compact: boolean }) {
  const search = useUiStore((s) => s.search)
  const setSearch = useUiStore((s) => s.setSearch)
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4">
      <ListToolbar compact={compact} />
      <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-gradient-to-b from-panel from-[10.65%] to-canvas p-4">
        <SearchField value={search} onChange={setSearch} />
        <div className="scroll-thin -mr-3 mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto pr-3">
          <LibraryView />
        </div>
      </div>
    </section>
  )
}

export function AppShell() {
  const page = useUiStore((s) => s.page)
  const userCollapsed = useSettingsStore((s) => s.preferences.layout.sidebarCollapsed)
  const narrow = useNarrowWindow()
  const collapsed = narrow || userCollapsed
  const frame = useWindowFrame()

  return (
    <div className="flex h-full flex-col overflow-hidden bg-canvas">
      {frame === 'windows' && <WindowsTitleBar />}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} canToggle={!narrow} />
        {page === 'main' ? (
          <ListSection compact={narrow} />
        ) : (
          <Suspense fallback={null}>
            <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">{page === 'settings' ? <SettingsPage /> : <ReportBugPage />}</div>
          </Suspense>
        )}
      </div>
    </div>
  )
}
