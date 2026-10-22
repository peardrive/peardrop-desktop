/**
 * Receive queue mirror: the links main is still working on (see
 * @shared/receive). Main owns the queue; this store only reflects the last
 * list pushed on `receive:changed`.
 */
import { create } from 'zustand'
import type { ReceiveTask } from '@shared/receive'

interface ReceiveState {
  tasks: ReceiveTask[]
  /** Drive ids the queue has reached and is downloading. */
  ownedDrives: ReadonlySet<string>
  setTasks(tasks: ReceiveTask[]): void
}

export const useReceiveStore = create<ReceiveState>((set) => ({
  tasks: [],
  ownedDrives: new Set(),
  setTasks: (tasks) => set({ tasks, ownedDrives: new Set(tasks.map((t) => t.driveId).filter((id): id is string => !!id)) })
}))

export const receiveStore = () => useReceiveStore.getState()

/** True when the receive queue (main) drives this download. */
export const isQueueOwned = (driveId: string) => useReceiveStore.getState().ownedDrives.has(driveId)
