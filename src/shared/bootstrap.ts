/**
 * DHT bootstrap address helpers, shared by the main process (to configure
 * Hyperswarm) and the renderer (to validate the Settings input live).
 *
 * Mirrors src/engine/network.js, which the plain-Node CLI uses. The parity
 * test in test/bootstrap-parity.test.ts keeps both in lock-step.
 * Ported from pearcore/src/utils/parsers.utils.js (parseBootstrapAddress).
 */

export interface BootstrapNode {
  host: string
  port: number
}

export type BootstrapParseResult =
  | { ok: true; nodes: BootstrapNode[] }
  | { ok: false; error: string }

function parseOne(entry: string): BootstrapNode {
  const cleaned = entry.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  const idx = cleaned.lastIndexOf(':')
  if (idx <= 0) throw new Error(`Missing port in bootstrap address "${entry}" (expected host:port)`)
  const host = cleaned.slice(0, idx).replace(/^\[|\]$/g, '').trim()
  const portStr = cleaned.slice(idx + 1).trim()
  if (!host) throw new Error(`Missing host in bootstrap address "${entry}"`)
  if (!/^\d+$/.test(portStr)) throw new Error(`Invalid port in bootstrap address "${entry}"`)
  const port = Number(portStr)
  if (port < 1 || port > 65535) throw new Error(`Port out of range in bootstrap address "${entry}"`)
  return { host, port }
}

/**
 * Parse "host:port", "dht://host:port" or a comma/space separated list.
 * Blank input is valid and means "use the public DHT".
 */
export function parseBootstrapList(value: string | null | undefined): BootstrapParseResult {
  const raw = (value ?? '').trim()
  if (!raw) return { ok: true, nodes: [] }
  try {
    return { ok: true, nodes: raw.split(/[\s,]+/).filter(Boolean).map(parseOne) }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Canonical string form, e.g. "127.0.0.1:8787, 10.0.0.2:49737". */
export function formatBootstrapList(nodes: BootstrapNode[]): string {
  return nodes.map((n) => `${n.host}:${n.port}`).join(', ')
}

/** Default address of `npm run bootstrap` (matches pearcore's bootstrapper service). */
export const LOCAL_BOOTSTRAP = '127.0.0.1:8787'
