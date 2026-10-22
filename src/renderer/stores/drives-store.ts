/**
 * Drives store — every card in the list, plus the per-drive runtime facts
 * the engine streams in (announce state, peers, progress, cancellation).
 *
 * Order is insertion order, newest first; sorting is a view concern
 * (see selectors in hooks/useVisibleDrives.ts).
 */
import { create } from 'zustand'
import type { DriveView } from '../lib/drive-model'

export interface PeerLedger {
  active: Map<string, number>
  lastKey: string | null
  lastAt: number | null
  lastEndedAt: number | null
}

export interface PendingDelete {
  /** Epoch ms when the backend removal fires. */
  deadline: number
  deleteFiles: boolean
  /** Countdown finished and the backend call is running. */
  executing: boolean
}

interface DrivesState {
  drives: Record<string, DriveView>
  order: string[]
  /** Share ids whose DHT announce has landed. */
  announced: ReadonlySet<string>
  /** Cancel pressed — progress for these is ignored until removal. */
  cancelling: ReadonlySet<string>
  pendingDeletes: Readonly<Record<string, PendingDelete>>
  peers: Readonly<Record<string, PeerLedger>>
  /** Engine snapshot has been loaded at least once. */
  loaded: boolean
  /** Id to scroll to and pulse (e.g. "already downloaded"). */
  highlightId: string | null

  replaceAll(views: DriveView[]): void
  upsert(view: DriveView, opts?: { prepend?: boolean }): void
  patch(id: string, patch: Partial<DriveView>): void
  remove(id: string): void
  setAnnounced(id: string, on: boolean): void
  /** Replace the announced set (engine snapshot is authoritative). */
  resetAnnounced(ids: string[]): void
  setCancelling(id: string, on: boolean): void
  setPendingDelete(id: string, value: PendingDelete | null): void
  recordPeer(id: string, key: string | null, connected: boolean, at: number): void
  highlight(id: string | null): void
}

const withSet = <T>(s: ReadonlySet<T>, v: T, on: boolean) => {
  const next = new Set(s)
  if (on) next.add(v)
  else next.delete(v)
  return next
}

export const useDrivesStore = create<DrivesState>((set, get) => ({
  drives: {},
  order: [],
  announced: new Set(),
  cancelling: new Set(),
  pendingDeletes: {},
  peers: {},
  loaded: false,
  highlightId: null,

  replaceAll(views) {
    const drives: Record<string, DriveView> = {}
    for (const v of views) drives[v.id] = v
    // Keep placeholders (pasted links still connecting) across a reload.
    for (const id of get().order) {
      const d = get().drives[id]
      if (d?.isPlaceholder && !drives[id]) drives[id] = d
    }
    const order = Object.values(drives)
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .map((d) => d.id)
    set({ drives, order, loaded: true })
  },

  upsert(view, opts) {
    const { drives, order } = get()
    const exists = !!drives[view.id]
    set({
      drives: { ...drives, [view.id]: exists ? { ...drives[view.id], ...view } : view },
      order: exists ? order : opts?.prepend === false ? [...order, view.id] : [view.id, ...order]
    })
  },

  patch(id, patch) {
    const current = get().drives[id]
    if (!current) return
    set({ drives: { ...get().drives, [id]: { ...current, ...patch } } })
  },

  remove(id) {
    const { drives, order, pendingDeletes, cancelling, peers } = get()
    if (!drives[id] && !pendingDeletes[id]) return
    const nextDrives = { ...drives }
    delete nextDrives[id]
    const nextPending = { ...pendingDeletes }
    delete nextPending[id]
    const nextPeers = { ...peers }
    delete nextPeers[id]
    set({
      drives: nextDrives,
      order: order.filter((x) => x !== id),
      pendingDeletes: nextPending,
      cancelling: withSet(cancelling, id, false),
      peers: nextPeers
    })
  },

  setAnnounced: (id, on) => set({ announced: withSet(get().announced, id, on) }),
  resetAnnounced: (ids) => set({ announced: new Set(ids) }),
  setCancelling: (id, on) => set({ cancelling: withSet(get().cancelling, id, on) }),

  setPendingDelete(id, value) {
    const next = { ...get().pendingDeletes }
    if (value) next[id] = value
    else delete next[id]
    set({ pendingDeletes: next })
  },

  recordPeer(id, key, connected, at) {
    const prev = get().peers[id]
    const rec: PeerLedger = prev
      ? { ...prev, active: new Map(prev.active) }
      : { active: new Map(), lastKey: null, lastAt: null, lastEndedAt: null }
    if (connected) {
      if (key) rec.active.set(key, at)
      rec.lastKey = key
      rec.lastAt = at
    } else {
      if (key) rec.active.delete(key)
      rec.lastEndedAt = at
    }
    set({ peers: { ...get().peers, [id]: rec } })
  },

  highlight: (highlightId) => set({ highlightId })
}))

/** Non-hook accessor for controllers. */
export const drivesStore = () => useDrivesStore.getState()
