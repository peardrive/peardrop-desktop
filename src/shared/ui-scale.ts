/**
 * Interface size ("Size" in Settings → Appearance): 21 steps of page zoom.
 *
 * Step 2 is 100%, the size the app was designed at, so there are only two
 * steps smaller than the original layout. The default sits two steps above
 * it, a little roomier than the original compact layout.
 *
 * Steps can be fractional while the slider is being dragged; the saved
 * preference is always a whole step.
 */
export const UI_SCALE_STEP_COUNT = 21
export const UI_SCALE_MAX_STEP = UI_SCALE_STEP_COUNT - 1
export const UI_SCALE_DEFAULT_STEP = 4

const MIN_FACTOR = 0.9
const FACTOR_PER_STEP = 0.05

export function clampUiScaleStep(step: number): number {
  return Math.min(UI_SCALE_MAX_STEP, Math.max(0, step))
}

/** Zoom factor for a (possibly fractional) step: 0 → 90%, 2 → 100%, 4 → 110% … 20 → 190%. */
export function uiScaleFactor(step: number): number {
  return MIN_FACTOR + FACTOR_PER_STEP * clampUiScaleStep(step)
}
