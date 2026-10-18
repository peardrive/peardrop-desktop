/**
 * AppShell — window frame: top bar, the rounded content panel, and the
 * full-page routes (Settings, Report a bug) that replace it.
 *
 * @example <AppShell />
 */
import { lazy, Suspense } from 'react'
import { useUiStore } from '../../stores/ui-store'
import { LibraryView } from './LibraryView'
import { ListToolbar } from './ListToolbar'
import { TopBar } from './TopBar'

const SettingsPage = lazy(() => import('../../features/settings/SettingsPage'))
const ReportBugPage = lazy(() => import('../../features/report-bug/ReportBugPage'))

export function AppShell() {
  const page = useUiStore((s) => s.page)
  if (page !== 'main') {
    return (
      <Suspense fallback={null}>
        <div className="h-full overflow-y-auto bg-panel">{page === 'settings' ? <SettingsPage /> : <ReportBugPage />}</div>
      </Suspense>
    )
  }
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="mx-4 mb-4 flex min-h-0 flex-1 flex-col rounded-[18px] rounded-tl-none bg-panel">
        <ListToolbar />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <LibraryView />
        </div>
      </main>
    </div>
  )
}
