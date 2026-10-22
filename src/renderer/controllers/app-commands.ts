/**
 * Commands from outside the window (the tray menu): main shows the window,
 * then asks for the matching flow here.
 */
import type { AppCommand } from '@shared/ipc'
import { uiStore } from '../stores/ui-store'
import { openSend } from './share'

export function runAppCommand(command: AppCommand): void {
  const ui = uiStore()
  switch (command) {
    case 'send':
      ui.setPage('main')
      if (!ui.isOpen('send')) openSend()
      return
    case 'receive':
      ui.setPage('main')
      if (!ui.isOpen('receive')) ui.openModal({ type: 'receive' })
      return
    case 'settings':
      ui.setPage('settings')
      return
  }
}
