/**
 * SettingsPage — full-page route (Figma #24): app identity, appearance
 * (theme), network/engine, storage locations, diagnostics, support, about.
 *
 * @example setPage('settings')
 */
import { useState } from 'react'
import { api } from '../../services/client'
import { toast } from '../../stores/toast-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../../components/ui/Button'
import { Switch } from '../../components/ui/Switch'
import { NetworkSettings } from './NetworkSettings'
import { PageHeader, SettingsRow, SettingsSection } from './SettingsLayout'
import { ThemePicker } from './ThemePicker'

function PathValue({ path }: { path: string | undefined }) {
  return <span className="select-text break-all font-mono text-xs">{path ?? '—'}</span>
}

export default function SettingsPage() {
  const info = useSettingsStore((s) => s.appInfo)
  const debug = useSettingsStore((s) => s.preferences.diagnostics.debug)
  const update = useSettingsStore((s) => s.updatePreferences)
  const setPage = useUiStore((s) => s.setPage)
  const [copying, setCopying] = useState(false)

  const copyLogTail = async () => {
    setCopying(true)
    try {
      const res = await api().logs.tail(300)
      if (!res.success || !res.text) return toast.error(res.error || 'Could not read the log')
      await navigator.clipboard.writeText(res.text)
      toast.success('Last 300 log lines copied')
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Settings" onBack={() => setPage('main')} />
      <div className="px-8">
        <div className="mt-2 flex items-center gap-4 rounded-2xl bg-fg/[0.035] p-4">
          {info?.iconDataUrl ? <img src={info.iconDataUrl} alt="" className="h-16 w-16 rounded-2xl" /> : <div className="h-16 w-16 rounded-2xl bg-accent/20" />}
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold">{info?.identity.productName ?? 'PearDrop'}</div>
            <div className="text-sm text-muted">{info?.identity.description}</div>
            <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-subtle">
              <span>v{info?.version}</span>
              {info?.profile && <span className="rounded-full bg-warning/15 px-2 text-warning">profile: {info.profile}</span>}
              {info?.isDev && <span className="rounded-full bg-info/15 px-2 text-info">development</span>}
            </div>
          </div>
        </div>

        <SettingsSection title="Appearance">
          <SettingsRow icon="palette" label="Theme" description="Applies to every screen instantly." stacked control={<ThemePicker />} />
        </SettingsSection>

        <NetworkSettings />

        <SettingsSection title="Storage" description="Shared files stay where they are on your computer; only received files are stored here.">
          <SettingsRow
            icon="folder-outline"
            label="Downloads"
            description={<PathValue path={info?.paths.downloads} />}
            control={
              <Button size="sm" variant="secondary" onClick={() => void api().files.openDownloads()}>
                Open
              </Button>
            }
          />
          <SettingsRow
            icon="shield"
            label="Data folder"
            description={<PathValue path={info?.paths.root} />}
            control={
              <Button size="sm" variant="secondary" onClick={() => info && void api().files.reveal(info.paths.preferences)}>
                Show
              </Button>
            }
          />
        </SettingsSection>

        <SettingsSection title="Diagnostics" description="A log of the last 14 days is always kept. Keys and your home folder are redacted before anything is written.">
          <SettingsRow
            icon="terminal"
            label="Verbose console output"
            description="Also echo debug-level lines to the terminal (the log file records them either way)."
            control={<Switch label="Verbose console output" checked={debug} onChange={(v) => void update({ diagnostics: { debug: v } })} />}
          />
          <SettingsRow
            icon="log"
            label="Log files"
            description={<PathValue path={info?.paths.logs} />}
            control={
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" loading={copying} onClick={() => void copyLogTail()}>
                  Copy last 300 lines
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void api().logs.reveal()}>
                  Show
                </Button>
              </div>
            }
          />
        </SettingsSection>

        <SettingsSection title="Support">
          <SettingsRow icon="bug" label="Report a bug" onClick={() => setPage('report-bug')} />
          <SettingsRow
            icon="info"
            label="About"
            description={
              info && (
                <>
                  {info.identity.productName} {info.version} · Electron {info.versions.electron} · Chromium {info.versions.chrome} · Node {info.versions.node} ·{' '}
                  {info.platform} {info.arch}
                  <br />
                  {info.identity.copyright}
                </>
              )
            }
          />
        </SettingsSection>
      </div>
    </div>
  )
}
