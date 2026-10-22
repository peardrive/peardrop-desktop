/**
 * ShareProgressPanel — Send modal state C while shares are being built:
 * a progress dial with live stats, a row per build when several run at
 * once (cancel each, or copy each link once ready), and the
 * "Continue in background" / Cancel / Close actions.
 *
 * @example <ShareProgressPanel onClose={close} />
 */
import { cancelAllJobs } from '../../controllers/share'
import { formatBytes, formatEta } from '../../lib/format'
import { jobTotals, useShareJobsStore } from '../../stores/share-jobs-store'
import { Button } from '../../components/ui/Button'
import { ProgressRing } from '../../components/ui/Progress'
import { ShareJobRow } from './ShareJobRow'

export function ShareProgressPanel({ onClose }: { onClose: () => void }) {
  const jobs = useShareJobsStore((s) => s.jobs)
  const settled = useShareJobsStore((s) => s.settled)
  const setBackgrounded = useShareJobsStore((s) => s.setBackgrounded)
  const reset = useShareJobsStore((s) => s.reset)
  const t = jobTotals(jobs)
  const building = jobs.filter((j) => j.state === 'building')
  const multi = jobs.length > 1

  const headline = settled ? 'Ready to share' : 'Preparing your files'
  const sub =
    building.length > 1
      ? `${building.length} shares building…`
      : building[0]
        ? building[0].currentFile || 'Starting…'
        : `${jobs.filter((j) => j.state === 'done').length} shares ready`

  const stats: Array<[string, string]> = [
    ...(t.filesTotal > 1 ? ([['Files', `${t.filesDone}/${t.filesTotal}`]] as Array<[string, string]>) : []),
    ['Size', t.bytesTotal > 0 ? `${formatBytes(t.bytesDone)} / ${formatBytes(t.bytesTotal)}` : formatBytes(t.bytesDone)],
    ['Time left', settled ? 'Finished!' : formatEta(t.bytesTotal - t.bytesDone, t.rate)]
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center pt-2">
      {!multi && (
        <ProgressRing percent={t.percent} size={104}>
          <span className="tabular text-[22px] font-bold">
            {t.percent}
            <span className="text-[14px] text-muted">%</span>
          </span>
        </ProgressRing>
      )}
      <h3 className="mt-4 text-[15px] font-bold">{headline}</h3>
      <p className="mt-1 max-w-full truncate text-[12px] text-muted">{sub}</p>

      {multi && (
        <div className="scroll-thin mt-4 w-full min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {jobs.map((j) => (
            <ShareJobRow key={j.id} job={j} />
          ))}
        </div>
      )}

      <div className="mt-5 flex w-full items-stretch justify-center divide-x-2 divide-fg/10 rounded-xl bg-fg/[0.05] py-3">
        {stats.map(([label, value]) => (
          <div key={label} className="flex-1 px-4 text-center">
            <div className="text-[11px] font-bold uppercase tracking-wider text-subtle">{label}</div>
            <div className="tabular mt-1 text-[12px] font-bold">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-auto flex w-full justify-center gap-3 pt-5">
        {settled ? (
          <Button
            variant="primary"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setBackgrounded(true)
                onClose()
              }}
            >
              Continue in background
            </Button>
            <Button variant="danger-outline" onClick={() => void cancelAllJobs()} disabled={!building.some((j) => j.driveId)}>
              {building.length > 1 ? 'Cancel all' : 'Cancel'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
