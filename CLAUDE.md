# CLAUDE.md - PearDrop Agent Notes

---

## 🎨 DESKTOP REDESIGN v2 — In Progress (LOCAL AGENT NOTES)

**Scope:** desktop-only (`≥ 600px` breakpoint). Mobile UI is untouched and
we reconcile the two layouts *later*. Engine, IPC contract, sacred core:
all off-limits — pure UI reskin against the existing renderer.js hooks.

Reference: Figma frames sent by Amir (Mac window mockups, dark theme).
Traffic lights in the mockups are Cocoa chrome — on the real Windows
build we get standard caption controls, don't draw fake window chrome.

### Structural pivot from current build

- **KILL the left sidebar.** New layout puts nav at the top of the window:
    - Top-left: **Shares** / **Favorites** tabs (underlined active state)
    - Top-right: **↑ Send** and **↓ Receive** green-outline pill buttons
    - Far-right: dark circular **⚙ Settings** button
- **Search bar** full width below the tab row, with **filter (▼)** and
  **3-dot list-options** on its right edge
- **Send / Receive are MODALS**, not persistent panels — click Send →
  overlay with Add Files hero card + Recent Shares; click Receive →
  overlay with Paste input + QR scan area
- **Settings and Report-a-bug are FULL PAGES** (route replacements),
  not modals — back-arrow at top-left returns to main
- **Folder click → modal** showing the folder's contents in the same
  two-column card grid

### Screen inventory (18 total)

1. Splash — logo only
2. Splash — logo + wordmark
3. Onboarding — "Share anything" (dot 1/3)
4. Onboarding — "Fully private" (dot 2/3)
5. Onboarding — "You're all set" (dot 3/3, Get Started)
6. Error — "No connection" (amber, Retry)
7. Error — "Peer not found" (amber, Go back)
8. Error — "File unavailable" (red, Dismiss)
9. Error — "Something went wrong" (Restart app / Send crash report)
10. Confirmation — "Report sent" (green, Done)
11. Shares tab — empty state ("Nothing shared yet")
12. Shares tab — populated (two-column card grid)
13. Shares tab — populated (table view: Name / Type / Size / Status)
14. Send modal — Add Files hero + Recent Shares list
15. Share Link modal — QR + peardrop:// text + Copy Link / Done
16. Multi-file selection modal — checkboxes + Grab button
17. Receive modal — Paste input + QR Code Scan area + Import QR image
18. 3-dot context menu — Add to Favorites / Copy Link / Show QR / Edit / Properties / Stop sharing
19. File info modal — Details + Share info + Copy Link
20. Favorites tab — empty state ("Nothing pinned yet")
21. Favorites tab — populated (same two-column grid as Shares)
22. Folder-open modal — folder header + Copy Link + inner two-column list
23. Download complete toast (bottom-right, "Detail" link)
24. Settings page — user + Appearance + Support sections
25. Report a bug page — form + Attach device info toggle + Send Report

### Design tokens (from mockups)

