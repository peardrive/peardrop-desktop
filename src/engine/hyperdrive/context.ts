/**
 * What the engine modules (share, receive, seeding, resume) need from the
 * HyperdriveManager that owns them. The manager implements this interface
 * and passes itself in.
 */
import type Hyperswarm from 'hyperswarm'
import type { ManifestStore } from './manifest-store'
import type { ProgressTracker } from './progress-tracker'
import type { DriveSession, ManagerEventName, ManagerEvents, PendingConnection } from './types'

export interface EngineContext {
  readonly drivesDir: string
  readonly store: ManifestStore
  readonly tracker: ProgressTracker
  /** Drives open right now, by id. */
  readonly activeDrives: Map<string, DriveSession>
  /** Receive sessions still waiting for their sender, by id. */
  readonly pendingConnections: Map<string, PendingConnection>
  /** Share builds the user asked to cancel. */
  readonly cancelledShares: Set<string>
  /** A new swarm, configured with the engine's bootstrap nodes. */
  createSwarm(): Hyperswarm
  emitEvent<K extends ManagerEventName>(event: K, data: ManagerEvents[K]): void
  stopDrive(driveId: string, options?: { delete?: boolean }): Promise<void>
}
