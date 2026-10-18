/**
 * Typed wrappers around ipcMain / webContents.send bound to the contract in
 * @shared/ipc, so a handler's arguments and return type are checked against
 * the same map the preload uses.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import type { IpcArgs, IpcChannel, IpcPushChannel, IpcPushMap, IpcResult } from '@shared/ipc'
import type { Logger } from '../logger'

export function handle<C extends IpcChannel>(
  channel: C,
  fn: (...args: IpcArgs<C>) => Promise<IpcResult<C>> | IpcResult<C>,
  log?: Logger
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as IpcArgs<C>))
    } catch (err) {
      log?.error(`IPC ${channel} failed`, err)
      throw err
    }
  })
}

export function push<C extends IpcPushChannel>(win: BrowserWindow | null, channel: C, payload: IpcPushMap[C]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
}
