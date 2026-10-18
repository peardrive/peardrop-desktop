/**
 * The CLI parses PEARDROP_BOOTSTRAP with src/engine/network.js; the app
 * parses Settings input with src/shared/bootstrap.ts. They must agree.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { formatBootstrapList, parseBootstrapList } from '@shared/bootstrap'

const require = createRequire(import.meta.url)
const engine = require('../../src/engine/network.js') as { parseBootstrapList: (v: string) => Array<{ host: string; port: number }>; swarmOptionsFromEnv: (e: object) => object }

const CASES = ['', '   ', '127.0.0.1:8787', 'dht://10.0.0.2:49737/', '[::1]:9000', 'a.local:1, b.local:2', 'host:65535', 'nohost', ':80', 'host:', 'host:abc', 'host:0', 'host:70000']

describe('bootstrap parsing parity (engine CJS vs shared TS)', () => {
  for (const input of CASES) {
    it(JSON.stringify(input), () => {
      const shared = parseBootstrapList(input)
      let engineNodes: unknown = null
      let engineError = false
      try {
        engineNodes = engine.parseBootstrapList(input)
      } catch {
        engineError = true
      }
      expect(!shared.ok).toBe(engineError)
      if (shared.ok) expect(shared.nodes).toEqual(engineNodes)
    })
  }

  it('formats canonically', () => {
    expect(formatBootstrapList([{ host: '127.0.0.1', port: 8787 }, { host: 'x', port: 1 }])).toBe('127.0.0.1:8787, x:1')
  })

  it('env helper never throws and ignores garbage', () => {
    expect(engine.swarmOptionsFromEnv({ PEARDROP_BOOTSTRAP: 'nope' })).toEqual({})
    expect(engine.swarmOptionsFromEnv({ PEARDROP_BOOTSTRAP: '127.0.0.1:8787' })).toEqual({ bootstrap: [{ host: '127.0.0.1', port: 8787 }] })
  })
})
