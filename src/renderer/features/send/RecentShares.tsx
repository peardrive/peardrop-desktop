/**
 * RecentShares — up to four most recent SHARES (never downloads) in a
 * 2×2 grid inside the Send modal, each with a quick "Link" copy button.
 *
 * @example <RecentShares />
 */
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { copyText } from '../../controllers/drive-actions'
import { displayTitle, isGroup, sourceName, statusPresentation } from '../../lib/drive-model'
import { CATEGORY_LABEL, categoryOf } from '../../lib/file-types'
import { useDrivesStore } from '../../stores/drives-store'
import { useMetaStore } from '../../stores/meta-store'
import { DriveThumb } from '../../components/drives/DriveThumb'
import { Button } from '../../components/ui/Button'
import { StatusText } from '../../components/ui/StatusText'

export function RecentShares() {
  const { drives, order } = useDrivesStore(useShallow((s) => ({ drives: s.drives, order: s.order })))
  const aliases = useMetaStore((s) => s.aliases)
  const recent = useMemo(
    () =>
      order
        .map((id) => drives[id])
        .filter((d) => d && d.kind === 'share' && !d.isPlaceholder)
        .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
        .slice(0, 4),
    [drives, order]
  )
  return (
    <section className="mt-5 border-t-2 border-fg/10 pt-4">
      <h3 className="mb-2 text-[12px] font-bold">Recent Shares</h3>
      {recent.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-muted">No shares yet</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          {recent.map((d) => {
            const title = displayTitle(d, aliases)
            const { label, tone } = statusPresentation(d)
            return (
              <div key={d.id} className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2">
                <DriveThumb drive={d} title={title} size={32} className="rounded-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold">{title}</div>
                  <div className="truncate text-[11px] text-muted">
                    {isGroup(d) ? 'Folder' : CATEGORY_LABEL[categoryOf(sourceName(d))]} · <StatusText tone={tone}>{label}</StatusText>
                  </div>
                </div>
                <Button size="xs" variant="outline" disabled={!d.shareLink} onClick={() => void copyText(d.shareLink!)}>
                  Link
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
