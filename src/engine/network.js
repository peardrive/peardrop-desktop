/**
 * MODULE: engine/network.js
 * PURPOSE: Hyperswarm network options for the engine (bootstrap nodes)
 * EXPORTS:
 * parseBootstrapList(value) - "host:port[,host:port]" -> [{host, port}] (throws on bad input)
 * swarmOptionsFromEnv(env) - Hyperswarm options from $PEARDROP_BOOTSTRAP (CLI / engine singleton)
 * NOTES:
 *   Mirrors src/shared/bootstrap.ts, which the app (main + renderer) uses.
 *   The two are kept in lock-step by test/bootstrap-parity.test.js — the CLI
 *   runs as plain Node and cannot import the TypeScript module.
 *   Ported from pearcore/src/utils/parsers.utils.js (parseBootstrapAddress)
 *   and pearcore/src/utils/network.utils.js (connectSwarm).
 * EXTERNAL CALLS: none (pure)
 */

/**
 * Parse one or more bootstrap addresses.
 * Accepts "host:port", "dht://host:port" or a comma/space separated list.
 * @param {string|null|undefined} value
 * @returns {Array<{host: string, port: number}>} empty when value is blank
 */
function parseBootstrapList (value) {
  if (value == null) return []
  const raw = String(value).trim()
  if (!raw) return []
  return raw.split(/[\s,]+/).filter(Boolean).map(parseOne)
}

function parseOne (entry) {
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
 * Hyperswarm constructor options derived from the environment.
 * Unset/blank PEARDROP_BOOTSTRAP means "use the public DHT" (no options).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ bootstrap?: Array<{host: string, port: number}> }}
 */
function swarmOptionsFromEnv (env = process.env) {
  let nodes = []
  try {
    nodes = parseBootstrapList(env.PEARDROP_BOOTSTRAP)
  } catch (err) {
    // Never let a typo in an env var take the engine down at require-time.
    console.warn('[network] Ignoring invalid PEARDROP_BOOTSTRAP:', err.message)
  }
  return nodes.length ? { bootstrap: nodes } : {}
}

module.exports = { parseBootstrapList, swarmOptionsFromEnv }
