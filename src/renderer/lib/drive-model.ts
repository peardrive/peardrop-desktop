/**
 * The UI's model of a drive card, and every rule that decides how a card
 * looks and what it offers. Pure functions only — unit tested in
 * drive-model.test.ts — so components stay declarative.
 *
 * These rules are ported from the pre-React renderer, including the
 * reasoning behind them (kept as comments where it isn't obvious).
 */
import type { ReceiveTaskPhase } from '@shared/receive'
import type { DriveFile, DriveRecord } from '@shared/transfer'
import { CATEGORY_LABEL, categoryOf } from './file-types'

/**
 * Display status of a card.
 * - sharing      announced & reachable ("Active"), or serving bytes
 * - initiating   open locally, DHT announce not landed yet
 * - unreachable  announce never landed / failed
 * - downloading  our download is moving
 * - connecting   looking for the sender
 * - interrupted  download started and stopped (sender left / app closed)
 * - complete     finished, not seeding
 * - inactive     stopped share, or a drive that failed to resume
 * - error        failed
 * - missing      local files gone from disk
 * - lost         a share whose storage is gone (its link is dead for good)
 */
export type DriveStatus =
  | 'sharing'
  | 'initiating'
  | 'unreachable'
  | 'downloading'
  | 'connecting'
  | 'interrupted'
  | 'complete'
  | 'inactive'
  | 'error'
  | 'missing'
  | 'lost'

export type DriveKind = 'share' | 'download'

export interface DriveView {
  id: string
  /** Name the engine stored (never an alias). */
  name: string
  kind: DriveKind
  status: DriveStatus
  /** 0..1 while transferring, null otherwise. */
  progress: number | null
  /** Bytes/second; 0 when idle. */
  speed: number
  peers: number
  size: number
  files: DriveFile[]
  shareLink?: string
  localPath?: string | null
  addedAt: number | null
  /** Placeholder row for a pasted link whose sender has not been reached yet. */
  isPlaceholder?: boolean
  /** Placeholder only: where the receive queue stands with it. */
  receive?: { phase: ReceiveTaskPhase; attempts: number; nextAttemptAt: number | null; lastError: string | null }
}

export type Tone = 'success' | 'warning' | 'danger' | 'muted'

// ─── titles ───────────────────────────────────────────────────────────────

const LEGACY_MULTI_FILE_NAME = /^\d+\s+files?$/i
export const FOLDER_PLACEHOLDER = 'Folder'

/**
 * The name a card shows with no alias. Old builds stored "70 files" as the
 * name of multi-file shares; those display as "Folder" without rewriting
 * what the engine stored.
 */
export function baseTitle(name: string | null | undefined, fileCount: number): string {
  const n = String(name ?? '').trim()
  if (LEGACY_MULTI_FILE_NAME.test(n)) return FOLDER_PLACEHOLDER
  if (fileCount > 1 && (!n || n === 'Unknown')) return FOLDER_PLACEHOLDER
  return n || 'Untitled'
}

/** Alias > "Folder" placeholder > stored name. */
export function displayTitle(drive: Pick<DriveView, 'id' | 'name' | 'files'>, aliases: Record<string, string>): string {
  return aliases[drive.id] || baseTitle(drive.name, drive.files.length)
}

export const isGroup = (d: Pick<DriveView, 'files'>) => d.files.length > 1

// ─── status derivation ────────────────────────────────────────────────────

/**
 * Engine `state` → card status.
 * 'paused' is an engine state; from the user's side a stopped share and a
 * share that failed to come back are the same thing ("Inactive").
 * For a download, 'seeking' marks a transfer that started and never
 * finished — that is precisely "interrupted" (Resume continues it).
 * An 'active' share is only "sharing" once its DHT announce has landed.
 */
export function deriveStatus(record: Pick<DriveRecord, 'id' | 'state' | 'isUpload'>, announced: ReadonlySet<string>): DriveStatus {
  const { state } = record
  if (state === 'paused') return 'inactive'
  if (state === 'errored') return 'error'
  if (!record.isUpload) {
    if (state === 'seeking') return 'interrupted'
    if (state === 'active') return 'sharing'
    return 'inactive'
  }
  if (state !== 'active') return 'inactive'
  return announced.has(record.id) ? 'sharing' : 'initiating'
}

/**
 * A failed resume: "Storage directory missing" means the drive's data is
 * gone (a share's link is dead → 'lost'; a download's files usually still
 * exist → 'inactive'). Anything else (e.g. a locked corestore) is transient.
 */
export function statusForResumeError(reason: string | null | undefined, kind: DriveKind): DriveStatus {
  const dataGone = /storage directory missing|no such file|ENOENT/i.test(String(reason ?? ''))
  if (!dataGone) return 'inactive'
  return kind === 'download' ? 'inactive' : 'lost'
}

