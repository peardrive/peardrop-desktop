/**
 * Commands from outside the page: the tray menu (main shows the window, then
 * asks for the matching flow here) and Cmd/Ctrl + / − / 0 (interface size).
 */
import type { AppCommand } from '@shared/ipc'
import { uiStore } from '../stores/ui-store'
import { openSend } from './share'
import { setUiScaleStep, stepUiScale } from './ui-scale'
import { UI_SCALE_DEFAULT_STEP } from '@shared/ui-scale'

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
    case 'ui-scale-up':
      return stepUiScale(1)
    case 'ui-scale-down':
      return stepUiScale(-1)
    case 'ui-scale-reset':
      return setUiScaleStep(UI_SCALE_DEFAULT_STEP)
  }
}
