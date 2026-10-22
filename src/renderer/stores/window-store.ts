/**
 * State of the frameless window (maximized / full screen / focused), pushed
 * by main, for the in-app window controls.
 */
import { create } from 'zustand'
import type { WindowState } from '@shared/ipc'

interface WindowStoreState {
  state: WindowState
  setState(state: WindowState): void
}

export const useWindowStore = create<WindowStoreState>((set) => ({
  state: { maximized: false, fullScreen: false, focused: true },
  setState: (state) => set({ state })
}))