- Bg: near-black (~#0A0A0A), NO glass panels visible in the mockups —
  this is a departure from current build's glassmorphism. Verify
  whether Amir wants glass removed entirely or kept lightly.
- Accent green: pear-green (~#A8CE38 range), same as before
- Buttons:
    - **Primary filled** — green-gradient pill, dark text
    - **Primary outline** — transparent bg, green border + green text
    - **Secondary** — dark filled outline, muted text
    - **Destructive** — red variant (outline for "Dismiss", solid for "Retry")
    - **Warning** — amber variant
- Corner radii: cards ~12px, buttons ~999px (full pill)
- State icon container (used in error/onboarding screens): rounded-square
  ~100×100, subtle inner shadow, dark-tinted bg, monochrome icon inside
  color-coded by severity (green/amber/red)
- Typography: bold white titles ~24–28px, muted grey body ~14–16px
- **Colored badges** for status: green "Active" / "Completed", amber
  "Sharing (98%)", red "Failed" / "Inactive"
- Favorite star: filled gold ★

### List row anatomy (populated tabs)

- Left thumbnail (~56×56, rounded corner) — file preview, video icon, or
  folder icon (teal folder color for folders)
- Middle: filename (bold), then muted metadata + status badge
- Right: contextual action — X (in-progress cancel), Retry (failed),
  Open (completed), or 3-dot menu

### Design rules to always follow

- **Canonical modal appearance**: ALL modal windows on desktop share
  ONE rule (`.modal-overlay .modal`) that sets width **760px**,
  min-height **520px**, iOS-frosted-glass fill (`rgba(46,48,55,0.35)` +
  `backdrop-filter: blur(40px) saturate(180%)`), rounded 22px corners,
  soft border + drop shadow. Critical: the `.modal-overlay` MUST NOT
  have its own `backdrop-filter` — the modal's blur then has nothing
  meaningful to blur (already-blurred backdrop) and reads as flat. Keep
  the overlay as `background: rgba(0,0,0,0.35)` only.
  Do NOT set per-modal `max-width`, `min-height`, `background`,
  `border`, or `border-radius`. QR scanner modal is explicitly the same
  width even though it needs vertical room. Amir called this out
  multiple times — don't drift.
- **Palette (v2)**:
  - `body` background: pure onyx black `#000000`
  - `.app` content panel: dark grey `#1a1a20`  (matches active tab)
  - Tab container fill (`.top-tabs`): lighter grey `#2e2e34`
  - Active tab fill: `#1a1a20` (blends into panel)
  - Inactive tab fill: transparent (blends into container)
- **Tabs are a segmented control**: single container with rounded
  corners; active button has content-panel color; inactive is
  transparent so it fades into the container. No pseudo-element
  flares, no SVG connectors. N-tab friendly.
- **Border weight**: iOS-style — outlined buttons/inputs/cards use
  **2px borders**, not 1 or 1.5px. Font weights on outlined buttons
  are **700** (bold), not 500-600. Amir called out that iOS looks
  "simple but bold" — thin borders + regular weight read as flat.

### Out of scope (do NOT touch during redesign)

- `main.js`, `preload.js`, any `lib/*.js` engine files, IPC contract,
  sacred-core rules from the section below
- Mobile-UI (anything not inside `@media (min-width: 600px)`)
- Window-state persistence, All Shares tab wiring — those stay
  functionally but visual chrome will change with the new layout

### Task tracker

Working through the screen inventory in order. See TodoWrite state for
current step. Commit after each meaningful screen.

---

## 🚨 SACRED CORE — DO NOT TOUCH 🚨

**The basic download MUST ALWAYS WORK.** This is non-negotiable.

### Protected Code (modify ONLY if absolutely necessary):

**In `lib/hyperdrive-manager.js`:**
- `createDrive()` - File writing to Hyperdrive
- `openDrive()` - File reading from Hyperdrive  
- Swarm `join()` / `replicate()` logic
- The basic share → connect → download flow

**In `main.js`:**
- `hyperdrive-share` IPC handler core
- `hyperdrive-download` IPC handler core

### Rules:
1. **New features = isolated modules.** Never contaminate the core.
2. **If touching core, get explicit approval first.**
3. **Test transfers BEFORE and AFTER any change.**
4. **When in doubt, DON'T.**

### Why:
> "No matter what happens, the user must never come to the app and have the basic download not work. If everything else fails, ok we can fix it, but the simple download needs to work."
> — Guy, 2026-02-24

---

## 🔍 POST-EDIT VERIFICATION (MANDATORY)

**After ANY code change, run these checks before declaring done:**

### 1. Syntax Check
```bash
node --check renderer.js
node --check preload.js  
node --check main.js
node --check lib/*.js
```

### 2. Launch Test
Start the app and check DevTools console for errors.

### 3. Sacred Smoke Test
These MUST work after every change:
- [ ] **Dropzone clickable** — file picker opens
- [ ] **Dropzone drag-drop** — files appear in preview
- [ ] **Share creates link** — `peardrop://` link generated
- [ ] **Download works** — file saves to ~/peardrop/downloads/

### Why This Exists
v0.17.1 incident: Missing `}` on one function broke entire renderer.js. Dropzone appeared dead but code was never touched — syntax error elsewhere killed everything. 30 seconds of `node --check` would have caught it.

See: `~/Projects/ENGINEERING-PRINCIPLES.md` Rule #9

---

## Current State (v0.18.0 - 2026-03-10)

**PearDrop is WORKING and AUDITED.** Core P2P file sharing is functional:
- ✅ Share files → get `peardrop://` link
- ✅ Download from link → files saved to `~/peardrop/downloads/`
- ✅ Upload progress (sharer sees peers downloading)
- ✅ Download progress (receiver sees real % with file name)
- ✅ Manifest system (`.peardrop.json` in every share)
- ✅ CLI tool (`peardrop share/download/list/stop/status`)
- ✅ Glassmorphism UI (macOS-style)
- ✅ **DriveManager** - Single source of truth for Shares tab (v0.17.0)
- ✅ **Downloads in both tabs** - Home + Shares show same transfer (v0.17.1)
- ✅ **Minimize/Cancel buttons** - Hide or delete downloads (v0.17.1)
- ✅ **Full 20-point audit** - No lingering errors (v0.17.2)

### Recent Changes (v0.17.x)
- Replaced `download-history.js` + manifest tracking with unified `DriveManager`
- New IPC: `drives-list`, `drives-pause`, `drives-resume`, `drives-remove`
- Deprecated files moved to `lib/_deprecated/`

---

## ⚠️ MANDATORY: File Header Manifests

**Every code file has a header manifest.** See top of each `.js` file.

**RULE:** When modifying ANY code file:
1. Check if the header manifest needs updating
2. Update it if functions/exports/events/key variables changed
3. Keep descriptions to 5-10 words max
4. Never let manifests drift from actual code

See `~/Projects/ENGINEERING-PRINCIPLES.md` for full philosophy.

---

## 🎨 UNIFIED PROGRESS UI

**ONE structure for ALL transfers** - uploads and downloads use identical HTML.

### Progress Bar (correct):
```html
<div class="transfer-progress">
    <div class="progress-bar" style="width: 72%"></div>
</div>
```

### Stats Line (correct):
```html
<div class="transfer-stats">
    <span class="transfer-bytes">72 MB / 452 MB</span>
    <span class="transfer-percent">72%</span>
</div>
```

### ❌ WRONG - Don't do this:
```html
<!-- DON'T nest progress-fill inside progress-bar -->
<div class="progress-bar">
    <div class="progress-fill" style="width: 72%"></div>
</div>

<!-- DON'T use unstyled containers -->
<div class="transfer-stats">
    <span>72 MB / 452 MB</span>  <!-- missing class! -->
</div>
```

### Key CSS Classes:
- `.progress-bar` - Gets width %, has gradient background
- `.transfer-stats` / `.transfer-footer` - Flex container, space-between
- `.transfer-bytes` - 10px, 50% white
- `.transfer-percent` - 10px, 70% white, bold

### Update Functions:
- `updateTransferUI(peerId, peer)` - For uploads
- `updateDownloadUI(driveId, download)` - For downloads
- Both use identical selectors: `.progress-bar`, `.transfer-bytes`, `.transfer-percent`

---

## 📚 Lessons Learned (v0.14.1 - Progress Bar Incident)

### What Happened
- Upload progress: `<div class="progress-bar" style="width: X%">`
- Download progress: `<div class="progress-bar"><div class="progress-fill">` (DIFFERENT!)
- Result: Download bar always 100% green, text too large
- Two HTML generators (`createTransferItemHTML` vs `createPendingDownloadHTML`) diverged

### Root Cause
Copy-paste modification instead of single source of truth. Changed one, forgot the other.

### The Fix
1. Unified both to use identical HTML structure
2. Created `lib/transfer-ui.js` for reusable components
3. Documented the pattern in this file

### Rule Added
> **If the same element appears in multiple places, it MUST be a single module.**
> See `~/Projects/ENGINEERING-PRINCIPLES.md` Rule #8

---

## ✅ Manifest Update Confirmation Rule

**After modifying ANY code file, I will:**
1. Update the file's header manifest if functions/exports/events changed
2. Note in my response: "📋 Updated header manifest in [filename]"
3. If no manifest update needed, note: "📋 No manifest changes needed"

This confirms the process is being followed so you don't have to wonder.

---

## CLI Usage (for me, the agent)

### Sharing Files
**CRITICAL:** Share process must stay alive for peers to download.

❌ **WRONG** - gets killed by exec timeout:
```bash
peardrop share /path/to/file
```

✅ **RIGHT** - runs in background, survives:
```bash
nohup peardrop share /path/to/file > /tmp/peardrop-share.log 2>&1 &
echo "PID: $!"
sleep 2
cat /tmp/peardrop-share.log  # get the link
```

Monitor progress:
```bash
cat /tmp/peardrop-share.log
```

Stop sharing:
```bash
pkill -f "peardrop share"
```

### Downloading Files
Downloads are one-shot (no background needed):
```bash
peardrop download peardrop://abc123... ~/Downloads
```

### Other Commands
```bash
peardrop list    # active shares
peardrop status  # statistics
peardrop stop    # stop all shares
```

---

## Architecture

```
~/Apps/peardrop/
├── main.js                    # THIN: Electron lifecycle + IPC routing
├── renderer.js                # UI logic, transfer display
├── preload.js                 # Secure IPC bridge
├── index.html                 # Glassmorphism UI + CSS
├── bin/peardrop               # CLI tool
├── CHANGELOG.md               # Version history
└── lib/
    ├── hyperdrive-manager.js  # 🔒 SACRED: Drive lifecycle, swarm, P2P
    ├── drive-manager.js       # ✅ SAFE: Single source of truth for all drives
    ├── downloader.js          # ✅ SAFE: Download orchestration
    ├── file-utils.js          # ✅ SAFE: Pure file utilities
    ├── progress-tracker.js    # Upload tracking, events
    └── transfer-ui.js         # ✅ SAFE: Reusable UI components (progress bars)
```

### DriveManager (v0.17.0) - Single Source of Truth

**File:** `~/peardrop/drives.json`

**API:**
- `add(drive)` - Add a new drive (upload or download)
- `remove(id, opts)` - Remove completely (storage + optional files)
- `pause(id)` - Stop seeding, keep data
- `resume(id)` - Resume seeding
- `get(id)` / `getAll()` / `getByKey(key)` - Queries

**States:**
- `active` - Currently seeding/available on network
- `paused` - Not seeding, but can resume
- `local` - Only local files exist (no hyperdrive data)

**Rule:** If it's in the Shares list → it exists. Remove from list → completely deleted.

### Module Responsibilities

**🔒 SACRED (don't touch without approval):**
- `hyperdrive-manager.js`: createDrive, openDrive, swarm join/replicate

**✅ SAFE (can modify freely):**
- `downloader.js`: File writing, naming, progress callbacks
- `file-utils.js`: getUniqueFilePath, ensureDir, formatBytes
- `renderer.js`: UI only
- `index.html`: Styles only
- `manifest-recovery.js`: Robust manifest recovery and validation (v0.19.1)

### Storage Locations
- `~/peardrop/drives/` - Hyperdrive corestore data (per-drive directories)
- `~/peardrop/drives-state.json` - Persistent drive tracking with recovery support (v0.19.1)
- `~/peardrop/downloads/` - Downloaded files land here
- `/.peardrop.json` (inside drives) - Share metadata for receivers

**Deprecated (v0.17.0):**
- `~/peardrop/drives.json` - Old DriveManager state file
- `~/peardrop/drives-manifest.json` - Old hyperdrive tracking
- `~/peardrop/download-history.json` - Old download history

### Key Decisions Made
1. **Isolated Corestore per drive** - Clean namespace, easy cleanup
2. **In-drive manifest** (`.peardrop.json`) - Receiver knows file names/sizes instantly
3. **Manifest-first download** - Read manifest before downloading files
4. **Blobs core hook** - Track download progress via `blobs.core.on('download')`
5. **Background sharing** - Use `nohup` to keep shares alive
6. **Bulletproof manifest recovery** (v0.19.1) - Isolated recovery system with fallback strategies

### Manifest Recovery System (v0.19.1)

**File:** `lib/manifest-recovery.js` - Isolated module for robust drives-state.json handling

**Recovery Strategies (in order):**
1. **Normal load** - Try standard JSON.parse first
2. **Partial recovery** - Extract valid drive entries from corrupted JSON using regex
3. **Complete rebuild** - Scan all Corestore folders and reconstruct metadata
4. **Empty fallback** - Return clean manifest if all strategies fail

**Key Methods:**
- `loadWithRecovery()` - Main entry point, tries all strategies automatically
- `validateAndSync()` - Ensures manifest ↔ drive folders consistency
- `rebuildFromDrives()` - Scans `CORESTORE` folders to rebuild complete state
- `scanDriveFolder(driveId)` - Extracts metadata from individual drive folder
- `cleanupOrphans()` - Removes orphaned drives/manifest entries

**Integration:** HyperdriveManager uses ManifestRecovery for all manifest operations instead of basic `fs.readFile()`

---

## How Progress Tracking Works

### Upload (sharer side)
- `hyperdrive-manager.js` calls `tracker.trackUploads(driveId, drive, totalBytes)`
- Listens to `blobs.core.on('upload')` events
- Emits `upload-progress` with percent, speed, bytes

### Download (receiver side)
- `main.js` hooks `blobs.core.on('download')` in `hyperdrive-download` handler
- Uses `session.totalBytes` from manifest for percentage
- Emits `upload-progress` with `peerId: 'self'` (renderer shows as "Downloading")

---

## 🎯 UI STACKING CONTEXT RULES (Critical!)

**If you add UI elements with menus, dropdowns, or overlays — READ THIS.**

### The Problem
CSS z-index doesn't work the way you think. Elements with z-index create **stacking contexts** that trap all child z-indices.

Example of what goes wrong:
```css
.container { z-index: 50; }       /* Creates stacking context */
.menu-inside { z-index: 10000; }  /* TRAPPED inside container's level 50! */
.backdrop { z-index: 9999; }      /* At document.body - ABOVE the container! */
```

Result: Backdrop (9999 at root) beats menu (10000 inside a z-50 context). Menu is blocked.

### Rules to Follow

1. **NEVER add z-index to containers unless absolutely necessary**
   - Adding `z-index` to `.list-container`, `.scroll-list`, etc. traps all child menus
   - Use `position: relative` WITHOUT z-index when possible

2. **Menus/dropdowns: Use document click handler, NOT backdrop elements**
   - Backdrop at `document.body` + menu in container = stacking conflict
   - Document click handler avoids creating competing layers
   ```javascript
   // ✅ GOOD - works in any stacking context
   document.addEventListener('click', (e) => {
       if (!menuContainer.contains(e.target)) closeMenu();
   }, true);
   
   // ❌ BAD - backdrop at body blocks menus in containers
   const backdrop = document.createElement('div');
   backdrop.style.zIndex = '9999';
   document.body.appendChild(backdrop);
   ```

3. **If you MUST use a backdrop, keep it in the same stacking context**
   - Append backdrop as sibling of menu, not to body
   - Both will share parent's stacking context

4. **Explicit z-index ordering within components**
   ```css
   .menu-button { position: relative; z-index: 1; }
   .menu-dropdown { position: absolute; z-index: 10; }
   ```

5. **Test menus inside ScrollList/containers**
   - After ANY UI change, test that context menus open and are clickable
   - Check cursor changes to pointer on hover

### What Creates Stacking Contexts
- `z-index` (with position other than static)
- `opacity` less than 1
- `transform` (even `transform: none`)
- `filter`, `backdrop-filter`
- `isolation: isolate`
- `will-change` with certain values

### Current Implementation (v2)
- **DriveItem menus:** Use document click handler (no backdrop)
- **Menu button:** `z-index: 1`
- **Menu dropdown:** `z-index: 10000` (within component)
- **Container:** `position: relative` only — NO z-index
- **Active item elevation:** `.menu-open` class adds `z-index: 1000` to DriveItem when menu is open, lifting it above sibling DriveItems so their buttons don't cover the menu

See `ARCHITECTURE.md` for full component layer documentation.

---

## What's Next (Future Work)

From Guy's roadmap:
1. **iOS/Android clients** - Before download history UI
2. **Receive links** - QR code for others to send TO you
3. **Spaces integration** - Group sharing via pearcore
4. **Download history** - Track past transfers

See `PROPOSAL-metadata-layer.md` for pearcore signaling layer design.

---

## Gotchas & Lessons

1. **P2P requires sharer online** - No server, no relay. Share dies = download fails.
2. **Hyperdrive blob metadata** - Not available until blobs sync. Use manifest instead.
3. **Exec timeout kills shares** - Always use `nohup` for background sharing.
4. **Progress events are `upload-progress`** - Even for downloads (peerId='self').

---

## Testing Locally

Test share has content:
```javascript
const session = manager.activeDrives.get(driveId);
for await (const entry of session.drive.list('/')) {
    const data = await session.drive.get(entry.key);
    console.log(entry.key, data?.length, 'bytes');
}
```

Test manifest reads correctly:
```javascript
const manifest = await drive.get('/.peardrop.json');
console.log(JSON.parse(manifest.toString()));
```


---

## Hypercore Pruned Stack (2026-03-13)

PearDrop can use the `@peardrive/` pruned stack for storage-efficient hosting.

### Packages
```json
{
  "@peardrive/hypercore": "pruned",
  "@peardrive/hyperblobs": "pruned", 
  "@peardrive/hyperdrive": "pruned"
}
```

### What It Does
- `onBlockMissing` callback fires when peer requests cleared blocks
- Enables: write file → clear blobs → restore on-demand
- 99%+ storage savings for large file hosting

### Local Repos
- `~/Apps/hypercore-pruned` (has `onBlockMissing` hook)
- `~/Apps/hyperblobs-pruned` (pass-through)
- `~/Apps/hyperdrive-pruned` (has `pruned: true` mode)

### Usage in PearDrop
```javascript
const Hyperdrive = require('@peardrive/hyperdrive')

const drive = new Hyperdrive(store, {
  pruned: true,
  onBlockMissing: async (index, core, drive) => {
    // Restore from original file
  }
})
```

### Debugging: If Pruned Stack Has Bugs
Switch back to standard stack:
```json
{
  "hypercore": "^11.27.14",
  "hyperblobs": "^2.9.0",
  "hyperdrive": "^13.3.0"
}
```

### Integration Status
- [ ] Switch PearDrop to @peardrive/hyperdrive
- [ ] Test full transfer flow with pruned mode
- [ ] Implement sliding window restore
