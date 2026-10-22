/**
 * preferences.json — user settings (theme, network bootstrap, list view, debug).
 */
import { mergePreferences, sanitizePreferences, type Preferences, type PreferencesPatch } from '@shared/preferences'
import type { Logger } from '../logger'
import { JsonStore } from './json-store'

export class PreferencesStore extends JsonStore<Preferences> {
  constructor(file: string, log?: Logger) {
    super(file, sanitizePreferences, log)
  }

  /** Apply a deep-partial patch and persist. */
  patch(patch: PreferencesPatch): Promise<Preferences> {
    return this.update((current) => mergePreferences(current, patch))
  }
}
