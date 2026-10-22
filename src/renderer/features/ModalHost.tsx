/**
 * ModalHost — renders the modal stack from the UI store. Each entry maps
 * to one feature component; only the top-most one reacts to Escape.
 *
 * @example <ModalHost /> // once, at the app root
 */
import { useUiStore } from '../stores/ui-store'
import { ConfirmDialog } from './confirm/ConfirmDialog'
import { FolderModal } from './folder/FolderModal'
import { FileInfoModal } from './info/FileInfoModal'
import { QrScannerModal } from './receive/QrScannerModal'
import { ReceiveModal } from './receive/ReceiveModal'
import { RenameModal } from './rename/RenameModal'
import { SendModal } from './send/SendModal'
import { ShareLinkModal } from './share-link/ShareLinkModal'

export function ModalHost() {
  const modals = useUiStore((s) => s.modals)
  const closeModal = useUiStore((s) => s.closeModal)
  return (
    <>
      {modals.map((m, i) => {
        const isTop = i === modals.length - 1
        const onClose = () => closeModal(m.key)
        switch (m.type) {
          case 'send':
            return <SendModal key={m.key} onClose={onClose} isTop={isTop} />
          case 'receive':
            return <ReceiveModal key={m.key} onClose={onClose} isTop={isTop} />
          case 'qr-scanner':
            return <QrScannerModal key={m.key} onResult={m.onResult} onClose={onClose} isTop={isTop} />
          case 'share-link':
            return <ShareLinkModal key={m.key} link={m.link} title={m.title} onClose={onClose} isTop={isTop} />
          case 'info':
            return <FileInfoModal key={m.key} driveId={m.driveId} onClose={onClose} isTop={isTop} />
          case 'folder':
            return <FolderModal key={m.key} driveId={m.driveId} onClose={onClose} isTop={isTop} />
          case 'rename':
            return <RenameModal key={m.key} driveId={m.driveId} onClose={onClose} isTop={isTop} />
          case 'confirm':
            return <ConfirmDialog key={m.key} spec={m} onClose={onClose} isTop={isTop} />
          default:
            return null
        }
      })}
    </>
  )
}
