/**
 * UiScaleControl — Settings → Appearance → Size: a 21-step slider with − / +
 * buttons that zooms the whole interface live (see controllers/ui-scale.ts).
 *
 * Resizing the page moves the slider itself, which would pull it out from
 * under the pointer. So while it is in use the control "lifts": a copy is
 * drawn in a floating layer that counter-scales against the page zoom every
 * frame, keeping the same physical size and position on screen while the
 * settings behind it grow or shrink. Letting go snaps to the nearest step,
 * and the layer fades once the page has settled. After a − / + press it stays
 * up while the pointer is over it, so repeated presses land on the same spot.
 *
 * @example <SettingsRow label="Size" stacked control={<UiScaleControl />} />
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { clampUiScaleStep, UI_SCALE_DEFAULT_STEP, UI_SCALE_MAX_STEP, UI_SCALE_STEP_COUNT, uiScaleFactor } from '@shared/ui-scale'
import { cn } from '../../lib/cn'
import { useSettingsStore } from '../../stores/settings-store'
import {
  animateUiScaleTo,
  currentUiScaleFactor,
  onUiScaleFrame,
  setUiScaleStep,
  stepUiScale,
  whenUiScaleSettles
} from '../../controllers/ui-scale'
import { Icon } from '../../components/ui/Icon'

/** Padding of the lifted layer around the control. */
const LIFT_PAD = 10
/** After a − / + press, the layer drops this long after the pointer leaves it. */
const LEAVE_DELAY_MS = 450
/** …or this long after the last press if the pointer never went over it. */
const IDLE_DELAY_MS = 1600
const FADE_MS = 160

const percent = (step: number) => `${Math.round(uiScaleFactor(step) * 100)}%`

/** Where the control was when it lifted: its rect in CSS px at zoom `z0`. */
interface Lift {
  left: number
  top: number
  width: number
  z0: number
}

interface SliderProps {
  step: number
  railRef: RefObject<HTMLDivElement>
  lifted?: boolean
  onRailDown(e: ReactPointerEvent): void
  onButtonDown(delta: number, e: ReactPointerEvent): void
  onButtonClick(delta: number): void
  onKeyDown?(e: KeyboardEvent): void
  onReset(): void
}

function StepButton({ icon, label, disabled, onPointerDown, onClick, tabIndex }: {
  icon: 'minus' | 'plus'
  label: string
  disabled: boolean
  onPointerDown(e: ReactPointerEvent): void
  onClick(): void
  tabIndex: number
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      tabIndex={tabIndex}
      onPointerDown={onPointerDown}
      // Mouse presses act on pointerdown (the lifted layer covers the button before the click
      // would land); a keyboard press still arrives as a click with detail 0.
      onClick={(e) => e.detail === 0 && onClick()}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-fg/[0.07] text-fg transition-colors hover:bg-fg/[0.13] active:bg-fg/20 disabled:opacity-35 disabled:hover:bg-fg/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Icon name={icon} className="h-3 w-3" />
    </button>
  )
}

