/**
 * Minimal typings for the Holepunch stack, which ships no TypeScript types.
 * Only the parts the engine uses are declared.
 */

declare module 'corestore' {
  import type { Duplex } from 'node:stream'

  export default class Corestore {
    constructor(storage: string, opts?: Record<string, unknown>)
    ready(): Promise<void>
    close(): Promise<void>
    replicate(stream: Duplex): unknown
  }
}

declare module 'hyperdrive' {
  import type { EventEmitter } from 'node:events'
  import type { Readable, Writable } from 'node:stream'
  import type Corestore from 'corestore'

  /** The parts of a Hypercore the engine listens to. */
  export interface HypercoreLike extends EventEmitter {
    readonly length: number
  }

  export interface HyperdriveEntry {
    key: string
    value: { blob?: { byteLength: number } | null } | null
  }

  export default class Hyperdrive {
    constructor(store: Corestore, key?: Buffer)
    readonly key: Buffer
    readonly discoveryKey: Buffer
    readonly core: HypercoreLike | null
    readonly blobs: { core: HypercoreLike } | null
    ready(): Promise<void>
    close(): Promise<void>
    /** Resolves once the drive is up to date. `wait` waits for peers that may still arrive. */
    update(opts?: { wait?: boolean }): Promise<boolean>
    /** Marks peer discovery as in progress; call the returned function when it settles. */
    findingPeers(): () => void
    get(path: string): Promise<Buffer | null>
    put(path: string, data: Buffer): Promise<void>
    list(folder: string): Readable & AsyncIterable<HyperdriveEntry>
    createReadStream(path: string): Readable
    createWriteStream(path: string): Writable
    getBlobs(): Promise<{ core: HypercoreLike } | null>
  }
}

declare module 'hyperswarm' {
  import type { EventEmitter } from 'node:events'
  import type { Duplex } from 'node:stream'

  export interface PeerInfo {
    publicKey: Buffer
  }

  /** An encrypted connection to a peer (a SecretStream over UDX). */
  export interface SwarmConnection extends Duplex {
    readonly remotePublicKey: Buffer
    /** The UDX stream underneath, which keeps running byte totals. */
    readonly rawStream?: { bytesReceived?: number; bytesTransmitted?: number }
  }

  export interface PeerDiscovery {
    /** Resolves once the topic has been announced / looked up on the DHT. */
    flushed(): Promise<void>
  }

  export interface HyperswarmOptions {
    bootstrap?: Array<{ host: string; port: number }>
    seed?: Buffer
  }

  export default class Hyperswarm extends EventEmitter {
    constructor(opts?: HyperswarmOptions)
    readonly connections: Set<SwarmConnection>
    join(topic: Buffer, opts?: { server?: boolean; client?: boolean }): PeerDiscovery
    /** Resolves once every pending join has been processed. */
    flush(): Promise<void>
    /** `force` skips unannouncing topics and closes immediately. */
    destroy(opts?: { force?: boolean }): Promise<void>
    on(event: 'connection', listener: (socket: SwarmConnection, info: PeerInfo) => void): this
    on(event: string | symbol, listener: (...args: any[]) => void): this
  }
}
