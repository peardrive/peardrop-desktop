/**
 * NetworkProbe — answers "can this machine reach the DHT?" by pinging the
 * bootstrap servers directly.
 *
 * The DHT nodes inside each drive's swarm cannot answer that honestly:
 * `bootstrapped` turns true when the bootstrap attempt FINISHES, even if
 * every request timed out, and `online` starts as true. So the probe keeps
 * its own small DHT node with no bootstrap list (it joins nothing and adds no
 * traffic) and only uses it to send pings.
 *
 * Checks run right away, then every PROBE_INTERVAL_MS while reachable and
 * every RETRY_INTERVAL_MS while not, so a recovered network shows quickly.
 */
import dns from 'node:dns/promises'
import net from 'node:net'
import HyperDHT from 'hyperdht'
import type { BootstrapNode } from '@shared/bootstrap'
import type { Logger } from '../logger'

const PROBE_INTERVAL_MS = 10_000
const RETRY_INTERVAL_MS = 3_000
const DEFAULT_PING_TIMEOUT_MS = 4_000

export interface NetworkProbeOptions {
  /** Servers to ping; empty means HyperDHT's public bootstrap nodes. */
  bootstrap: BootstrapNode[]
  log: Logger
  pingTimeoutMs?: number
}

/** HyperDHT's public nodes, written "ip@hostname:port"; the IP is pinged. */
function publicBootstrapNodes(): BootstrapNode[] {
  return HyperDHT.BOOTSTRAP.map((entry) => {
    const [address] = entry.split('@')
    const hostPort = entry.slice(entry.lastIndexOf(':') + 1)
    return { host: address, port: Number(hostPort) }
  })
}

export class NetworkProbe {
  /** null until the first check finishes. */
  reachable: boolean | null = null

  private dht: HyperDHT | null = null
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private readonly targets: BootstrapNode[]
  private readonly pingTimeoutMs: number

  constructor(private readonly opts: NetworkProbeOptions) {
    this.targets = opts.bootstrap.length ? opts.bootstrap : publicBootstrapNodes()
    this.pingTimeoutMs = opts.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS
  }

  start(): void {
    this.dht = new HyperDHT({ bootstrap: [], ephemeral: true })
    void this.loop()
  }

  async stop(): Promise<void> {
    this.stopped = true

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const dht = this.dht
    this.dht = null
    await dht?.destroy({ force: true }).catch(() => undefined)
  }

  /** Ping every target at once; reachable if any of them answers. */
  async check(): Promise<boolean> {
    const results = await Promise.all(this.targets.map((target) => this.ping(target)))
    const reachable = results.some(Boolean)

    if (reachable !== this.reachable) {
      this.opts.log.info(reachable ? 'DHT reachable' : 'DHT not reachable', {
        servers: this.targets.map((t) => `${t.host}:${t.port}`)
      })
    }

    this.reachable = reachable
    return reachable
  }

  private async loop(): Promise<void> {
    if (this.stopped) {
      return
    }

    const reachable = await this.check()
    if (this.stopped) {
      return
    }

    this.timer = setTimeout(() => void this.loop(), reachable ? PROBE_INTERVAL_MS : RETRY_INTERVAL_MS)
    this.timer.unref?.()
  }

  private async ping(target: BootstrapNode): Promise<boolean> {
    const dht = this.dht
    if (!dht) {
      return false
    }

    try {
      // UDP needs an IP address: resolve host names first.
      const host = net.isIP(target.host) ? target.host : (await dns.lookup(target.host)).address
      await withTimeout(dht.ping({ host, port: target.port }), this.pingTimeoutMs)
      return true
    } catch {
      return false
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ping timed out')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
