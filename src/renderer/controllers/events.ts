/**
 * Applies backend events to the stores. This is the only place engine
 * events touch UI state, so each rule lives exactly once.
 */
import type { TransferEvent } from '@shared/transfer'
import { formatBytes } from '../lib/format'
import { drivesStore } from '../stores/drives-store'
import { jobsStore } from '../stores/share-jobs-store'
import { toast, useToastStore } from '../stores/toast-store'
import { useMetaStore } from '../stores/meta-store'
import { applySnapshot, clearInitiatingWatchdog, markAnnounced, upsertRecord } from './library'
import { runDownload, userStarted } from './receive'
import { isQueueOwned } from '../stores/receive-store'
import { statusForResumeError } from '../lib/drive-model'

const failureToasted = new Set<string>()

export function handleTransferEvent(e: TransferEvent): void {
  const s = drivesStore()
  switch (e.type) {
    case 'library-loaded':
      applySnapshot(e.snapshot)
      return

    case 'peer-connected': {
      s.recordPeer(e.driveId, e.publicKey || e.peerId || null, true, e.at ?? Date.now())
      const d = s.drives[e.driveId]
      if (d) s.patch(e.driveId, { peers: d.peers + 1 })
      return
    }
    case 'peer-disconnected': {
      s.recordPeer(e.driveId, e.publicKey || e.peerId || null, false, e.at ?? Date.now())
      const d = s.drives[e.driveId]
      if (!d) return
      const peers = Math.max(0, d.peers - 1)
      // A peer leaving mid-transfer never sends 'complete': stop showing a speed.
      s.patch(e.driveId, { peers, ...(peers === 0 ? { speed: 0 } : {}) })
      return
    }

    case 'transfer-progress': {
      if (!s.drives[e.driveId] || s.cancelling.has(e.driveId)) return
      if (e.peerId === 'self') {
        s.patch(e.driveId, {
          status: 'downloading',
          progress: e.percent >= 0 ? e.percent / 100 : s.drives[e.driveId].progress,
          speed: e.speed,
          ...(e.totalBytes ? { size: e.totalBytes } : {})
        })
      } else {
        // A peer pulling bytes proves reachability better than any announce.
        markAnnounced(e.driveId)
        s.patch(e.driveId, { status: 'sharing', speed: e.speed })
      }
      return
    }
    case 'transfer-complete':
      // Ours is handled by files-downloaded; a peer finishing leaves us "Active".
      if (e.peerId !== 'self' && s.drives[e.driveId]) s.patch(e.driveId, { status: 'sharing', speed: 0 })
      return

    case 'share-started': {
      if (!e.clientJobId) return // not ours (CLI, another window)
      jobsStore().attachDrive(e.clientJobId, e.driveId, { bytesTotal: e.bytesTotal, filesTotal: e.filesTotal })
      return
    }
    case 'share-progress':
      jobsStore().progress(e.driveId, e)
      return

    case 'files-downloaded': {
      const d = s.drives[e.driveId]
      if (d) s.patch(e.driveId, { status: e.isSeeding ? 'sharing' : 'complete', progress: 1, speed: 0 })
      if (e.partial) toast.error(`Finished with ${e.failedCount} file${e.failedCount !== 1 ? 's' : ''} missing`)
      const first = e.files[0]
      const title = e.files.length > 1 ? `${e.files.length} files saved` : `${first?.name ?? 'File'} saved`
      useToastStore.getState().showDownloadNotice({
        title: 'Download complete',
        subtitle: `${title} · ${formatBytes(e.files.reduce((n, f) => n + (f.size || 0), 0))}`,
        path: first?.path ?? null
      })
      return
    }

    case 'download-peer-disconnected': {
      const d = s.drives[e.driveId]
      if (!d || s.cancelling.has(e.driveId)) return
      if (d.status === 'downloading' || d.status === 'connecting') s.patch(e.driveId, { status: 'interrupted', speed: 0 })
      return
    }

    case 'drive-ready-to-download': {
      // Continue only what the user asked for: resumed this session, or a
      // link still in the receive queue (main starts that download itself).
      // Any other drive resumed at boot parks as "Disconnected" and waits.
      const owned = isQueueOwned(e.driveId)
      const asked = owned || userStarted.has(e.driveId)
      s.patch(e.driveId, { status: asked ? 'downloading' : 'interrupted', ...(e.shareName ? { name: e.shareName } : {}) })
      if (asked && !owned) void runDownload(e.driveId)
      return
    }

    case 'download-failed': {
      const d = s.drives[e.driveId]
      if (!d || s.cancelling.has(e.driveId)) return
      s.patch(e.driveId, { status: e.willRetry ? 'connecting' : 'error', speed: 0 })
      // Background retries can fail repeatedly; say it once per drive.
      if (!failureToasted.has(e.driveId)) {
        failureToasted.add(e.driveId)
        toast.error(e.willRetry ? `${e.error} — PearDrop will keep trying` : e.error)
      }
      return
    }

    case 'drive-resume-failed': {
      const d = s.drives[e.driveId]
      if (!d) return
      clearInitiatingWatchdog(e.driveId)
      s.patch(e.driveId, { status: statusForResumeError(e.error, d.kind), speed: 0 })
      return
    }

    case 'drive-announced':
      markAnnounced(e.driveId)
      return
    case 'drive-announce-failed': {
      s.setAnnounced(e.driveId, false)
      clearInitiatingWatchdog(e.driveId)
      const st = s.drives[e.driveId]?.status
      if (st === 'initiating' || st === 'sharing') s.patch(e.driveId, { status: 'unreachable' })
      return
    }

    case 'drive-added':
      upsertRecord(e.record)
      return
    case 'drive-removed':
      s.remove(e.driveId)
      // Its alias and star go with it, so a reused id never inherits them.
      void useMetaStore.getState().forget(e.driveId)
      return
  }
}
