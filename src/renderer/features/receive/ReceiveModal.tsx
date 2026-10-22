/**
 * ReceiveModal — Figma #17. Paste a link (live validation + duplicate
 * check before anything is committed), scan a QR with the camera, or
 * import a QR image.
 *
 * The field's button changes with what is in it:
 *   empty → Paste · valid link → Download · already have it → Show in list ·
 *   garbage → Clear. Enter always submits.
 *
 * @example openModal({ type: 'receive' })
 */
import { useEffect, useRef, useState } from 'react'
import { describeInvalidLink, extractShareLink } from '@shared/links'
import { highlightDrive, startDownload } from '../../controllers/receive'
import { cn } from '../../lib/cn'
import { pickAndDecodeQr } from '../../lib/qr-decode'
import { api } from '../../services/client'
import { toast } from '../../stores/toast-store'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Modal } from '../../components/ui/Modal'
import { TextField } from '../../components/ui/TextField'

type FieldState =
  | { kind: 'empty' }
  | { kind: 'valid'; link: string }
  | { kind: 'existing'; link: string; driveId: string; message: string }
  | { kind: 'invalid'; message: string }

function evaluate(raw: string): FieldState {
  if (!raw.trim()) return { kind: 'empty' }
  const link = extractShareLink(raw)
  return link ? { kind: 'valid', link } : { kind: 'invalid', message: describeInvalidLink(raw) }
}

export function ReceiveModal({ onClose, isTop }: { onClose: () => void; isTop: boolean }) {
  const [value, setValue] = useState('')
  const [state, setState] = useState<FieldState>({ kind: 'empty' })
  const inputRef = useRef<HTMLInputElement>(null)
  const checkToken = useRef(0)

  // Validate on every edit; check for duplicates (own share / already
  // downloaded) shortly after a valid link appears.
  useEffect(() => {
    const next = evaluate(value)
    setState(next)
    const token = ++checkToken.current
    if (next.kind !== 'valid') return
    const t = setTimeout(async () => {
      try {
        const res = await api().transfers.checkLink(next.link)
        if (token !== checkToken.current || !res.isDuplicate) return
        setState({
          kind: 'existing',
          link: next.link,
          driveId: res.driveId,
          message: res.existing.isUpload
            ? 'This is your own share — it is already in your list'
            : res.localStatus === 'missing'
              ? 'Already in your list, but its files were removed'
              : 'You have already downloaded this'
        })
      } catch {
        /* check unavailable — download path re-checks anyway */
      }
    }, 200)
    return () => clearTimeout(t)
  }, [value])

  const download = (link: string) => {
    onClose()
    void startDownload(link)
  }

  const submit = () => {
    if (state.kind === 'valid') download(state.link)
    else if (state.kind === 'existing') {
      onClose()
      highlightDrive(state.driveId)
    } else inputRef.current?.focus()
  }

  const onButton = async () => {
    if (state.kind === 'valid' || state.kind === 'existing') return submit()
    if (state.kind === 'invalid') {
      setValue('')
      return inputRef.current?.focus()
    }
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text) return toast.error('Clipboard is empty')
      setValue(text)
      inputRef.current?.focus()
    } catch {
      toast.error('Could not read the clipboard')
    }
  }

  const fromQr = (text: string | null, source: string) => {
    const link = extractShareLink(text)
    if (!link) return toast.error(text ? `That ${source} is not a PearDrop link` : `No QR code found in that ${source}`)
    download(link)
  }

  const label = { empty: 'Paste', valid: 'Download', existing: 'Show in list', invalid: 'Clear' }[state.kind]
  const hint =
    state.kind === 'valid'
      ? { text: 'Press Enter to download — if the sender is offline, PearDrop keeps trying', cls: 'text-success' }
      : state.kind === 'existing'
        ? { text: state.message, cls: 'text-warning' }
        : state.kind === 'invalid'
          ? { text: state.message, cls: 'text-danger' }
          : null

  return (
    <Modal title="Receive" onClose={onClose} isTop={isTop}>
      <div className="pt-3">
        <TextField
          ref={inputRef}
          autoFocus
          value={value}
          placeholder="Paste link here"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          state={state.kind === 'valid' ? 'valid' : state.kind === 'invalid' ? 'invalid' : state.kind === 'existing' ? 'warning' : 'default'}
          containerClassName="h-10 pr-2"
          className="text-[13px]"
          trailing={
            <Button
              size="sm"
              variant={state.kind === 'valid' ? 'primary' : state.kind === 'invalid' ? 'danger-outline' : 'soft'}
              onClick={() => void onButton()}
            >
              {label}
            </Button>
          }
        />
        <div className={cn('mt-2 h-5 px-4 text-[12px] font-semibold', hint?.cls)} aria-live="polite">
          {hint?.text}
        </div>
      </div>

      <div className="my-4 flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-subtle">
        <span className="h-px flex-1 bg-fg/10" /> or <span className="h-px flex-1 bg-fg/10" />
      </div>

      <button
        type="button"
        onClick={() => useUiStore.getState().openModal({ type: 'qr-scanner', onResult: (t) => fromQr(t, 'QR code') })}
        className="group flex min-h-[180px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-fg/15 bg-fg/[0.03] text-muted transition-colors hover:border-accent/50 hover:bg-accent/[0.06] hover:text-fg"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-fg/10 transition-colors group-hover:bg-accent/15 group-hover:text-accent-strong">
          <Icon name="qr" className="h-8 w-8" />
        </span>
        <span className="text-[13px] font-bold text-fg">QR Code Scan</span>
        <span className="text-[12px]">Use your camera to scan a PearDrop QR code</span>
      </button>

      <Button
        variant="ghost"
        className="mx-auto mt-3"
        leading={<Icon name="image" />}
        onClick={async () => {
          const { text, cancelled } = await pickAndDecodeQr()
          if (!cancelled) fromQr(text, 'image')
        }}
      >
        Import QR code image
      </Button>
    </Modal>
  )
}
