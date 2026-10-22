/**
 * Share builds in flight (Send modal "state C" and the background pill).
 *
 * One job per build. `begin()` mints a job id that is passed to the backend
 * as clientJobId; the `share-started` event hands it back with the real
 * driveId, after which `share-progress` events (keyed by driveId) route to
 * the right job. Several builds can run at once.
 */
import { create } from 'zustand'

export type JobState = 'building' | 'done' | 'failed'

export interface ShareJob {
  id: string
  driveId: string | null
  name: string
  state: JobState
  shareLink: string | null
  bytesTotal: number
  bytesDone: number
  filesTotal: number
  filesDone: number
  currentFile: string | null
  /** Smoothed bytes/second. */
  rate: number
  rateAnchor: { t: number; bytes: number } | null
}

interface JobsState {
  jobs: ShareJob[]
  /** User chose "Continue in background" — show the pill, not state C. */
  backgrounded: boolean
  /** All jobs of a multi-share batch finished; rows held for copying links. */
  settled: boolean
  begin(job: Pick<ShareJob, 'name' | 'bytesTotal' | 'filesTotal'>): string
  attachDrive(jobId: string, driveId: string, totals: { bytesTotal?: number; filesTotal?: number }): void
  progress(driveId: string, p: { bytesDone: number; filesDone: number; filesTotal?: number; bytesTotal?: number; currentFile?: string | null }): void
  finish(jobId: string, shareLink: string): void
  fail(jobId: string): void
  setBackgrounded(on: boolean): void
  reset(): void
}

let seq = 0

const RATE_WINDOW_MS = 700

export const useShareJobsStore = create<JobsState>((set, get) => {
  const update = (pred: (j: ShareJob) => boolean, fn: (j: ShareJob) => ShareJob) =>
    set({ jobs: get().jobs.map((j) => (pred(j) ? fn(j) : j)) })

  /** After a job ends: settle a multi-job batch, or clear a solo one. */
  const afterEnd = () => {
    const { jobs } = get()
    if (jobs.some((j) => j.state === 'building')) return
    const kept = jobs.filter((j) => j.state === 'done')
    if (jobs.length > 1 && kept.length > 0) set({ jobs: kept, settled: true, backgrounded: false })
    else set({ jobs: [], settled: false, backgrounded: false })
  }

  return {
    jobs: [],
    backgrounded: false,
    settled: false,
    begin(job) {
      const id = `job_${++seq}_${Date.now()}`
      // A new build after a settled batch starts a fresh batch.
      const base = get().settled ? [] : get().jobs
      set({
        settled: false,
        backgrounded: false,
        jobs: [
          ...base,
          { ...job, id, driveId: null, state: 'building', shareLink: null, bytesDone: 0, filesDone: 0, currentFile: null, rate: 0, rateAnchor: null }
        ]
      })
      return id
    },
    attachDrive(jobId, driveId, totals) {
      update(
        (j) => j.id === jobId,
        (j) => ({
          ...j,
          driveId,
          bytesTotal: j.bytesTotal || totals.bytesTotal || 0,
          filesTotal: totals.filesTotal || j.filesTotal
        })
      )
    },
    progress(driveId, p) {
      const now = Date.now()
      update(
        (j) => j.driveId === driveId && j.state === 'building',
        (j) => {
          let { rate, rateAnchor } = j
          if (!rateAnchor) rateAnchor = { t: now, bytes: p.bytesDone }
          else if (now - rateAnchor.t >= RATE_WINDOW_MS) {
            const inst = ((p.bytesDone - rateAnchor.bytes) * 1000) / (now - rateAnchor.t)
            rate = rate ? rate * 0.6 + inst * 0.4 : inst
            rateAnchor = { t: now, bytes: p.bytesDone }
          }
          return {
            ...j,
            bytesDone: p.bytesDone,
            filesDone: p.filesDone,
            // The engine's counts win: a dropped folder is one entry here but N files there.
            filesTotal: p.filesTotal || j.filesTotal,
            bytesTotal: j.bytesTotal || p.bytesTotal || 0,
            currentFile: p.currentFile ?? j.currentFile,
            rate,
            rateAnchor
          }
        }
      )
    },
    finish(jobId, shareLink) {
      update(
        (j) => j.id === jobId,
        (j) => ({ ...j, state: 'done', shareLink, bytesDone: j.bytesTotal || j.bytesDone, filesDone: j.filesTotal })
      )
      afterEnd()
    },
    fail(jobId) {
      set({ jobs: get().jobs.filter((j) => j.id !== jobId) })
      afterEnd()
    },
    setBackgrounded: (backgrounded) => set({ backgrounded }),
    reset: () => set({ jobs: [], settled: false, backgrounded: false })
  }
})

export const jobsStore = () => useShareJobsStore.getState()

/** Aggregate numbers for the dial / pill. */
export function jobTotals(jobs: ShareJob[]) {
  const t = jobs.reduce(
    (acc, j) => ({
      bytesTotal: acc.bytesTotal + j.bytesTotal,
      bytesDone: acc.bytesDone + j.bytesDone,
      filesTotal: acc.filesTotal + j.filesTotal,
      filesDone: acc.filesDone + j.filesDone,
      rate: acc.rate + (j.state === 'building' ? j.rate : 0)
    }),
    { bytesTotal: 0, bytesDone: 0, filesTotal: 0, filesDone: 0, rate: 0 }
  )
  const percent =
    t.bytesTotal > 0
      ? Math.min(100, Math.round((t.bytesDone / t.bytesTotal) * 100))
      : t.filesTotal > 0
        ? Math.min(100, Math.round((t.filesDone / t.filesTotal) * 100))
        : 0
  return { ...t, percent }
}

export function jobPercent(j: ShareJob): number {
  if (j.bytesTotal > 0) return Math.min(100, Math.round((j.bytesDone / j.bytesTotal) * 100))
  if (j.filesTotal > 0) return Math.min(100, Math.round((j.filesDone / j.filesTotal) * 100))
  return 0
}
