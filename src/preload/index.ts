/**
 * Preload: exposes the typed `PeardropApi` (see @shared/ipc) as
 * `window.peardrop`. This is the renderer's only door into the main process;
 * Node and ipcRenderer themselves are never exposed.
 */
import * as electron from 'electron'
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcArgs, IpcChannel, IpcPushChannel, IpcPushMap, IpcResult, PeardropApi } from '@shared/ipc'

const invoke = <C extends IpcChannel>(channel: C, ...args: IpcArgs<C>): Promise<IpcResult<C>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<C>>

function subscribe<C extends IpcPushChannel>(channel: C, cb: (payload: IpcPushMap[C]) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: IpcPushMap[C]) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: PeardropApi = {
  transfers: {
    snapshot: () => invoke('transfers:snapshot'),
    share: (req) => invoke('transfers:share', req),
    cancelShare: (id) => invoke('transfers:cancel-share', id),
    checkLink: (link) => invoke('transfers:check-link', link),
    open: (link, opts) => invoke('transfers:open', link, opts),
    download: (req) => invoke('transfers:download', req),
    cancelDownload: (id) => invoke('transfers:cancel-download', id),
    get: (id) => invoke('transfers:get', id),
    pause: (id) => invoke('transfers:pause', id),
    resume: (id) => invoke('transfers:resume', id),
    remove: (id, opts) => invoke('transfers:remove', id, opts),
    onEvent: (cb) => subscribe('transfers:event', cb)
  },
  files: {
    stat: (paths) => invoke('files:stat', paths),
    exists: (paths) => invoke('files:exists', paths),
    open: (p) => invoke('files:open', p),
    reveal: (p) => invoke('files:reveal', p),
    openDownloads: () => invoke('files:open-downloads'),
    thumbnail: (p) => invoke('files:thumbnail', p),
    pick: () => invoke('files:pick'),
    // Electron ≥29 removed File.path in favour of webUtils.getPathForFile.
    pathForFile: (file) => {
      const webUtils = (electron as { webUtils?: { getPathForFile?: (f: File) => string } }).webUtils
      const viaUtils = webUtils?.getPathForFile
      return viaUtils ? viaUtils(file) : ((file as File & { path?: string }).path ?? '')
    }
  },
  qr: { generate: (text) => invoke('qr:generate', text) },
  app: { info: () => invoke('app:info') },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    onChange: (cb) => subscribe('settings:changed', cb)
  },
  library: {
    get: () => invoke('library:get'),
    setFavorite: (id, fav) => invoke('library:set-favorite', id, fav),
    setAlias: (id, alias) => invoke('library:set-alias', id, alias),
    forget: (id) => invoke('library:forget', id),
    import: (data) => invoke('library:import', data)
  },
  engine: {
    status: () => invoke('engine:status'),
    reload: (req) => invoke('engine:reload', req),
    onStatus: (cb) => subscribe('engine:status', cb)
  },
  logs: {
    path: () => invoke('logs:path'),
    reveal: () => invoke('logs:reveal'),
    tail: (lines) => invoke('logs:tail', lines),
    write: (entry) => invoke('logs:write', entry)
  }
}

contextBridge.exposeInMainWorld('peardrop', api)
