/** Typed view of engine/downloader.js. */
export interface DownloaderProgress {
  percent: number
  bytesTransferred: number
  totalBytes: number
  speed: number
  bytesFormatted: string
  totalFormatted: string
  speedFormatted: string
}
export interface DownloadedFile {
  name: string
  path: string
  size: number
  key?: string
}
export interface DownloadFromDriveOptions {
  destDir: string
  resumePaths?: Record<string, string> | null
  resumeRoot?: string | null
  totalBytes?: number
  shareName?: string | null
  fileNames?: string[]
  onPeerConnected?: (data: { shareName?: string; totalBytes?: number }) => void
  onProgress?: (data: DownloaderProgress) => void
  onComplete?: (data: { totalBytes: number; duration: number }) => void
  onError?: (data: { file: string; error: string }) => void
  isCancelled?: () => boolean
  onRoot?: (root: string, isOwnFolder: boolean) => void
  registerAborter?: (fn: () => void) => void
}
export interface DownloadFromDriveResult {
  files: DownloadedFile[]
  failed: Array<{ key: string; error: string }>
  totalBytes: number
  duration: number
  destDir: string
}
export function downloadFromDrive(drive: unknown, options: DownloadFromDriveOptions): Promise<DownloadFromDriveResult>
