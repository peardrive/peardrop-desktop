/**
 * Interface size: eases the page zoom toward a target step, one small change
 * per animation frame, so growing or shrinking the app reads as one smooth
 * motion instead of a jump (on the slider, the + / − buttons, Cmd/Ctrl + / − / 0
 * and when a saved preference arrives).
 *
 * The saved preference is a whole step (shared/ui-scale.ts). While the slider
 * is dragged the target follows the pointer as a fractional step, so the
 * size tracks the hand continuously; letting go snaps to the nearest step.
 */
import { clampUiScaleStep, UI_SCALE_DEFAULT_STEP, uiScaleFactor } from '@shared/ui-scale'
import { api } from '../services/client'
import { useSettingsStore } from '../stores/settings-store'

/** Time constant of the easing: ~95% of the way in 3τ. */
const EASE_MS = 70

let shown = Number.NaN
let target = Number.NaN
let frame = 0
let lastTime = 0
const listeners = new Set<(factor: number) => void>()
const settleWaiters: Array<() => void> = []

function apply(step: number): void {
  shown = step
  const factor = uiScaleFactor(step)
  try {
    api().window.setZoom(factor)
  } catch {
    /* client not installed yet */
  }
  for (const cb of listeners) cb(factor)
}

function tick(now: number): void {
  const dt = Math.min(64, now - lastTime)
  lastTime = now
  let next = shown + (target - shown) * (1 - Math.exp(-dt / EASE_MS))
  if (Math.abs(target - next) < 0.004) next = target
  apply(next)
  if (next === target) {
    frame = 0
    for (const cb of settleWaiters.splice(0)) cb()
  } else {
    frame = requestAnimationFrame(tick)
  }
}

/** Jump to a step with no animation (first paint). */
export function setUiScaleNow(step: number): void {
  cancelAnimationFrame(frame)
  frame = 0
  target = clampUiScaleStep(step)
  apply(target)
  for (const cb of settleWaiters.splice(0)) cb()
}

/** Ease toward a (possibly fractional) step. */
export function animateUiScaleTo(step: number): void {
  if (Number.isNaN(shown)) return setUiScaleNow(step)
  target = clampUiScaleStep(step)
  if (frame || target === shown) return
  lastTime = performance.now()
  frame = requestAnimationFrame(tick)
}

/** Current zoom factor on screen (mid-animation included). */
export function currentUiScaleFactor(): number {
  return uiScaleFactor(Number.isNaN(shown) ? UI_SCALE_DEFAULT_STEP : shown)
}

/** Called with the zoom factor on every applied frame. */
export function onUiScaleFrame(cb: (factor: number) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Resolves once the animation has reached its target. */
export function whenUiScaleSettles(): Promise<void> {
  return new Promise((resolve) => (frame ? settleWaiters.push(resolve) : resolve()))
}

/** Save a whole step (the store change then animates to it, see startUiScaleSync). */
export function setUiScaleStep(step: number): void {
  const next = Math.round(clampUiScaleStep(step))
  void useSettingsStore.getState().updatePreferences({ appearance: { uiScale: next } })
}

export function stepUiScale(delta: number): void {
  setUiScaleStep(useSettingsStore.getState().preferences.appearance.uiScale + delta)
}

/** After the saved preferences are loaded: show them at once, then animate every later change. */
export function startUiScaleSync(): void {
  setUiScaleNow(useSettingsStore.getState().preferences.appearance.uiScale)
  useSettingsStore.subscribe((s, prev) => {
    if (s.preferences.appearance.uiScale !== prev.preferences.appearance.uiScale) animateUiScaleTo(s.preferences.appearance.uiScale)
  })
}
