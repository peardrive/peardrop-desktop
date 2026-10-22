#!/usr/bin/env node
/**
 * Local HyperDHT bootstrapper — `npm run bootstrap`.
 *
 * Starts a fresh, private DHT so PearDrop instances can find each other
 * without the public network (LAN / offline testing):
 *
 *   npm run bootstrap                          # 127.0.0.1:8787
 *   npm run bootstrap -- --host 0.0.0.0 --port 49737
 *   npm run bootstrap -- --lan                 # bind to this machine's LAN IPv4
 *
 * Then point peers at it:
 *   npm run dev            (uses 127.0.0.1:8787 automatically)
 *   Settings → Network → Bootstrap node → "<host>:<port>"  (npm run app)
 *   PEARDROP_BOOTSTRAP=<host>:<port> peardrop share ./file  (CLI)
 *
 * Ported from pearcore:
 *   src/utils/network.utils.js       (getIPv4, startDHTServer, startBootstrapper)
 *   src/services/bootstraper.service.js (startBootstrapServer)
 * The bootstrapper node listens on <port>; a persistent DHT node on <port+1>
 * joins it so the network has a routable member from the first second.
 */
import os from 'node:os'
import HyperDHT from 'hyperdht'

// ── pearcore/src/utils/network.utils.js ────────────────────────────────────

/** IPv4 addresses of non-internal interfaces. */
export function getIPv4() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (!a.internal && a.family === 'IPv4') out.push(a.address)
  }
  return out
}

/** Start a (persistent by default) HyperDHT node joined to `bootstrap`. */
export async function startDHTServer({ port = 3000, ephemeral = false, bootstrap }) {
  const node = new HyperDHT({ bootstrap, ephemeral, port })
  await node.fullyBootstrapped()
  return node
}

/** Bootstrapper on host:port plus a persistent node on port+1. */
export async function startBootstrapper({ port, ipv4 }) {
  if (!port) throw new Error('Port is required')
  if (!ipv4) throw new Error('Host is required')
  const bootstrapperNode = HyperDHT.bootstrapper(port, ipv4)
  await bootstrapperNode.fullyBootstrapped()
  const persistentNode = await startDHTServer({ port: port + 1, ephemeral: false, bootstrap: [{ host: ipv4, port }] })
  return { bootstrapperNode, persistentNode }
}

// ── pearcore/src/services/bootstraper.service.js ───────────────────────────

export async function startBootstrapServer({ ipv4 = '127.0.0.1', port = 8787 } = {}) {
  const { bootstrapperNode, persistentNode } = await startBootstrapper({ ipv4, port })
  return { ipv4, port, bootstrapperNode, persistentNode }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { host: process.env.PEARDROP_BOOTSTRAP_HOST || '127.0.0.1', port: Number(process.env.PEARDROP_BOOTSTRAP_PORT) || 8787, lan: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--host' || a === '-h') args.host = argv[++i]
    else if (a === '--port' || a === '-p') args.port = Number(argv[++i])
    else if (a === '--lan') args.lan = true
    else if (a === '--help') args.help = true
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: npm run bootstrap -- [--host 127.0.0.1] [--port 8787] [--lan]')
    return
  }
  if (args.lan) {
    const [ip] = getIPv4()
    if (!ip) throw new Error('No LAN IPv4 address found')
    args.host = ip
  }
  if (args.host === '0.0.0.0') throw new Error('Bind to a concrete IPv4 (0.0.0.0 is not routable for peers); try --lan')
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65534) throw new Error(`Invalid port: ${args.port}`)

  const server = await startBootstrapServer({ ipv4: args.host, port: args.port })
  const addr = `${server.ipv4}:${server.port}`
  console.log('')
  console.log('  🍐 PearDrop local bootstrapper running')
  console.log(`     bootstrap node   ${addr}`)
  console.log(`     persistent node  ${server.ipv4}:${server.port + 1}`)
  console.log('')
  console.log(`     npm run dev                       → already wired to 127.0.0.1:8787`)
  console.log(`     Settings → Network → Bootstrap    → ${addr}`)
  console.log(`     PEARDROP_BOOTSTRAP=${addr} peardrop share <file>`)
  const others = getIPv4().filter((ip) => ip !== server.ipv4)
  if (server.ipv4 === '127.0.0.1' && others.length) console.log(`\n     Other machines can't reach 127.0.0.1 — use --lan (e.g. ${others[0]})`)
  console.log('\n  Ctrl+C to stop.\n')

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    console.log('\nStopping bootstrapper…')
    await Promise.allSettled([server.persistentNode.destroy(), server.bootstrapperNode.destroy()])
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('bootstrapper.mjs')) {
  main().catch((err) => {
    console.error(`Bootstrapper failed: ${err.message}`)
    process.exit(1)
  })
}
