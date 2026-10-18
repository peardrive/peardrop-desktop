/**
 * ShareLinkModal — Figma #15: the QR code and peardrop:// link of a share,
 * with Copy Link and Done. Shown after a share is built and from "Show QR".
 *
 * @example openModal({ type: 'share-link', link, title: 'holiday.mp4' })
 */
import { useCopy } from '../../hooks/useCopy'
import { useQrCode } from '../../hooks/useQrCode'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'

export function ShareLinkModal({ link, title, onClose, isTop }: { link: string; title?: string; onClose: () => void; isTop: boolean }) {
  const qr = useQrCode(link)
  const { copied, copy } = useCopy()
  return (
    <Modal title="Share link" size="compact" onClose={onClose} isTop={isTop}>
      {title && <p className="-mt-1 truncate text-sm text-muted">{title}</p>}
      <div className="mx-auto mt-5 flex h-[220px] w-[220px] items-center justify-center rounded-2xl bg-white p-3 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        {qr ? <img src={qr} alt="QR code for the share link" className="h-full w-full [image-rendering:pixelated]" /> : <Spinner className="h-6 w-6 text-black/40" />}
      </div>
      <p className="mt-3 text-center text-xs text-muted">Scan with PearDrop on another device</p>
      <div className="mt-4 select-text break-all rounded-xl border-2 border-line bg-field px-4 py-3 font-mono text-[12.5px] leading-relaxed text-fg/90">{link}</div>
      <div className="mt-5 flex gap-3">
        <Button variant="primary" className="flex-1" onClick={() => void copy(link)}>
          {copied ? 'Copied!' : 'Copy Link'}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
