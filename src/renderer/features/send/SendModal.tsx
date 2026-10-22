/**
 * SendModal — Figma #14. Three states in one dialog:
 *   A  nothing staged   → Add Files hero + Recent Shares
 *   B  files staged     → staged list + Share button
 *   C  builds running   → ShareProgressPanel (unless backgrounded)
 * Closing while builds run hands them to the bottom-right pill.
 *
 * @example openModal({ type: 'send' })
 */
import { useShareJobsStore } from '../../stores/share-jobs-store'
import { useStagedFilesStore } from '../../stores/staged-files-store'
import { Modal } from '../../components/ui/Modal'
import { AddFilesCard } from './AddFilesCard'
import { RecentShares } from './RecentShares'
import { ShareProgressPanel } from './ShareProgressPanel'
import { StagedFileList } from './StagedFileList'

export function SendModal({ onClose, isTop }: { onClose: () => void; isTop: boolean }) {
  const staged = useStagedFilesStore((s) => s.files.length)
  const jobs = useShareJobsStore((s) => s.jobs.length)
  const backgrounded = useShareJobsStore((s) => s.backgrounded)
  const settled = useShareJobsStore((s) => s.settled)
  const showProgress = jobs > 0 && !backgrounded

  const close = () => {
    // Dismissing a finished batch is the same as pressing Done.
    if (settled) useShareJobsStore.getState().reset()
    onClose()
  }

  return (
    <Modal title="Share" onClose={close} isTop={isTop}>
      {showProgress ? (
        <ShareProgressPanel onClose={onClose} />
      ) : staged > 0 ? (
        <>
          <AddFilesCard compact />
          <StagedFileList />
        </>
      ) : (
        <>
          <div className="pt-2">
            <AddFilesCard />
          </div>
          <RecentShares />
        </>
      )}
    </Modal>
  )
}
