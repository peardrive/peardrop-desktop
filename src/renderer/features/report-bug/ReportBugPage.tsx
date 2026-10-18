/**
 * ReportBugPage — full-page route (Figma #25). There is no submission
 * endpoint yet, so instead of pretending to send, it assembles an honest
 * report (description, where, device info and the recent redacted log) and
 * copies it to the clipboard, ready to paste into a chat or issue.
 *
 * @example setPage('report-bug')
 */
import { useEffect, useState } from 'react'
import { api } from '../../services/client'
import { useSettingsStore } from '../../stores/settings-store'
import { toast } from '../../stores/toast-store'
import { useUiStore } from '../../stores/ui-store'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../components/ui/Icon'
import { Switch } from '../../components/ui/Switch'
import { TextField } from '../../components/ui/TextField'
import { PageHeader, SettingsRow, SettingsSection } from '../settings/SettingsLayout'

const MAX = 500

export default function ReportBugPage() {
  const info = useSettingsStore((s) => s.appInfo)
  const engine = useSettingsStore((s) => s.engine)
  const setPage = useUiStore((s) => s.setPage)
  const [text, setText] = useState('')
  const [where, setWhere] = useState('')
  const [attach, setAttach] = useState(true)
  const [logPath, setLogPath] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api().logs.path().then(setLogPath).catch(() => undefined)
  }, [])

  const copyReport = async () => {
    setBusy(true)
    try {
      const parts = [`## ${info?.identity.productName ?? 'PearDrop'} bug report`, '', text.trim() || '(no description)', '']
      if (where.trim()) parts.push(`**Where:** ${where.trim()}`, '')
      if (attach && info) {
        parts.push(
          `**App:** v${info.version}${info.profile ? ` (profile ${info.profile})` : ''}`,
          `**System:** ${info.platform} ${info.arch} · Electron ${info.versions.electron}`,
          `**Engine:** ${engine?.backendLabel ?? '?'} — ${engine?.phase ?? '?'}${engine?.bootstrap.length ? ' · custom bootstrap' : ''}`,
          ''
        )
        const tail = await api().logs.tail(300)
        if (tail.success && tail.text) parts.push('<details><summary>Recent log (redacted)</summary>', '', '```', tail.text, '```', '</details>')
      }
      await navigator.clipboard.writeText(parts.join('\n'))
      toast.success('Report copied — paste it into a message or issue')
    } catch {
      toast.error('Could not copy the report')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl pb-16">
      <PageHeader title="Report a bug" onBack={() => setPage('settings')} />
      <div className="px-8">
        <div className="relative mt-2">
          <textarea
            value={text}
            maxLength={MAX}
            onChange={(e) => setText(e.target.value)}
            placeholder="Describe what happened…"
            className="h-40 w-full resize-none rounded-2xl border-2 border-line bg-field px-4 py-3 text-sm text-fg placeholder:text-subtle focus:border-accent/70 focus:outline-none"
          />
          <span className="tabular absolute bottom-3 right-4 text-xs text-subtle">
            {text.length}/{MAX}
          </span>
        </div>
        <TextField className="mt-3" containerClassName="mt-3" value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Where did it happen? (e.g. sending a folder)" />

        <SettingsSection title="Include">
          <SettingsRow
            icon="monitor"
            label="Attach device info and recent log"
            description={
              info && (
                <span className="flex flex-wrap gap-2 pt-1">
                  <span className="rounded-full bg-fg/10 px-2 py-0.5 text-xs font-semibold">v{info.version}</span>
                  <span className="rounded-full bg-fg/10 px-2 py-0.5 text-xs font-semibold">
                    {info.platform === 'win32' ? 'Windows' : info.platform === 'darwin' ? 'macOS' : 'Linux'}
                  </span>
                </span>
              )
            }
            control={<Switch label="Attach device info" checked={attach} onChange={setAttach} />}
          />
          <SettingsRow
            icon="log"
            label="Diagnostics log"
            description={<span className="select-text break-all font-mono text-xs">{logPath}</span>}
            control={
              <Button size="sm" variant="secondary" onClick={() => void api().logs.reveal()}>
                Show log file
              </Button>
            }
          />
        </SettingsSection>

        <Button variant="primary" size="lg" block className="mt-8" leading={<Icon name="copy" />} loading={busy} onClick={() => void copyReport()}>
          Copy report to clipboard
        </Button>
        <p className="mt-3 text-center text-xs text-subtle">Nothing is sent automatically. Logs never contain share keys or your home folder path.</p>
      </div>
    </div>
  )
}
