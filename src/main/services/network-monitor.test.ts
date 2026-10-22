import { describe, expect, it } from 'vitest'
import { NetworkMonitor } from './network-monitor'

function counters() {
  const c = { peers: 2, connections: 3, bytesIn: 0, bytesOut: 0, generation: 1 }
  return { c, engine: { networkCounters: () => ({ ...c }) } }
}

describe('NetworkMonitor', () => {
  it('turns cumulative counters into smoothed speeds', () => {
    const { c, engine } = counters()
    const m = new NetworkMonitor(engine)
    m.sample(0)
    let s = m.get()
    for (let t = 1; t <= 10; t++) {
      c.bytesIn += 1_000_000
      c.bytesOut += 250_000
      s = m.sample(t * 1000)
    }
    expect(s.peers).toBe(2)
    expect(s.inbound).toBeGreaterThan(950_000)
    expect(s.inbound).toBeLessThanOrEqual(1_000_000)
    expect(s.outbound).toBeGreaterThan(230_000)
  })

  it('survives an engine reload (counters reset) without negative speeds', () => {
    const { c, engine } = counters()
    const m = new NetworkMonitor(engine)
    c.bytesIn = 5_000_000
    m.sample(0)
    c.generation = 2
    c.bytesIn = 1000
    const s = m.sample(1000)
    expect(s.inbound).toBeGreaterThanOrEqual(0)
    expect(s.totalIn).toBe(1000)
  })

  it('reads idle as zero', () => {
    const { c, engine } = counters()
    const m = new NetworkMonitor(engine)
    m.sample(0)
    c.bytesIn += 20 // keep-alive chatter
    expect(m.sample(1000).inbound).toBe(0)
  })
})
