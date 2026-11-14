/**
 * UiScalePicker — the interface size, as a compact segmented switch.
 *
 * Writes `appearance.uiScale` to preferences; main turns the step into a
 * renderer zoom factor and applies it (see applyZoom in main/window.ts), so
 * text, spacing and icons grow together and the choice survives a reload.
 * Each label is drawn at its own step, so the control previews itself.
 *
 * @example <UiScalePicker />
 */
import { UI_SCALES, type UiScale } from '@shared/preferences'
import { SegmentedControl } from '../../components/ui/SegmentedControl'
import { useSettingsStore } from '../../stores/settings-store'

const LABELS: Record<UiScale, string> = {
  small: 'Small',
  default: 'Default',
  large: 'Large',
  xlarge: 'Larger'
}

/** Preview sizes, not the real factors — the control must stay one row tall. */
const PREVIEW_PX: Record<UiScale, number> = {
  small: 10,
  default: 11.5,
  large: 13,
  xlarge: 15
}

const OPTIONS = UI_SCALES.map((id) => ({
  value: id,
  label: (
    <span style={{ fontSize: `${PREVIEW_PX[id]}px` }} className="leading-none">
      {LABELS[id]}
    </span>
  )
}))

export function UiScalePicker() {
  const value = useSettingsStore((s) => s.preferences.appearance.uiScale)
  const update = useSettingsStore((s) => s.updatePreferences)
  return (
    <SegmentedControl
      ariaLabel="Interface size"
      value={value}
      onChange={(next) => void update({ appearance: { uiScale: next } })}
      options={OPTIONS}
    />
  )
}
