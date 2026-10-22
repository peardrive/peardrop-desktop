/**
 * UI navigation state: page, tab, search/filter, and the modal stack.
 *
 * Modals are a stack so a sub-flow can sit on top of its parent (QR scanner
 * over Receive, a confirm over anything) and Escape closes only the top one.
 */
import { create } from 'zustand'

export type Page = 'main' | 'settings' | 'report-bug'
/** Sidebar lists: everything, my shares, what I received, starred. */
export type ListTab = 'all' | 'shares' | 'received' | 'favorites'
export type StatusFilter = 'any' | 'active' | 'transferring' | 'attention'

export interface ConfirmButton {
  label: string
  variant?: 'primary' | 'secondary' | 'danger'
  /** Receives the checkbox state when the dialog has one. */
  onSelect?: (opts: { checked: boolean }) => void
}

export type ModalSpec =
  | { type: 'send' }
  | { type: 'receive' }
  | { type: 'share-link'; link: string; title?: string }
  | { type: 'info'; driveId: string }
  | { type: 'folder'; driveId: string }
  | { type: 'rename'; driveId: string }
  | { type: 'qr-scanner'; onResult: (text: string | null) => void }
  | { type: 'engine-reload'; bootstrap?: string }
  | {
      type: 'confirm'
      title: string
      message?: string
      checkbox?: { label: string; hint?: string; checked?: boolean }
      buttons: ConfirmButton[]
    }

type ModalEntry = ModalSpec & { key: number }

interface UiState {
  page: Page
  tab: ListTab
  search: string
  statusFilter: StatusFilter
  modals: ModalEntry[]
  setPage(page: Page): void
  setTab(tab: ListTab): void
  setSearch(q: string): void
  setStatusFilter(f: StatusFilter): void
  openModal(spec: ModalSpec): number
  closeModal(key?: number): void
  closeModalsOfType(type: ModalSpec['type']): void
  isOpen(type: ModalSpec['type']): boolean
}

let seq = 0

export const useUiStore = create<UiState>((set, get) => ({
  page: 'main',
  tab: 'all',
  search: '',
  statusFilter: 'any',
  modals: [],
  setPage: (page) => set({ page }),
  setTab: (tab) => set({ tab }),
  setSearch: (search) => set({ search }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  openModal(spec) {
    const key = ++seq
    set({ modals: [...get().modals, { ...spec, key }] })
    return key
  },
  closeModal(key) {
    const modals = get().modals
    if (!modals.length) return
    set({ modals: key == null ? modals.slice(0, -1) : modals.filter((m) => m.key !== key) })
  },
  closeModalsOfType: (type) => set({ modals: get().modals.filter((m) => m.type !== type) }),
  isOpen: (type) => get().modals.some((m) => m.type === type)
}))

export const uiStore = () => useUiStore.getState()
