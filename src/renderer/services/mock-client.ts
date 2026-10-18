/**
 * In-memory PeardropClient for running the renderer in a plain browser
 * (UI work, screenshots, tests). It simulates a small library, share builds
 * with progress, a download, announces and the engine reload — enough to
 * exercise every screen without Electron or a network.
 *
 * Never used inside Electron: main.tsx only falls back to it when
 * `window.peardrop` is missing.
 */
import { formatBootstrapList, parseBootstrapList } from '@shared/bootstrap'
import type { EngineStatus } from '@shared/engine'
import type { PeardropApi } from '@shared/ipc'
import { EMPTY_LIBRARY, type LibraryData } from '@shared/library'
import { DEFAULT_PREFERENCES, mergePreferences, type Preferences } from '@shared/preferences'
import type { DriveRecord, TransferEvent } from '@shared/transfer'

const hex = (seed: string) => {
  let h = ''
  for (let i = 0; h.length < 64; i++) h += ((seed.charCodeAt(i % seed.length) * (i + 7)) % 16).toString(16)
  return h
}
const link = (seed: string) => `peardrop://${hex(seed)}`
const now = Date.now()
const HOME = '/Users/demo'

function seed(): DriveRecord[] {
  return [
    { id: 'd1', name: 'holiday-video.mp4', state: 'active', isUpload: true, totalBytes: 734003200, files: [{ name: 'holiday-video.mp4', size: 734003200, path: `${HOME}/Movies/holiday-video.mp4` }], shareLink: link('d1'), createdAt: now - 86400000 },
    {
      id: 'd2',
      name: 'Design assets',
      state: 'paused',
      isUpload: true,
      totalBytes: 12003200,
      files: [
        { name: 'logo.svg', size: 12000, path: `${HOME}/Design/logo.svg` },
        { name: 'mockup.png', size: 2400000, path: `${HOME}/Design/mockup.png` },
        { name: 'brief.pdf', size: 380000, path: `${HOME}/Design/brief.pdf` },
        { name: 'palette.json', size: 1200, path: `${HOME}/Design/palette.json` }
      ],
      shareLink: link('d2'),
      createdAt: now - 3600000
    },
    { id: 'd3', name: 'report-q3.pdf', state: 'active', isUpload: false, totalBytes: 2003200, files: [{ name: 'report-q3.pdf', size: 2003200, path: `${HOME}/.peardrop/downloads/report-q3.pdf` }], shareLink: link('d3'), createdAt: now - 600000 },
    { id: 'd4', name: 'song.mp3', state: 'seeking', isUpload: false, totalBytes: 5003200, files: [{ name: 'song.mp3', size: 5003200 }], shareLink: link('d4'), createdAt: now - 60000 },
    { id: 'd5', name: 'photos-2026.zip', state: 'active', isUpload: true, totalBytes: 1288490188, files: [{ name: 'photos-2026.zip', size: 1288490188, path: `${HOME}/Desktop/photos-2026.zip` }], shareLink: link('d5'), createdAt: now - 7200000 }
  ]
}

