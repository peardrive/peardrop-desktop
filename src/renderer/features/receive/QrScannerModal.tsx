/**
 * QrScannerModal — camera QR scanner (sub-flow on top of Receive): live
 * video, a scan frame, camera picker when several exist, and "Select file
 * with QR". Stops the camera on every exit path.
 *
 * @example openModal({ type: 'qr-scanner', onResult: (text) => … })
 */
import { useEffect, useRef, useState } from 'react'
import { decodeImageData, loadQrDecoder, pickAndDecodeQr } from '../../lib/qr-decode'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Menu, useMenu } from '../../components/ui/Menu'
import { Modal } from '../../components/ui/Modal'

export function QrScannerModal({ onResult, onClose, isTop }: { onResult: (text: string | null) => void; onClose: () => void; isTop: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<string | null>('Starting camera…')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string | undefined>()
  const camMenu = useMenu()
  const done = useRef(false)

  const deliver = (text: string | null) => {
    if (done.current) return
    done.current = true
    onClose()
    onResult(text)
  }

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let alive = true
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const scan = () => {
      const v = videoRef.current
      if (!alive || !v || !ctx) return
      if (v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth
        canvas.height = v.videoHeight
        ctx.drawImage(v, 0, 0)
        const text = decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
        if (text) return deliver(text)
      }
      raf = requestAnimationFrame(scan)
    }

    ;(async () => {
      try {
        await loadQrDecoder()
        stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' } })
        if (!alive) return stream.getTracks().forEach((t) => t.stop())
        const v = videoRef.current
        if (v) {
          v.srcObject = stream
          await v.play().catch(() => undefined)
        }
        setStatus(null)
        const devices = await navigator.mediaDevices.enumerateDevices()
        if (alive) setCameras(devices.filter((d) => d.kind === 'videoinput'))
        raf = requestAnimationFrame(scan)
      } catch (err) {
        setStatus((err as Error).name === 'NotAllowedError' ? 'Camera access was denied' : 'No camera available')
      }
    })()

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId])

  const current = cameras.find((c) => c.deviceId === deviceId) ?? cameras[0]

  return (
    <Modal title="Scan a QR code" size="narrow" onClose={onClose} isTop={isTop}>
      <div className="relative mt-2 aspect-square w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-4 border-accent/80 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
        {status && <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/80">{status}</div>}
      </div>
      {cameras.length > 1 && (
        <>
          <Button ref={camMenu.triggerRef} variant="secondary" size="sm" className="mt-3 self-center" leading={<Icon name="camera" />} trailing={<Icon name="chevron-down" />} onClick={camMenu.toggleFromTrigger}>
            <span className="max-w-[220px] truncate">{current?.label || 'Camera'}</span>
          </Button>
          <Menu
            {...camMenu.props}
            align="start"
            width={300}
            items={cameras.map((c, i) => ({ label: c.label || `Camera ${i + 1}`, checked: c.deviceId === current?.deviceId, onSelect: () => setDeviceId(c.deviceId) }))}
          />
        </>
      )}
      <Button
        variant="soft"
        className="mt-4 self-center"
        leading={<Icon name="image" />}
        onClick={async () => {
          const { text, cancelled } = await pickAndDecodeQr()
          if (!cancelled) deliver(text)
        }}
      >
        Select file with QR
      </Button>
    </Modal>
  )
}
