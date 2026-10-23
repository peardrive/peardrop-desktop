import { describe, expect, it } from 'vitest'
import { EMPTY_NETWORK_STATS, type EngineStatus, type NetworkStats } from '@shared/engine'
import { networkLevel } from './network-level'

function engine(phase: EngineStatus['phase']): EngineStatus {
  return { phase } as EngineStatus
}

function stats(patch: Partial<NetworkStats>): NetworkStats {
  return { ...EMPTY_NETWORK_STATS, ...patch }
}

describe('networkLevel', () => {
  it('is Starting before the engine reports anything', () => {
    expect(networkLevel(null, stats({})).label).toBe('Starting')
  })

  it('is Connecting until the first DHT ping answers', () => {
    expect(networkLevel(engine('starting'), stats({ reachable: null })).label).toBe('Connecting')
    expect(networkLevel(engine('ready'), stats({ reachable: null })).label).toBe('Connecting')
  })

  it('is Not reachable when the DHT does not answer, even with the engine ready', () => {
    const level = networkLevel(engine('ready'), stats({ reachable: false }))
    expect(level).toMatchObject({ label: 'Not reachable', bars: 0 })
  })

  it('is Reachable when the DHT answers but no peer is connected', () => {
    const level = networkLevel(engine('ready'), stats({ reachable: true, connections: 0 }))
    expect(level).toMatchObject({ label: 'Reachable', bars: 2 })
  })

  it('is Connected with an open peer connection', () => {
    const level = networkLevel(engine('ready'), stats({ reachable: true, connections: 2 }))
    expect(level).toMatchObject({ label: 'Connected', bars: 3 })
  })

  it('is Not reachable when the engine failed', () => {
    expect(networkLevel(engine('error'), stats({ reachable: true })).label).toBe('Not reachable')
  })
})
