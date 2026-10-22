/**
 * Known transfer backends. Add an entry here to make a new engine selectable.
 */
import type { BackendFactory } from './backend'
import { createHyperdriveBackend } from './hyperdrive/hyperdrive-backend'

export const BACKENDS: Record<string, { label: string; create: BackendFactory }> = {
  hyperdrive: { label: 'Hyperdrive (Holepunch)', create: createHyperdriveBackend }
}

export const DEFAULT_BACKEND = 'hyperdrive'
