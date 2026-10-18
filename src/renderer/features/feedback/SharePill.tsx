/**
 * SharePill — bottom-right progress pill for share builds running while
 * the Send modal is closed or backgrounded. Click to return to the modal.
 *
 * @example <SharePill /> // once, at the app root
 */
import { jobTotals, useShareJobsStore } from '../../stores/share-jobs-store'
import { useUiStore } from '../../stores/ui-store'
import { Spinner } from '../../components/ui/Spinner'

export function SharePill() {
  const jobs = useShareJobsStore((s) => s.jobs)
  const backgrounded = useShareJobsStore((s) => s.backgrounded)
  const setBackgrounded = useShareJobsStore((s) => s.setBackgrounded)
  const sendOpen = useUiStore((s) => s.modals.some((m) => m.type === 'send'))
  const building = jobs.filter((j) => j.state === 'building')
  if (!building.length || (sendOpen && !backgrounded)) return null
  const { percent } = jobTotals(jobs)
  return (
    <button
      type="button"
      onClick={() => {
        setBackgrounded(false)
        if (!useUiStore.getState().isOpen('send')) useUiStore.getState().openModal({ type: 'send' })
      }}
      className="glass fixed bottom-6 right-6 z-[1050] flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-bold shadow-menu animate-slide-up hover:brightness-110"
    >
      <Spinner className="h-4 w-4 text-accent" />
      <span>Sharing</span>
      <span className="tabular text-accent-strong">{building.length > 1 ? `${building.length} shares · ${percent}%` : `${percent}%`}</span>
    </button>
  )
}
