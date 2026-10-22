/**
 * Files the user has picked/dropped but not shared yet (Send modal, state B).
 */
import { create } from 'zustand'
import type { ShareSource } from '@shared/transfer'

interface StagedState {
  files: ShareSource[]
  loading: boolean
  setFiles(files: ShareSource[]): void
  addFiles(files: ShareSource[]): void
  removeAt(index: number): void
  clear(): void
  setLoading(on: boolean): void
}

export const useStagedFilesStore = create<StagedState>((set, get) => ({
  files: [],
  loading: false,
  setFiles: (files) => set({ files }),
  addFiles(files) {
    // Same path twice adds nothing.
    const seen = new Set(get().files.map((f) => f.path))
    set({ files: [...get().files, ...files.filter((f) => !seen.has(f.path))] })
  },
  removeAt: (index) => set({ files: get().files.filter((_, i) => i !== index) }),
  clear: () => set({ files: [] }),
  setLoading: (loading) => set({ loading })
}))

export const stagedStore = () => useStagedFilesStore.getState()