/** Engine record → card model. */
export function toDriveView(
  record: DriveRecord,
  opts: { announced: ReadonlySet<string>; resumeError?: { error: string } | null; previous?: DriveView | null }
): DriveView {
  const kind: DriveKind = record.isUpload ? 'share' : 'download'
  let status = deriveStatus(record, opts.announced)
  if (opts.resumeError) status = statusForResumeError(opts.resumeError.error, kind)
  const prev = opts.previous
  return {
    id: record.id,
    name: record.name,
    kind,
    status,
    progress: prev?.progress ?? null,
    speed: prev?.speed ?? 0,
    peers: prev?.peers ?? 0,
    size: record.totalBytes || record.files.reduce((n, f) => n + (f.size || 0), 0),
    files: record.files,
    shareLink: record.shareLink,
    localPath: record.localPath ?? null,
    addedAt: record.createdAt ?? prev?.addedAt ?? null
  }
}

// ─── presentation ─────────────────────────────────────────────────────────

const pct = (d: Pick<DriveView, 'progress'>) => (d.progress != null ? Math.round(d.progress * 100) : null)

/** Text + tone of the status line ("Downloading (42%)", "Active", …). */
export function statusPresentation(d: Pick<DriveView, 'status' | 'progress' | 'speed' | 'receive'>): { label: string; tone: Tone; moving: boolean } {
  const p = pct(d)
  if (d.receive) {
    return d.receive.phase === 'searching'
      ? { label: 'Looking for sender…', tone: 'warning', moving: false }
      : { label: 'Waiting for sender', tone: 'warning', moving: false }
  }
  switch (d.status) {
    case 'downloading':
      return { label: p != null ? `Downloading (${p}%)` : 'Downloading', tone: 'warning', moving: true }
    case 'sharing':
      if (p != null && p < 100) return { label: `Sharing (${p}%)`, tone: 'warning', moving: true }
      // Bytes leaving right now is a stronger claim than "available".
      if (d.speed > 0) return { label: 'Sharing', tone: 'warning', moving: true }
      return { label: 'Active', tone: 'success', moving: true }
    case 'complete':
      return { label: 'Completed', tone: 'success', moving: false }
    case 'connecting':
      return { label: 'Connecting', tone: 'warning', moving: false }
    case 'initiating':
      return { label: 'Initiating', tone: 'warning', moving: false }
    case 'interrupted':
      return { label: p != null ? `Disconnected at ${p}%` : 'Disconnected', tone: 'warning', moving: false }
    case 'unreachable':
      return { label: 'Not reachable', tone: 'danger', moving: false }
    case 'lost':
      return { label: 'Share lost', tone: 'danger', moving: false }
    case 'missing':
      return { label: 'Files removed', tone: 'danger', moving: false }
    case 'error':
      return { label: 'Failed', tone: 'danger', moving: false }
    case 'inactive':
    default:
      return { label: 'Inactive', tone: 'danger', moving: false }
  }
}

/** The real file name behind a card (never an alias) — what the type is judged by. */
export const sourceName = (d: Pick<DriveView, 'files' | 'name'>) => (d.files.length === 1 ? d.files[0].name : d.name)

/** "Picture" / "Video" prefix — only on healthy single-file cards. */
export function typePrefix(d: Pick<DriveView, 'status' | 'files' | 'name'>): string | null {
  if (isGroup(d)) return null
  if (d.status !== 'sharing' && d.status !== 'complete') return null
  return CATEGORY_LABEL[categoryOf(sourceName(d))]
}

/** True while bytes are (or are about to be) moving and the X cancels them. */
export function isInFlight(d: Pick<DriveView, 'status' | 'progress'>): boolean {
  const p = pct(d)
  return d.status === 'downloading' || d.status === 'connecting' || d.status === 'interrupted' || (d.status === 'sharing' && p != null && p < 100)
}

export type RowAction = 'resume' | 'cancel' | 'retry' | 'open' | 'reshare' | 'clear' | 'search'

/**
 * The inline buttons right of a card (before the ⋮ menu):
 * queued link → ⟳ look now + ✕ forget · interrupted → ▶ resume + ✕ cancel · in flight → ✕ cancel ·
 * failed → Retry (Resume for a partial download) · lost share → Share + Clear ·
 * folder → none (click opens it) · otherwise → Open.
 * A stopped SHARE is not a failure, so it gets Open, not Retry.
 */
export function rowActions(d: Pick<DriveView, 'status' | 'progress' | 'kind' | 'files' | 'receive'>): RowAction[] {
  const p = pct(d)
  // A queued link: "look now" while it waits for the next attempt, ✕ forgets it.
  if (d.receive) return d.receive.phase === 'waiting' ? ['search', 'cancel'] : ['cancel']
  if (d.status === 'interrupted') return ['resume', 'cancel']
  if (d.status === 'downloading' || d.status === 'connecting' || (d.status === 'sharing' && p != null && p < 100)) return ['cancel']
  if (d.status === 'lost') return ['reshare', 'clear']
  const stoppedShare = d.status === 'inactive' && d.kind !== 'download'
  if (!stoppedShare && (d.status === 'error' || d.status === 'inactive' || d.status === 'missing' || d.status === 'unreachable')) return ['retry']
  if (isGroup(d)) return []
  return ['open']
}

