/**
 * FileInfoModal — Figma #19 "Properties": details, share status, connected
 * peers (with keys), and Copy Link / QR in the footer.
 *
 * @example openModal({ type: 'info', driveId })
 */
import { isGroup, networkStatus } from '../../lib/drive-model'
import { formatBytes, formatDate, plural, timeAgo, truncateMiddle } from '../../lib/format'
import { useCopy } from '../../hooks/useCopy'
import { useDrive } from '../../hooks/useDrives'
import { useDrivesStore } from '../../stores/drives-store'
import { useUiStore } from '../../stores/ui-store'
import { DriveThumb } from '../../components/drives/DriveThumb'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Modal } from '../../components/ui/Modal'
import { InfoRow, InfoSection } from './InfoRows'

export function FileInfoModal({ driveId, onClose, isTop }: { driveId: string; onClose: () => void; isTop: boolean }) {
  const drive = useDrive(driveId)
  const ledger = useDrivesStore((s) => s.peers[driveId])
  const { copied, copy } = useCopy()
  if (!drive) return null

  const location = drive.files.find((f) => f.path)?.path ?? drive.localPath ?? null
  const activeKeys = ledger ? [...ledger.active.keys()] : []
  const pct = drive.progress != null && drive.progress < 1 ? Math.round(drive.progress * 100) : null
  const kind = drive.kind === 'download' ? 'Download' : 'Share'

  return (
    <Modal
      title="File Info"
      size="tall"
      onClose={onClose}
      isTop={isTop}
      footer={
        drive.shareLink ? (
          <>
            <Button variant="primary" block onClick={() => void copy(drive.shareLink)}>
              {copied ? 'Copied!' : 'Copy Link'}
            </Button>
            <IconButton
              icon="qr"
              label="Show QR code"
              tone="accent"
              ringed
              size="lg"
              onClick={() => {
                onClose()
                useUiStore.getState().openModal({ type: 'share-link', link: drive.shareLink!, title: drive.title })
              }}
            />
          </>
        ) : undefined
      }
    >
      <div className="flex items-center gap-4 pb-5 pt-2">
        <DriveThumb drive={drive} title={drive.title} size={52} className="rounded-[16px] bg-fg/[0.05]" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold" title={drive.title}>
            {drive.title}
          </div>
          <div className="text-[12px] text-muted">
            {kind} · {formatBytes(drive.size)} · {plural(drive.files.length || 1, 'file')}
          </div>
        </div>
      </div>

      <InfoSection title="Details" first>
        <InfoRow label="Size" value={formatBytes(drive.size)} />
        <InfoRow label="Type" value={isGroup(drive) ? `${kind} · folder` : kind} />
        <InfoRow label="Added" value={formatDate(drive.addedAt)} />
        <InfoRow label="Location" value={location ?? '—'} title={location ?? undefined} wrap />
      </InfoSection>

      {drive.shareLink && (
        <InfoSection title="Share info">
          <InfoRow label="Status" value={networkStatus(drive, activeKeys.length)} />
          {pct != null && <InfoRow label="Progress" value={`${pct}%`} />}
          <InfoRow label="Peers" value={String(activeKeys.length || drive.peers || 0)} />
          {activeKeys.length > 0 ? (
            activeKeys.map((k, i) => (
              <div key={k} className="space-y-2">
                <InfoRow label={activeKeys.length > 1 ? `Peer ${i + 1}` : 'Peer key'} value={truncateMiddle(k)} title={k} />
                <InfoRow label="Connected" value={timeAgo(ledger!.active.get(k))} />
              </div>
            ))
          ) : ledger?.lastKey ? (
            <>
              <InfoRow label="Last peer" value={truncateMiddle(ledger.lastKey)} title={ledger.lastKey} />
              <InfoRow label="Last seen" value={timeAgo(ledger.lastEndedAt ?? ledger.lastAt)} />
            </>
          ) : (
            <InfoRow label="Peer key" value={<span className="text-muted">None connected</span>} />
          )}
        </InfoSection>
      )}
    </Modal>
  )
}
