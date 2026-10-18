/**
 * DownloadNotice — bottom-right card after a download completes, with a
 * "Show" button that reveals the file in Explorer/Finder (Figma #23).
 *
 * @example <DownloadNotice /> // once, at the app root
 */
import { api } from '../../services/client'
import { useToastStore } from '../../stores/toast-store'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { IconButton } from '../../components/ui/IconButton'

export function DownloadNotice() {
  const notice = useToastStore((s) => s.downloadNotice)
  const hide = useToastStore((s) => s.hideDownloadNotice)
  if (!notice) return null
  return (
    <div key={notice.id} className="glass fixed bottom-6 right-6 z-[1100] flex w-[360px] items-center gap-3 rounded-2xl p-3.5 shadow-menu animate-slide-up" role="status">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
        <Icon name="arrow-down" className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">{notice.title}</div>
        <div className="truncate text-xs text-muted">{notice.subtitle}</div>
      </div>
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          if (notice.path) void api().files.reveal(notice.path)
          else void api().files.openDownloads()
          hide()
        }}
      >
        Show
      </Button>
      <IconButton icon="close" label="Dismiss" size="sm" onClick={hide} />
    </div>
  )
}
