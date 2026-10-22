/**
 * Engine reload from Settings → Network.
 */
import { parseBootstrapList } from '@shared/bootstrap'
import { api } from '../services/client'
import { useSettingsStore } from '../stores/settings-store'
import { toast } from '../stores/toast-store'

/**
 * Restart the transfer engine (Hyperdrive + Hyperswarm instances),
 * optionally switching to a new bootstrap address first.
 * Shares pause briefly and re-announce; in-flight transfers are interrupted
 * and can be resumed.
 */
export async function reloadEngine(bootstrap?: string): Promise<boolean> {
  if (bootstrap !== undefined) {
    const parsed = parseBootstrapList(bootstrap)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return false
    }
  }
  const res = await api().engine.reload(bootstrap !== undefined ? { bootstrap } : {})
  useSettingsStore.getState().setEngine(res.status)
  if (!res.success) {
    toast.error(`Engine reload failed: ${res.error}`)
    return false
  }
  toast.success('Engine reloaded')
  return true
}