export function createMockClient(): PeardropApi {
  const params = new URLSearchParams(location.search)
  const drives = new Map<string, DriveRecord>((params.has('empty') ? [] : seed()).map((d) => [d.id, d]))
  const announced = new Set(['d1', 'd3'])
  let prefs: Preferences = mergePreferences(DEFAULT_PREFERENCES, { appearance: { theme: (params.get('theme') as 'dark' | 'light') ?? 'dark' } })
  let library: LibraryData = { ...EMPTY_LIBRARY, favorites: ['d5'], aliases: { d5: 'Summer photos' } }
  const listeners = new Set<(e: TransferEvent) => void>()
  const prefListeners = new Set<(p: Preferences) => void>()
  const engineListeners = new Set<(s: EngineStatus) => void>()
  const emit = (e: TransferEvent) => listeners.forEach((l) => l(e))
  let engine: EngineStatus = {
    phase: 'ready',
    backend: 'mock',
    backendLabel: 'Simulated backend',
    bootstrap: [],
    bootstrapSource: 'public',
    envBootstrap: null,
    startedAt: now - 120000,
    error: null,
    stats: { drives: drives.size, active: 3 }
  }
  const setEngine = (patch: Partial<EngineStatus>) => {
    engine = { ...engine, ...patch, stats: { drives: drives.size, active: announced.size } }
    engineListeners.forEach((l) => l(engine))
  }
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const snapshot = () => ({ drives: [...drives.values()], announced: [...announced], resumeErrors: {} })

  // A live upload on d1 so speed/peers show.
  setTimeout(() => {
    emit({ type: 'peer-connected', driveId: 'd1', peerId: 'a1b2c3', publicKey: hex('peer1'), at: Date.now() })
    let pct = 0
    const t = setInterval(() => {
      pct += 7
      emit({ type: 'transfer-progress', driveId: 'd1', peerId: 'a1b2c3', percent: Math.min(pct, 100), bytesTransferred: 0, totalBytes: 0, speed: 3.2 * 1024 * 1024 })
      if (pct >= 100) {
        clearInterval(t)
        emit({ type: 'transfer-complete', driveId: 'd1', peerId: 'a1b2c3' })
      }
    }, 600)
  }, 1500)
  setTimeout(() => emit({ type: 'drive-announced', driveId: 'd5' }), 2500)

  return {
    transfers: {
      snapshot: async () => snapshot(),
      async share(req) {
        const driveId = `drive_${Date.now()}`
        const files = req.sources.flatMap((s) =>
          s.type === 'folder' && s.contents ? s.contents.map((c) => ({ name: c.name, size: c.size, path: c.path })) : [{ name: s.name, size: s.size, path: s.path }]
        )
        const total = files.reduce((n, f) => n + f.size, 0)
        emit({ type: 'share-started', driveId, clientJobId: req.clientJobId ?? null, name: req.name ?? null, filesTotal: files.length, bytesTotal: total })
        for (let i = 1; i <= 10; i++) {
          await delay(220)
          emit({ type: 'share-progress', driveId, filesDone: Math.floor((files.length * i) / 10), filesTotal: files.length, bytesDone: (total * i) / 10, bytesTotal: total, currentFile: files[Math.min(files.length - 1, Math.floor((files.length * i) / 10))]?.name ?? null })
        }
        const record: DriveRecord = { id: driveId, name: req.name ?? 'Folder', state: 'active', isUpload: true, totalBytes: total, files, shareLink: link(driveId), createdAt: Date.now() }
        drives.set(driveId, record)
        setTimeout(() => {
          announced.add(driveId)
          emit({ type: 'drive-announced', driveId })
        }, 1800)
        return { success: true, driveId, shareLink: record.shareLink!, files, record }
      },
      cancelShare: async () => ({ success: true }),
      async checkLink(l) {
        const found = [...drives.values()].find((d) => d.shareLink === l)
        return found ? { isDuplicate: true, driveId: found.id, localStatus: 'available', existing: found } : { isDuplicate: false }
      },
      async open(l) {
        await delay(1200)
        const driveId = `recv_${Date.now()}`
        const files = [{ name: 'shared-notes.pdf', size: 48_000_000 }]
        drives.set(driveId, { id: driveId, name: 'shared-notes.pdf', state: 'seeking', isUpload: false, totalBytes: 48_000_000, files, shareLink: l, createdAt: Date.now() })
        return { success: true, isDuplicate: false, driveId, files, shareName: 'shared-notes.pdf', totalBytes: 48_000_000, hasManifest: true, peerConnected: true, truncated: null }
      },
      async download({ driveId }) {
        const d = drives.get(driveId)
        if (!d) return { success: false, error: 'Session not found' }
        for (let p = 5; p <= 95; p += 5) {
          await delay(180)
          emit({ type: 'transfer-progress', driveId, peerId: 'self', percent: p, bytesTransferred: (d.totalBytes * p) / 100, totalBytes: d.totalBytes, speed: 6.4 * 1024 * 1024 })
        }
        const files = d.files.map((f) => ({ ...f, path: `${HOME}/.peardrop/downloads/${f.name}` }))
        const record = { ...d, state: 'active' as const, files, localPath: `${HOME}/.peardrop/downloads` }
        drives.set(driveId, record)
        emit({ type: 'files-downloaded', driveId, files, downloadPath: record.localPath, isSeeding: true, partial: false, failedCount: 0 })
        emit({ type: 'drive-added', record })
        return { success: true, partial: false, failed: [], files, downloadPath: record.localPath, driveId }
      },
      async cancelDownload(id) {
        drives.delete(id)
        emit({ type: 'drive-removed', driveId: id })
        return { success: true }
      },
      get: async (id) => drives.get(id) ?? null,
      async pause(id) {
        const d = drives.get(id)
        if (!d) return { success: false, error: 'Drive not found' }
        d.state = 'paused'
        announced.delete(id)
        return { success: true, record: d }
      },
      async resume(id) {
        const d = drives.get(id)
        if (!d) return { success: false, error: 'Drive not found' }
        d.state = d.isUpload ? 'active' : 'active'
        setTimeout(() => {
          announced.add(id)
          emit({ type: 'drive-announced', driveId: id })
        }, 1500)
        return { success: true, record: d }
      },
      async remove(id) {
        drives.delete(id)
        emit({ type: 'drive-removed', driveId: id })
        return { success: true }
      },
      onEvent: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      }
    },
    files: {
      stat: async (paths) => paths.map((p, i) => ({ name: p.split(/[/\\]/).pop() || `file-${i}`, path: p, size: 1_500_000 * (i + 1), type: 'file' as const })),
      exists: async (paths) => Object.fromEntries(paths.map((p) => [p, !p.includes('missing')])),
      open: async () => ({ success: true }),
      reveal: async () => ({ success: true }),
      openDownloads: async () => ({ success: true }),
      thumbnail: async () => ({ kind: 'none', src: null }),
      pick: async () => [`${HOME}/Documents/presentation.pptx`, `${HOME}/Pictures/team.jpg`],
      pathForFile: (f) => `${HOME}/Desktop/${f.name}`
    },
    qr: {
      async generate(text) {
        // A deterministic pseudo-QR so the layout can be judged without the qrcode lib.
        const n = 29
        const cells: string[] = []
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n; x++) {
            const finder = (x < 7 && y < 7) || (x > n - 8 && y < 7) || (x < 7 && y > n - 8)
            const on = finder ? (x % 6 === 0 || y % 6 === 0 || (x % 6 > 1 && x % 6 < 5 && y % 6 > 1 && y % 6 < 5)) : text.charCodeAt((x * 31 + y * 17) % text.length) % 3 === 0
            if (on) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`)
          }
        return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">${cells.join('')}</svg>`)}`
      }
    },
    app: {
      info: async () => ({
        identity: {
          name: 'peardrop',
          productName: 'PearDrop',
          appId: 'com.anjou.peardrop',
          description: 'Simple, elegant P2P file sharing',
          author: 'Anjou',
          homepage: '',
          copyright: 'Copyright © 2026 Anjou',
          icon: '',
          linkScheme: 'peardrop'
        },
        version: '0.29.0',
        platform: 'win32',
        arch: 'x64',
        versions: { electron: '28.3.3', chrome: '120', node: '18.18' },
        iconDataUrl: null,
        isDev: true,
        profile: null,
        paths: { root: `${HOME}/.peardrop`, downloads: `${HOME}/.peardrop/downloads`, logs: `${HOME}/.peardrop/logs`, preferences: `${HOME}/.peardrop/preferences.json` }
      })
    },
    settings: {
      get: async () => prefs,
      async update(patch) {
        prefs = mergePreferences(prefs, patch)
        prefListeners.forEach((l) => l(prefs))
        return prefs
      },
      onChange: (cb) => {
        prefListeners.add(cb)
        return () => prefListeners.delete(cb)
      }
    },
    library: {
      get: async () => library,
      async setFavorite(id, fav) {
        library = { ...library, favorites: fav ? [...new Set([...library.favorites, id])] : library.favorites.filter((f) => f !== id) }
        return library
      },
      async setAlias(id, alias) {
        const aliases = { ...library.aliases }
        if (alias) aliases[id] = alias
        else delete aliases[id]
        library = { ...library, aliases }
        return library
      },
      async forget(id) {
        const aliases = { ...library.aliases }
        delete aliases[id]
        library = { ...library, aliases, favorites: library.favorites.filter((f) => f !== id) }
        return library
      },
      import: async () => library
    },
    engine: {
      status: async () => engine,
      async reload(req) {
        if (req?.bootstrap !== undefined) {
          const parsed = parseBootstrapList(req.bootstrap)
          if (!parsed.ok) return { success: false, error: parsed.error, status: engine }
          prefs = mergePreferences(prefs, { network: { bootstrap: formatBootstrapList(parsed.nodes) } })
          prefListeners.forEach((l) => l(prefs))
        }
        setEngine({ phase: 'reloading' })
        await delay(1200)
        const nodes = parseBootstrapList(prefs.network.bootstrap)
        announced.clear()
        setEngine({ phase: 'ready', startedAt: Date.now(), bootstrap: nodes.ok ? nodes.nodes : [], bootstrapSource: nodes.ok && nodes.nodes.length ? 'preferences' : 'public' })
        emit({ type: 'library-loaded', snapshot: snapshot() })
        setTimeout(() => [...drives.values()].filter((d) => d.state === 'active').forEach((d) => (announced.add(d.id), emit({ type: 'drive-announced', driveId: d.id }))), 1500)
        return { success: true, status: engine }
      },
      onStatus: (cb) => {
        engineListeners.add(cb)
        return () => engineListeners.delete(cb)
      }
    },
    logs: {
      path: async () => `${HOME}/.peardrop/logs/peardrop-2026-10-17.log`,
      reveal: async () => ({ success: true }),
      tail: async () => ({ success: true, text: '2026-10-17 17:21:04.512 +03:30 INFO  [engine:hyperdrive] Ready {"drives":5}' }),
      write: async () => undefined
    }
  }
}
