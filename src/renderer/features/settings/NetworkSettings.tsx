/**
 * NetworkSettings — engine status, custom DHT bootstrapper and "Reload
 * engine" (restarts the Hyperdrive + Hyperswarm instances).
 *
 * The bootstrap field accepts "host:port" (or a comma-separated list), is
 * validated live with the same parser main uses, and is applied by
 * reloading the engine. Empty = public DHT. When `npm run dev` sets
 * PEARDROP_BOOTSTRAP, that override is shown and wins.
 *
 * @example <NetworkSettings />
 */
import { useEffect, useState } from 'react'
import { formatBootstrapList, LOCAL_BOOTSTRAP, parseBootstrapList } from '@shared/bootstrap'
import { reloadEngine } from '../../controllers/engine'
import { timeAgo } from '../../lib/format'
import { useDrivesStore } from '../../stores/drives-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { TextField } from '../../components/ui/TextField'
import { EngineStatusBadge } from './EngineStatusBadge'
import { SettingsRow, SettingsSection } from './SettingsLayout'

/** Ask before interrupting transfers that are moving right now. */
function confirmReload(run: () => void) {
  const busy = Object.values(useDrivesStore.getState().drives).filter((d) => d.status === 'downloading' || (d.status === 'sharing' && d.speed > 0)).length
  if (!busy) return run()
  useUiStore.getState().openModal({
    type: 'confirm',
    title: 'Reload the engine now?',
    message: `${busy} transfer${busy !== 1 ? 's are' : ' is'} in progress. They will be interrupted and can be resumed after the reload.`,
    buttons: [{ label: 'Not now', variant: 'secondary' }, { label: 'Reload', variant: 'danger', onSelect: run }]
  })
}

export function NetworkSettings() {
  const engine = useSettingsStore((s) => s.engine)
  const saved = useSettingsStore((s) => s.preferences.network.bootstrap)
  const [value, setValue] = useState(saved)
  const [busy, setBusy] = useState(false)
  useEffect(() => setValue(saved), [saved])

  const parsed = parseBootstrapList(value)
  const dirty = value.trim() !== saved.trim()
  const reloading = busy || engine?.phase === 'reloading' || engine?.phase === 'starting'

  const run = (bootstrap?: string) =>
    confirmReload(async () => {
      setBusy(true)
      try {
        await reloadEngine(bootstrap)
      } finally {
        setBusy(false)
      }
    })

  const inUse = engine?.bootstrap.length ? formatBootstrapList(engine.bootstrap) : 'Public DHT'
  const source = engine?.bootstrapSource === 'environment' ? 'set by PEARDROP_BOOTSTRAP' : engine?.bootstrapSource === 'preferences' ? 'custom' : 'default'

  return (
    <SettingsSection title="Network" description="PearDrop finds peers through the Hyperswarm DHT. Point it at your own bootstrapper for local testing.">
      <SettingsRow
        icon="network"
        label="Transfer engine"
        description={
          engine ? (
            <>
              {engine.backendLabel} · {inUse} <span className="text-subtle">({source})</span>
              {engine.startedAt && engine.phase === 'ready' && <> · up {timeAgo(engine.startedAt).replace(' ago', '')}</>}
              {engine.phase === 'ready' && (
                <>
                  {' '}
                  · {engine.stats.drives} drive{engine.stats.drives !== 1 ? 's' : ''}, {engine.stats.active} open
                </>
              )}
              {engine.error && <span className="block text-danger">{engine.error}</span>}
            </>
          ) : (
            'Loading…'
          )
        }
        control={engine && <EngineStatusBadge phase={busy ? 'reloading' : engine.phase} />}
      />
      <SettingsRow
        icon="server"
        stacked
        label="Bootstrap node"
        description={
          engine?.envBootstrap ? (
            <span className="text-warning">
              Overridden by the environment ({engine.envBootstrap}) — this value applies when started without it (npm run app).
            </span>
          ) : (
            <>
              Leave empty for the public DHT. Start a local one with <code className="rounded bg-fg/10 px-1">npm run bootstrap</code>.
            </>
          )
        }
        control={
          <div className="flex flex-col gap-2">
            <TextField
              value={value}
              placeholder="host:port — e.g. 192.168.1.23:49737"
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && dirty && parsed.ok && run(value)}
              state={!value.trim() ? 'default' : parsed.ok ? 'valid' : 'invalid'}
              leadingIcon="link"
              className="font-mono"
            />
            <div className="flex min-h-[20px] items-center justify-between gap-3 px-1 text-xs">
              <span className={parsed.ok ? 'text-muted' : 'font-semibold text-danger'}>
                {parsed.ok ? (parsed.nodes.length ? `${parsed.nodes.length} node${parsed.nodes.length > 1 ? 's' : ''}` : 'Public DHT') : parsed.error}
              </span>
              <span className="flex gap-3">
                <button type="button" className="font-bold text-accent-strong hover:underline" onClick={() => setValue(LOCAL_BOOTSTRAP)}>
                  Use local ({LOCAL_BOOTSTRAP})
                </button>
                {value && (
                  <button type="button" className="font-bold text-muted hover:text-fg" onClick={() => setValue('')}>
                    Clear
                  </button>
                )}
              </span>
            </div>
            <div className="flex flex-wrap gap-3 pt-1">
              <Button variant="primary" size="sm" disabled={!dirty || !parsed.ok || reloading} loading={busy && dirty} onClick={() => run(value)}>
                Save & reload engine
              </Button>
              <Button variant="secondary" size="sm" leading={<Icon name="refresh" />} disabled={reloading} loading={busy && !dirty} onClick={() => run()}>
                Reload engine
              </Button>
            </div>
          </div>
        }
      />
    </SettingsSection>
  )
}