function SizeSlider({ step, railRef, lifted, onRailDown, onButtonDown, onButtonClick, onKeyDown, onReset }: SliderProps) {
  const pos = (step / UI_SCALE_MAX_STEP) * 100
  const whole = Math.round(step)
  const tabIndex = lifted ? -1 : 0
  return (
    <div className="flex items-center gap-2">
      <StepButton icon="minus" label="Smaller" disabled={whole <= 0} tabIndex={tabIndex} onPointerDown={(e) => onButtonDown(-1, e)} onClick={() => onButtonClick(-1)} />
      <div
        role="slider"
        tabIndex={tabIndex}
        aria-label="Interface size"
        aria-valuemin={0}
        aria-valuemax={UI_SCALE_MAX_STEP}
        aria-valuenow={whole}
        aria-valuetext={percent(whole)}
        onPointerDown={onRailDown}
        onKeyDown={onKeyDown}
        className="group relative h-8 min-w-0 flex-1 cursor-pointer touch-none rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <div ref={railRef} className="relative h-full">
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-fg/15" />
          <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${pos}%` }} />
          {Array.from({ length: UI_SCALE_STEP_COUNT }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'absolute top-1/2 w-px -translate-x-1/2 rounded-full',
                i === UI_SCALE_DEFAULT_STEP ? 'mt-1.5 h-2 bg-accent' : 'mt-2 h-1 bg-fg/25'
              )}
              style={{ left: `${(i / UI_SCALE_MAX_STEP) * 100}%` }}
            />
          ))}
          <div
            className={cn(
              'absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_1px_4px_rgb(0_0_0/0.45)] ring-4 ring-accent/20 transition-[box-shadow]',
              lifted ? 'ring-accent/30' : 'group-hover:ring-accent/30'
            )}
            style={{ left: `${pos}%` }}
          />
        </div>
      </div>
      <StepButton icon="plus" label="Bigger" disabled={whole >= UI_SCALE_MAX_STEP} tabIndex={tabIndex} onPointerDown={(e) => onButtonDown(1, e)} onClick={() => onButtonClick(1)} />
      <span className="tabular w-10 shrink-0 text-right text-[12px] font-semibold">{percent(step)}</span>
      <button
        type="button"
        tabIndex={whole === UI_SCALE_DEFAULT_STEP ? -1 : tabIndex}
        onClick={onReset}
        className={cn(
          'shrink-0 rounded-md px-1.5 text-[11px] font-semibold text-accent-strong transition-opacity hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
          whole === UI_SCALE_DEFAULT_STEP && 'pointer-events-none opacity-0'
        )}
      >
        Reset
      </button>
    </div>
  )
}

/** The floating copy: fixed over where the control was, counter-scaled against the page zoom. */
function LiftLayer({ lift, closing, children, onEnter, onLeave, layerRef }: {
  lift: Lift
  closing: boolean
  children: ReactNode
  onEnter(): void
  onLeave(): void
  layerRef: RefObject<HTMLDivElement>
}) {
  const place = useCallback(
    (z: number) => {
      const el = layerRef.current
      if (!el) return
      const k = lift.z0 / z
      el.style.left = `${(lift.left - LIFT_PAD) * k}px`
      el.style.top = `${(lift.top - LIFT_PAD) * k}px`
      el.style.transform = `scale(${k})`
    },
    [lift, layerRef]
  )
  useLayoutEffect(() => place(currentUiScaleFactor()), [place])
  useEffect(() => onUiScaleFrame(place), [place])

  return createPortal(
    <div
      ref={layerRef}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className="fixed z-[100] origin-top-left"
      style={{ width: lift.width + LIFT_PAD * 2, padding: LIFT_PAD }}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-xl bg-panel shadow-[0_10px_34px_rgb(0_0_0/0.5)] ring-1 ring-accent/45',
          'animate-[pd-lift_140ms_ease-out_both]',
          closing && 'opacity-0 transition-opacity'
        )}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      />
      <div className={cn('relative transition-opacity', closing && 'opacity-0')} style={{ transitionDuration: `${FADE_MS}ms` }}>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function UiScaleControl() {
  const saved = useSettingsStore((s) => s.preferences.appearance.uiScale)
  const [live, setLive] = useState<number | null>(null)
  const [lift, setLift] = useState<Lift | null>(null)
  const [closing, setClosing] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const pageRail = useRef<HTMLDivElement>(null)
  const layerRail = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const liftRef = useRef<Lift | null>(null)
  const dragging = useRef(false)
  const hovered = useRef(false)
  const timer = useRef(0)
  const closeToken = useRef(0)

  const step = live ?? saved

  const clearTimer = () => window.clearTimeout(timer.current)

  const openLift = () => {
    closeToken.current++
    clearTimer()
    setClosing(false)
    if (liftRef.current) return
    const r = rootRef.current!.getBoundingClientRect()
    liftRef.current = { left: r.left, top: r.top, width: r.width, z0: currentUiScaleFactor() }
    setLift(liftRef.current)
  }

  const closeLift = useCallback(async () => {
    clearTimer()
    const token = ++closeToken.current
    await whenUiScaleSettles()
    if (token !== closeToken.current) return
    setClosing(true)
    window.setTimeout(() => {
      if (token !== closeToken.current) return
      liftRef.current = null
      hovered.current = false
      setLift(null)
      setClosing(false)
    }, FADE_MS)
  }, [])

  const closeLater = (ms: number) => {
    clearTimer()
    timer.current = window.setTimeout(() => {
      if (!dragging.current && !hovered.current) void closeLift()
    }, ms)
  }

  /** Fractional step under the pointer, measured on whichever rail is on top. */
  const stepAt = (clientX: number) => {
    const rail = (layerRail.current ?? pageRail.current)!.getBoundingClientRect()
    return clampUiScaleStep(((clientX - rail.left) / rail.width) * UI_SCALE_MAX_STEP)
  }

  const onRailDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    openLift()
    dragging.current = true
    let current = stepAt(e.clientX)
    setLive(current)
    animateUiScaleTo(current)

    const move = (ev: PointerEvent) => {
      current = stepAt(ev.clientX)
      setLive(current)
      animateUiScaleTo(current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      dragging.current = false
      const final = Math.round(current)
      animateUiScaleTo(final) // also when the saved step does not change (no store update to animate it)
      setUiScaleStep(final)
      setLive(null)
      void closeLift()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const onButtonDown = (delta: number, e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    openLift()
    stepUiScale(delta)
    closeLater(IDLE_DELAY_MS)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }
    if (e.key === 'Home') setUiScaleStep(0)
    else if (e.key === 'End') setUiScaleStep(UI_SCALE_MAX_STEP)
    else if (keys[e.key]) stepUiScale(keys[e.key])
    else return
    e.preventDefault()
  }

  // A press anywhere outside the lifted layer puts it down.
  useEffect(() => {
    if (!lift) return
    const onDown = (e: PointerEvent) => {
      if (!dragging.current && !layerRef.current?.contains(e.target as Node)) void closeLift()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [lift, closeLift])

  useEffect(() => () => clearTimer(), [])

  const common = {
    step,
    onRailDown,
    onButtonDown,
    onButtonClick: (delta: number) => stepUiScale(delta),
    onReset: () => setUiScaleStep(UI_SCALE_DEFAULT_STEP)
  }

  return (
    <>
      <div ref={rootRef} className={cn('transition-opacity', lift && 'opacity-0')}>
        <SizeSlider {...common} railRef={pageRail} onKeyDown={onKeyDown} />
      </div>
      {lift && (
        <LiftLayer
          lift={lift}
          closing={closing}
          layerRef={layerRef}
          onEnter={() => {
            hovered.current = true
            clearTimer()
          }}
          onLeave={() => {
            hovered.current = false
            if (!dragging.current) closeLater(LEAVE_DELAY_MS)
          }}
        >
          <SizeSlider {...common} railRef={layerRail} lifted />
        </LiftLayer>
      )}
    </>
  )
}