export type MenuAction =
  | 'favorite'
  | 'copy-link'
  | 'show-qr'
  | 'rename'
  | 'properties'
  | 'view-files'
  | 'show-in-folder'
  | 'resume'
  | 'pause'
  | 'remove'

export interface MenuItemSpec {
  action: MenuAction
  label: string
  danger?: boolean
  /** Visually separate from the item above. */
  divider?: boolean
}

/** The ⋮ menu for a card, in reading order (Figma screen #18). */
export function menuItems(d: DriveView, favorite: boolean): MenuItemSpec[] {
  const items: MenuItemSpec[] = [{ action: 'favorite', label: favorite ? 'Remove from Favorites' : 'Add to Favorites' }]
  if (d.shareLink) {
    items.push({ action: 'copy-link', label: 'Copy Link' }, { action: 'show-qr', label: 'Show QR' })
  }
  items.push({ action: 'rename', label: 'Rename' }, { action: 'properties', label: 'Properties' })
  if (isGroup(d)) items.push({ action: 'view-files', label: 'Show Files' })
  if (d.files.some((f) => f.path)) items.push({ action: 'show-in-folder', label: 'Show in Folder' })
  const control: MenuItemSpec[] = []
  if (d.status === 'error' || d.status === 'inactive') control.push({ action: 'resume', label: d.kind === 'download' ? 'Resume seeding' : 'Resume sharing' })
  if (d.status === 'sharing') control.push({ action: 'pause', label: 'Stop sharing', danger: true })
  control.push({ action: 'remove', label: 'Remove', danger: true })
  control[0] = { ...control[0], divider: true }
  return [...items, ...control]
}

/** Status shown in File Info: Sharing (peer connected) / Active / Inactive. */
export function networkStatus(d: Pick<DriveView, 'status' | 'peers'>, livePeers: number): 'Sharing' | 'Active' | 'Inactive' {
  const onNetwork = d.status === 'sharing' || d.status === 'downloading' || d.status === 'connecting' || d.status === 'complete'
  if (!onNetwork) return 'Inactive'
  return livePeers > 0 || d.peers > 0 ? 'Sharing' : 'Active'
}

// ─── search & sort ────────────────────────────────────────────────────────

const terms = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Every whitespace-separated term must appear (order-independent). */
export function nameMatches(name: string | null | undefined, query: string): boolean {
  const t = terms(query)
  if (!t.length) return true
  const hay = String(name ?? '').toLowerCase()
  return t.every((term) => hay.includes(term))
}

/**
 * A card matches on its shown name, its original name (a rename is a label,
 * not a disguise) and the names of files inside it.
 */
export function driveMatches(d: Pick<DriveView, 'name' | 'files'>, title: string, query: string): boolean {
  const t = terms(query)
  if (!t.length) return true
  const hay = [title, d.name, ...d.files.map((f) => f.name)].filter(Boolean).join(' | ').toLowerCase()
  return t.every((term) => hay.includes(term))
}

/** How many files inside match (for the card's "N Files" while searching). */
export function matchingFileCount(d: Pick<DriveView, 'files'>, query: string): number {
  if (!terms(query).length) return d.files.length
  return d.files.filter((f) => nameMatches(f.name, query)).length
}

const STATUS_PRIORITY: Record<DriveStatus, number> = {
  downloading: 1,
  connecting: 2,
  interrupted: 3,
  initiating: 4,
  sharing: 5,
  complete: 6,
  inactive: 7,
  unreachable: 8,
  missing: 9,
  lost: 10,
  error: 11
}

export type SortField = 'recent' | 'status' | 'size' | 'name' | 'peers' | 'filetype'

/** Stable sort; `desc` is each field's natural order (newest, largest, A→Z …). */
export function sortDrives<T extends DriveView>(drives: T[], field: SortField, direction: 'asc' | 'desc', titleOf: (d: T) => string): T[] {
  const cmp = (a: T, b: T): number => {
    switch (field) {
      case 'recent':
        return (b.addedAt ?? 0) - (a.addedAt ?? 0)
      case 'status':
        return STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      case 'size':
        return b.size - a.size
      case 'name':
        return titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base', numeric: true })
      case 'peers':
        return b.peers - a.peers
      case 'filetype':
        return (isGroup(a) ? '' : categoryOf(sourceName(a))).localeCompare(isGroup(b) ? '' : categoryOf(sourceName(b)))
    }
  }
  return drives
    .map((d, i) => [d, i] as const)
    .sort(([a, ia], [b, ib]) => (direction === 'asc' ? -cmp(a, b) : cmp(a, b)) || ia - ib)
    .map(([d]) => d)
}

/** Files a "Clear completed" sweep would remove (nothing mid-transfer). */
export function isClearable(d: DriveView): boolean {
  if (isInFlight(d) || d.isPlaceholder) return false
  return ['complete', 'sharing', 'error', 'inactive', 'missing', 'lost', 'unreachable'].includes(d.status)
}
