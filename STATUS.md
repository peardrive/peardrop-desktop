# PearDrop Status Manifest
*Last updated: 2026-03-08*

## Quick Context Recovery

**What is this?** PearDrop is a P2P file sharing tool using Hyperdrive/Hypercore. Think "simple, intuitive file sharing where all your devices feel like one."

**CLI location:** `/Users/jarvis/Apps/peardrop/bin/peardrop`
**Lib location:** `~/Apps/peardrop/lib/`

---

## Modules Built

### 1. DriveItem (`lib/drive-item/`)
**Status:** ✅ Complete, tested

Interactive file/drive display component with:
- Auto-derived status (downloading/sharing/complete/paused)
- Kebab menu (right-click, long-press, 3-dot button)
- Progress bars for downloads, upload bandwidth indicator for shares
- 30s auto-transition: download complete → sharing mode
- Compact view (normie-friendly, no speed indicator)

**Test:** `open ~/Apps/peardrop/lib/drive-item/standalone.html`

**Key files:**
- `drive-item.js` — Main component (~22KB)
- `download-simulator.js` — Mimics Hyperdrive events
- `standalone.html` — Interactive demo

### 2. ScrollList v2 (`lib/scroll-list/`)
**Status:** ✅ Complete, refactored

Slot-based list component:
- `createSlot({ id })` → empty container
- `itemFactory: (slot, data) => new Component(slot, { data })`
- Reorder mode with FLIP animation
- Drop indicator (blue bar between items)

**Key decision:** Slots, not HTML strings. Each child component owns its block.

**Test:** `open ~/Apps/peardrop/lib/scroll-list/standalone.html`

### 3. DriveActions (`lib/drive-actions.js`)
**Status:** ✅ Complete

Maps DriveItem UI actions to system calls. Bridges UI events and system operations
without either knowing about the other.

**Why separate module?**
- DriveItem stays pure (no Electron deps) → works in any context
- DriveManager stays data-focused (no shell operations)
- DriveActions handles operation mapping → reusable across apps
- Takes any API interface → not tied to Electron specifically

**Actions handled:**
- `open` — Open file in default app
- `show-files` — Show file in Finder/Explorer
- `remove` — Remove drive from manager
- `pause/resume` — Change drive state
- `more-info` — Get drive metadata
- `tip` — Get Lightning tip address

**Usage:**
```javascript
import { DriveActions } from './drive-actions.js';
const actions = new DriveActions(window.electronAPI);
item.on('action', (e) => actions.handle(e.action, e.data));
```

**API interface required:**
- `driveGet(id)`, `drivesRemove()`, `drivesPause()`, `drivesResume()`
- `openFile()`, `showFileInFolder()`, `openDownloads()`

### 4. PeerPreview (`lib/peer-preview/`)
**Status:** ✅ Core complete, needs Hyperdrive integration

Native media preview tool (QuickTime-inspired):
- Dark overlay with macOS traffic lights
- Video player with buffer visualization
- Image viewer with zoom/pan
- Audio player with waveform placeholder
- Keyboard shortcuts (Space, F, M, arrows, Esc)

**Test:** `open ~/Apps/peardrop/lib/peer-preview/standalone.html`

**Key files:**
- `peer-preview.js` — Main API (600 lines)
- `video-player.js` — HTML5 player (847 lines)
- `preview-overlay.js` — Modal overlay (589 lines)

---

## Architecture Decisions

**Document:** `~/Apps/peardrop/lib/ARCHITECTURE.md`

1. **Blocks inside blocks** — Parent provides slot, child owns content
2. **itemFactory pattern** — `new ScrollList(el, { itemFactory: (slot, data) => new DriveItem(slot, { data }) })`
3. **Status auto-derived** — `speed > 0` = downloading, `peers > 0 + upload` = sharing
4. **Paused is explicit only** — User must set it
5. **No emojis in menus** — Except pause ⏸ / resume ▶ in DriveItem
6. **Compact = normie mode** — No technical indicators
7. **Layered action handling:**
   - DriveItem (UI) → emits action string
   - DriveActions (operation) → maps action → API call
   - main.js IPC → executes system call
   - DriveManager/shell → actual work
8. **API interface pattern** — DriveActions takes any `api` that implements required methods, not tied to Electron

---

## Next Steps (When Resuming)

### PeerPreview
- [ ] Hook to actual Hyperdrive streams (test with `peardrop share`)
- [ ] Multi-resolution encoding on share (`--quality low,med,high`)
- [ ] Wire DriveItem "Open" action → preview.open()
- [ ] CLI viewer (`peardrop preview <key>`)

### Integration
- [ ] Test nesting (ScrollList inside ScrollList)
- [ ] Build DriveInfoPanel (macOS-style info window)
- [ ] DriveManager `clearCache(id)` method

### Known Issues
- `peardrop share` timeout after ~5min (OpenClaw exec timeout kills process)
- Workaround: re-run share, send fresh link

---

## Archive

Pre-refactor versions: `~/Apps/peardrop/lib/_archive/2026-03-06-pre-refactor/`

---

## Quick Commands

```bash
# Test components
open ~/Apps/peardrop/lib/drive-item/standalone.html
open ~/Apps/peardrop/lib/scroll-list/standalone.html
open ~/Apps/peardrop/lib/peer-preview/standalone.html

# Share a file
~/Apps/peardrop/bin/peardrop share <file>

# Download
~/Apps/peardrop/bin/peardrop download peardrop://...

# List active shares
~/Apps/peardrop/bin/peardrop list
```
