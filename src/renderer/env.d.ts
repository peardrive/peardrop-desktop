/// <reference types="vite/client" />
import type { PeardropApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Exposed by src/preload. Absent when the UI runs in a plain browser (mock client is used). */
    peardrop?: PeardropApi
  }
}

export {}
