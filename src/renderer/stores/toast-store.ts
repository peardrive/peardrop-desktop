/**
 * Transient notifications: short status toasts (bottom-centre) and the
 * download-complete card (bottom-right, with a "Show" action).
 */
import { create } from 'zustand'

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface DownloadNotice {
  id: number
  title: string
  subtitle: string
  path: string | null
}

interface ToastState {
  toasts: Toast[]
  downloadNotice: DownloadNotice | null
  push(message: string, kind?: ToastKind, ttlMs?: number): void
  dismiss(id: number): void
  showDownloadNotice(n: Omit<DownloadNotice, 'id'>): void
  hideDownloadNotice(): void
}

let seq = 0
let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  downloadNotice: null,
  push(message, kind = 'info', ttlMs = 3000) {
    const id = ++seq
    // One message at a time reads better than a growing pile.
    set({ toasts: [...get().toasts.slice(-2), { id, kind, message }] })
    setTimeout(() => get().dismiss(id), ttlMs)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  showDownloadNotice(n) {
    if (noticeTimer) clearTimeout(noticeTimer)
    set({ downloadNotice: { ...n, id: ++seq } })
    noticeTimer = setTimeout(() => set({ downloadNotice: null }), 6000)
  },
  hideDownloadNotice: () => set({ downloadNotice: null })
}))

/** Imperative helpers for controllers. */
export const toast = {
  info: (m: string) => useToastStore.getState().push(m, 'info'),
  success: (m: string) => useToastStore.getState().push(m, 'success'),
  error: (m: string) => useToastStore.getState().push(m, 'error', 4500)
}
