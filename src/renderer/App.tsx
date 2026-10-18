/**
 * App — root component: theme, shell, modal stack and global overlays.
 */
import { AppShell } from './components/layout/AppShell'
import { ModalHost } from './features/ModalHost'
import { DownloadNotice } from './features/feedback/DownloadNotice'
import { SharePill } from './features/feedback/SharePill'
import { Toaster } from './features/feedback/Toaster'
import { WindowDropZone } from './features/feedback/WindowDropZone'
import { ThemeProvider } from './theme/ThemeProvider'

export function App() {
  return (
    <ThemeProvider>
      <AppShell />
      <ModalHost />
      <WindowDropZone />
      <SharePill />
      <DownloadNotice />
      <Toaster />
    </ThemeProvider>
  )
}
