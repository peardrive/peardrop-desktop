import { describe, expect, it } from 'vitest'
import {
  baseTitle,
  deriveStatus,
  displayTitle,
  driveMatches,
  isClearable,
  matchingFileCount,
  menuItems,
  rowActions,
  sortDrives,
  statusForResumeError,
  statusPresentation,
  toDriveView,
  typePrefix,
  type DriveView
} from './drive-model'

const view = (over: Partial<DriveView> = {}): DriveView => ({
  id: 'd',
  name: 'file.mp4',
  kind: 'share',
  status: 'sharing',
  progress: null,
  speed: 0,
  peers: 0,
  size: 10,
  files: [{ name: 'file.mp4', size: 10, path: '/x/file.mp4' }],
  addedAt: 1,
  ...over
})
const none = new Set<string>()

describe('deriveStatus', () => {
  it('shares are initiating until announced', () => {
    expect(deriveStatus({ id: 'a', state: 'active', isUpload: true }, none)).toBe('initiating')
    expect(deriveStatus({ id: 'a', state: 'active', isUpload: true }, new Set(['a']))).toBe('sharing')
  })
  it('a seeking download is an interrupted download', () => {
    expect(deriveStatus({ id: 'a', state: 'seeking', isUpload: false }, none)).toBe('interrupted')
    expect(deriveStatus({ id: 'a', state: 'active', isUpload: false }, none)).toBe('sharing')
  })
  it('paused → inactive, errored → error', () => {
    expect(deriveStatus({ id: 'a', state: 'paused', isUpload: true }, none)).toBe('inactive')
    expect(deriveStatus({ id: 'a', state: 'errored', isUpload: false }, none)).toBe('error')
  })
})

describe('resume errors', () => {
  it('missing storage kills a share but not a download', () => {
    expect(statusForResumeError('Storage directory missing', 'share')).toBe('lost')
    expect(statusForResumeError('Storage directory missing', 'download')).toBe('inactive')
    expect(statusForResumeError('File descriptor could not be locked', 'share')).toBe('inactive')
  })
  it('toDriveView applies the resume error and keeps live counters', () => {
    const v = toDriveView(
      { id: 'a', name: 'x', state: 'active', isUpload: true, files: [], totalBytes: 5 },
      { announced: new Set(['a']), resumeError: { error: 'ENOENT' }, previous: view({ id: 'a', peers: 2, speed: 9 }) }
    )
    expect(v).toMatchObject({ status: 'lost', peers: 2, speed: 9, size: 5 })
  })
})

describe('titles', () => {
  it('legacy "N files" names and nameless groups read "Folder"', () => {
    expect(baseTitle('70 files', 70)).toBe('Folder')
    expect(baseTitle('', 3)).toBe('Folder')
    expect(baseTitle('3 files of mine', 3)).toBe('3 files of mine')
  })
  it('alias wins, and the type prefix ignores it', () => {
    const d = view({ name: 'photos.zip', files: [{ name: 'photos.zip', size: 1 }] })
    expect(displayTitle(d, { d: 'Summer' })).toBe('Summer')
    expect(typePrefix(d)).toBe('Archive')
  })
})

describe('status presentation', () => {
  it('distinguishes Active from actually Sharing', () => {
    expect(statusPresentation(view()).label).toBe('Active')
    expect(statusPresentation(view({ speed: 100 }))).toMatchObject({ label: 'Sharing', tone: 'warning' })
    expect(statusPresentation(view({ status: 'downloading', progress: 0.42 })).label).toBe('Downloading (42%)')
    expect(statusPresentation(view({ status: 'interrupted', progress: 0.3 })).label).toBe('Disconnected at 30%')
  })
})

describe('row actions', () => {
  it('matches the agreed priorities', () => {
    expect(rowActions(view({ status: 'interrupted', kind: 'download' }))).toEqual(['resume', 'cancel'])
    expect(rowActions(view({ status: 'downloading', kind: 'download', progress: 0.1 }))).toEqual(['cancel'])
    expect(rowActions(view({ status: 'lost' }))).toEqual(['reshare', 'clear'])
    expect(rowActions(view({ status: 'unreachable' }))).toEqual(['retry'])
    // A share the user stopped is not a failure.
    expect(rowActions(view({ status: 'inactive', kind: 'share' }))).toEqual(['open'])
    expect(rowActions(view({ status: 'inactive', kind: 'download' }))).toEqual(['retry'])
    expect(rowActions(view({ files: [{ name: 'a', size: 1 }, { name: 'b', size: 1 }] }))).toEqual([])
  })
})

describe('menu', () => {
  it('offers link actions only with a link and stop only while sharing', () => {
    const labels = (d: DriveView, fav = false) => menuItems(d, fav).map((m) => m.action)
    expect(labels(view())).not.toContain('copy-link')
    expect(labels(view({ shareLink: 'peardrop://x' }))).toEqual(expect.arrayContaining(['copy-link', 'show-qr', 'pause', 'remove']))
    expect(labels(view({ status: 'inactive' }))).toContain('resume')
    expect(menuItems(view(), true)[0].label).toBe('Remove from Favorites')
  })
})

describe('search & sort', () => {
  const folder = view({ id: 'f', name: 'Folder', files: [{ name: 'The.Matrix.1080p.mkv', size: 1 }, { name: 'notes.txt', size: 1 }] })
  it('matches every term in any order, including files inside and the original name', () => {
    expect(driveMatches(folder, 'Movies', 'matrix 1080')).toBe(true)
    expect(driveMatches(folder, 'Movies', 'folder')).toBe(true)
    expect(driveMatches(folder, 'Movies', 'zzz')).toBe(false)
    expect(matchingFileCount(folder, 'notes')).toBe(1)
  })
  it('sorts stably by field and direction', () => {
    const a = view({ id: 'a', size: 1, addedAt: 3 })
    const b = view({ id: 'b', size: 3, addedAt: 1 })
    const c = view({ id: 'c', size: 2, addedAt: 2 })
    const ids = (xs: DriveView[]) => xs.map((x) => x.id)
    expect(ids(sortDrives([a, b, c], 'recent', 'desc', (d) => d.id))).toEqual(['a', 'c', 'b'])
    expect(ids(sortDrives([a, b, c], 'size', 'desc', (d) => d.id))).toEqual(['b', 'c', 'a'])
    expect(ids(sortDrives([a, b, c], 'size', 'asc', (d) => d.id))).toEqual(['a', 'c', 'b'])
    expect(ids(sortDrives([b, a, c], 'name', 'desc', (d) => d.id))).toEqual(['a', 'b', 'c'])
  })
  it('never clears something mid-transfer', () => {
    expect(isClearable(view({ status: 'downloading', progress: 0.5 }))).toBe(false)
    expect(isClearable(view({ status: 'complete' }))).toBe(true)
  })
})
