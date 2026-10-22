/**
 * NetworkPanel — the status card at the bottom of the sidebar.
 *
 * Compact (Figma): signal bars + state, then outbound and inbound speed
 * stacked in a column. Clicking it opens the extension with the details the
 * design leaves out: inbound and outbound speed with labels, what moved this
 * session and which DHT the engine is on. In the expanded sidebar the
 * extension unfolds in place above the card (and the choice is remembered);
 * in the folded sidebar the card shows the bars and the details open in a
 * popover beside it.
 *
 * There is no peer count: every drive runs its own swarm, so one remote
 * device shows up once per drive it is connected to and the total means
 * nothing.
 *
 * @example <NetworkPanel collapsed={false} />
 */
import { useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { formatBootstrapList } from '@shared/bootstrap'
import type { EngineStatus, NetworkStats } from '@shared/engine'
import { useDismiss } from '../../hooks/useDismiss'
import { cn } from '../../lib/cn'
import { formatBytes, formatSpeed } from '../../lib/format'
import { useNetworkStore } from '../../stores/network-store'
import { useSettingsStore } from '../../stores/settings-store'
import { VIcon } from '../ui/VIcon'

type Level = { label: string; bars: 0 | 1 | 2 | 3; tone: 'online' | 'warning' | 'danger' | 'muted' }

/** What the signal bars say. */
export function connectionLevel(engine: EngineStatus | null, stats: NetworkStats): Level {
  switch (engine?.phase) {
    case 'ready':
      return stats.connections > 0 ? { label: 'Connected', bars: 3, tone: 'online' } : { label: 'Online', bars: 2, tone: 'online' }
    case 'starting':
    case 'reloading':
      return { label: 'Connecting', bars: 1, tone: 'warning' }
    case 'error':
      return { label: 'Offline', bars: 0, tone: 'danger' }
    default:
      return { label: engine ? 'Offline' : 'Starting', bars: 0, tone: 'muted' }
  }
}

const TONE_TEXT = { online: 'text-online', warning: 'text-warning', danger: 'text-danger', muted: 'text-subtle' } as const

/** Three rising bars; unlit bars stay faint. */
function SignalBars({ level }: { level: Level }) {
  return (
    <span className={cn('flex h-4 shrink-0 items-end gap-0.5', TONE_TEXT[level.tone])} aria-hidden>
      {[6, 10, 14].map((h, i) => (
        <span key={h} className={cn('w-0.5 rounded-[1px] bg-current', i >= level.bars && 'opacity-25')} style={{ height: h }} />
      ))}
    </span>
  )
}

const speedText = (bps: number) => formatSpeed(bps) || '0 B/s'

function Details({ stats, engine }: { stats: NetworkStats; engine: EngineStatus | null }) {
  // One line per bootstrap node, so a host:port is never split across lines.
  const networkLines = !engine
    ? ['—']
    : engine.bootstrapSource === 'public' || engine.bootstrap.length === 0
      ? [engine.bootstrapSource === 'public' ? 'Public DHT' : 'Custom bootstrap']
      : engine.bootstrap.map((node) => formatBootstrapList([node]))
  const rows: Array<[string, React.ReactNode, string?]> = [
    [
      'Inbound',
      <span key="in" className="text-inbound">
        {speedText(stats.inbound)}
      </span>,
      'Download speed, all transfers'
    ],
    [
      'Outbound',
      <span key="out" className="text-accent">
        {speedText(stats.outbound)}
      </span>,
      'Upload speed, all shares'
    ],
    ['Received', formatBytes(stats.totalIn), 'since the engine started'],
    ['Sent', formatBytes(stats.totalOut), 'since the engine started']
  ]
  return (
    <dl className="flex flex-col gap-1.5 text-[10px]">
      {rows.map(([k, v, hint]) => (
        <div key={k} className="flex min-w-0 items-center justify-between gap-2" title={hint}>
          <dt className="shrink-0 font-medium text-muted">{k}</dt>
          <dd className="tabular min-w-0 truncate text-right font-semibold text-fg">{v}</dd>
        </div>
      ))}
      {/* Label above the value: a host:port list needs the full width and
          wraps instead of being cut off. */}
      <div className="flex min-w-0 flex-col gap-0.5" title={networkLines.join(', ')}>
        <dt className="font-medium text-muted">Network</dt>
        {networkLines.map((line) => (
          <dd key={line} className="tabular font-semibold text-fg [overflow-wrap:anywhere]">
            {line}
          </dd>
        ))}
      </div>
    </dl>
  )
}

function Popover({ anchorRef, onClose, children }: { anchorRef: RefObject<HTMLElement>; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const refs = useMemo(() => [ref as RefObject<HTMLElement>, anchorRef], [anchorRef])
  useDismiss(refs, true, onClose)
  const r = anchorRef.current?.getBoundingClientRect()
  const width = 196
  const left = r ? r.right + 8 : 72
  const bottom = r ? Math.max(8, window.innerHeight - r.bottom) : 8
  return createPortal(
    <div ref={ref} role="dialog" aria-label="Network" className="no-drag glass fixed z-[1000] rounded-xl p-3 shadow-menu animate-pop-in" style={{ left, bottom, width }}>
      {children}
    </div>,
    document.body
  )
}

export function NetworkPanel({ collapsed }: { collapsed: boolean }) {
  const stats = useNetworkStore((s) => s.stats)
  const engine = useSettingsStore((s) => s.engine)
  const expanded = useSettingsStore((s) => s.preferences.layout.networkDetails)
  const update = useSettingsStore((s) => s.updatePreferences)
  const [popover, setPopover] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const level = connectionLevel(engine, stats)
  const toggle = () => (collapsed ? setPopover((o) => !o) : void update({ layout: { networkDetails: !expanded } }))
  const title = `${level.label} · ↓ ${speedText(stats.inbound)} · ↑ ${speedText(stats.outbound)}`

  if (collapsed) {
    return (
      <>
        <button
          ref={buttonRef}
          type="button"
          onClick={toggle}
          title={title}
          aria-label={`Network: ${title}`}
          aria-expanded={popover}
          className="chip flex w-full flex-col items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-fg/10"
        >
          <span className="flex h-[30px] items-center">
            <SignalBars level={level} />
          </span>
        </button>
        {popover && (
          <Popover anchorRef={buttonRef} onClose={() => setPopover(false)}>
            <div className="mb-2.5 flex items-center gap-2">
              <SignalBars level={level} />
              <span className={cn('text-[11px] font-semibold', TONE_TEXT[level.tone])}>{level.label}</span>
            </div>
            <Details stats={stats} engine={engine} />
          </Popover>
        )}
      </>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={expanded ? 'Hide network details' : 'Show network details'}
      aria-expanded={expanded}
      className="chip flex w-full flex-col gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-fg/10"
    >
      {expanded && (
        <div className="w-full border-b border-fg/10 pb-2 pt-0.5 animate-fade-in">
          <Details stats={stats} engine={engine} />
        </div>
      )}
      <div className="flex w-full items-center">
        <span className="flex h-[30px] items-center gap-2 overflow-hidden py-1.5">
          <SignalBars level={level} />
          <span className={cn('truncate text-[10px] font-semibold leading-[18px]', TONE_TEXT[level.tone])}>{level.label}</span>
        </span>
      </div>
      {!expanded && (
        <div className="flex w-full flex-col gap-1 pb-1">
          <span className="flex min-w-0 items-center gap-1.5 text-accent" title="Outbound (upload)">
            <VIcon name="upload-speed" size={12} />
            <span className="tabular truncate text-[10px] font-semibold leading-4 text-fg">{speedText(stats.outbound)}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-inbound" title="Inbound (download)">
            <VIcon name="download-speed" size={12} />
            <span className="tabular truncate text-[10px] font-semibold leading-4 text-fg">{speedText(stats.inbound)}</span>
          </span>
        </div>
      )}
    </button>
  )
}
