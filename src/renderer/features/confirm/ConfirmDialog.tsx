/**
 * ConfirmDialog — a small frosted dialog with a title, message, optional
 * checkbox (its state is handed to the chosen button) and buttons.
 * Opened through the modal stack: `openModal({ type: 'confirm', … })`.
 *
 * @example openModal({ type: 'confirm', title: 'Remove?', buttons: [{ label: 'Cancel' }, { label: 'Remove', variant: 'danger', onSelect }] })
 */
import { useState } from 'react'
import type { ModalSpec } from '../../stores/ui-store'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { Modal } from '../../components/ui/Modal'

type ConfirmSpec = Extract<ModalSpec, { type: 'confirm' }>

export function ConfirmDialog({ spec, onClose, isTop }: { spec: ConfirmSpec; onClose: () => void; isTop: boolean }) {
  const [checked, setChecked] = useState(!!spec.checkbox?.checked)
  return (
    <Modal size="narrow" onClose={onClose} isTop={isTop} hideClose bodyClassName="pt-6">
      <h2 className="text-lg font-bold">{spec.title}</h2>
      {spec.message && <p className="mt-2 break-words text-sm leading-relaxed text-muted">{spec.message}</p>}
      {spec.checkbox && <Checkbox className="mt-5" checked={checked} onChange={setChecked} label={spec.checkbox.label} hint={spec.checkbox.hint} />}
      <div className="mt-6 flex justify-end gap-3">
        {spec.buttons.map((b, i) => (
          <Button
            key={i}
            size="md"
            variant={b.variant ?? 'secondary'}
            autoFocus={i === spec.buttons.length - 1}
            onClick={() => {
              onClose()
              b.onSelect?.({ checked })
            }}
          >
            {b.label}
          </Button>
        ))}
      </div>
    </Modal>
  )
}
