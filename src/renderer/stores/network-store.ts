/**
 * Live network figures for the sidebar status panel (peers, inbound and
 * outbound speed), pushed by main about once a second.
 */
import { create } from 'zustand'
import { EMPTY_NETWORK_STATS, type NetworkStats } from '@shared/engine'

interface NetworkState {
  stats: NetworkStats
  setStats(stats: NetworkStats): void
}

export const useNetworkStore = create<NetworkState>((set) => ({
  stats: EMPTY_NETWORK_STATS,
  setStats: (stats) => set({ stats })
}))
