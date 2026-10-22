/**
 * ShareJobRow — one build in a multi-share batch: name + bar + % + ✕ while
 * building; "Ready to share" + QR peek + Copy Link once done.
 *
 * @example <ShareJobRow job={job} />
 */
import { useState } from 'react'
import { cancelJob } from '../../controllers/share'
import { useCopy } from '../../hooks/useCopy'
import { useQrCode } from '../../hooks/useQrCode'
import { jobPercent, type ShareJob } from '../../stores/share-jobs-store'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { ProgressBar } from '../../components/ui/Progress'

export function ShareJobRow({ job }: { job: ShareJob }) {
  const { copied, copy } = useCopy()
  const [showQr, setShowQr] = useState(false)
  const qr = useQrCode(showQr ? job.shareLink : null)
  const pct = jobPercent(job)
  const done = job.state === 'done'
  return (
    <div className="relative flex items-center gap-3 rounded-xl bg-fg/[0.05] px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-bold">{job.name}</div>
        {done ? <div className="text-[11px] font-semibold text-success">Ready to share</div> : <ProgressBar value={pct / 100} className="mt-1.5" />}
      </div>
      {done ? (
        <>
          <div className="relative" onMouseEnter={() => setShowQr(true)} onMouseLeave={() => setShowQr(false)}>
            <IconButton icon="qr" label="Show QR code" tone="accent" size="sm" />
            {showQr && qr && (
              <img src={qr} alt="QR code" className="absolute bottom-10 right-0 z-10 h-28 w-28 rounded-xl bg-white p-1.5 shadow-menu" />
            )}
          </div>
          <Button size="xs" variant="primary" onClick={() => void copy(job.shareLink)}>
            {copied ? 'Copied!' : 'Copy Link'}
          </Button>
        </>
      ) : (
        <>
          <span className="tabular w-10 text-right text-[12px] font-bold text-muted">{pct}%</span>
          <IconButton icon="close" label="Cancel this share" tone="danger" size="sm" disabled={!job.driveId} onClick={() => void cancelJob(job.id)} />
        </>
      )}
    </div>
  )
}
