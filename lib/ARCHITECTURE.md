# PearDrop Component Architecture

**Date:** 2026-03-08  
**Status:** Complete — slot-based composition + action handling layer

---

## Key Design Decisions

### Upload vs Download Display

**Downloads show:**
- Progress bar (0-100%)
- Download speed
- Peer count

**Uploads show:**
- Peer count (connections)
- Upload bandwidth
- **NO progress bar**

**Why no upload progress?**
- Uploader doesn't know what the downloader needs
- Downloader requests specific blocks on demand
- We may only upload part of a file
- No extra communication overhead needed
- Simplifies the entire system

This applies to DriveItem and the whole application.

---

## Core Principle: Blocks Inside Blocks

Every component controls its own "block" of space. Parent components provide slots/containers; child components own everything inside those containers.

```
┌─────────────────────────────────────────────────┐
│  ScrollList (handles scrolling, ordering)       │
│  ┌───────────────────────────────────────────┐  │
│  │ Slot 1                                    │  │
│  │ ┌───────────────────────────────────────┐ │  │
│  │ │ DriveItem (owns its entire block)     │ │  │
│  │ │ - title, progress, status, menu       │ │  │
│  │ └───────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ Slot 2                                    │  │
│  │ ┌───────────────────────────────────────┐ │  │
│  │ │ DriveItem (owns its entire block)     │ │  │
│  │ └───────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ Slot 3                                    │  │
│  │ ┌───────────────────────────────────────┐ │  │
│  │ │ ContactItem (different component!)    │ │  │
│  │ └───────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### ScrollList (Container)
**What it owns:**
- Scroll container and behavior
- Touch/momentum scrolling
- Slot creation and ordering
- Reorder mode (drag/drop between slots)
- Empty state display
- Gap/padding between slots

**What it does NOT own:**
- Anything inside slots
- How items look
- Item-specific events (click, action, etc.)

### DriveItem / ContactItem / etc. (Content)
**What it owns:**
- Everything inside its container
- Its own rendering (title, progress, status, etc.)
- Its own events (click, menu, actions)
- Its own state management
- Its own theming (within its block)

**What it does NOT own:**
- Position in the list
- Scroll behavior
- Spacing between items

---

## Old Architecture (BROKEN)

```javascript
// ScrollList owned rendering via HTML strings
const list = new ScrollList(container, {
  renderItem: (item, index) => `<div>${item.name}</div>`  // ❌ Parent controls content
});
```

**Problems:**
1. Parent (ScrollList) controls how items look
2. Can't use DriveItem because DriveItem needs to own its DOM
3. Can't have different item types (all rendered same way)
4. Can't have interactive components inside items

---

## New Architecture (CORRECT)

```javascript
// ScrollList creates slots, child components fill them
const list = new ScrollList(container, {
  emptyMessage: 'No items',
  gap: 8,        // pixels between slots
  padding: 8     // pixels around list
});

// Create a slot, get back a container element
const slot = list.createSlot({ id: 'drive_123' });

// Mount any component into the slot
const driveItem = new DriveItem(slot, { data: driveData });

// OR use a factory for convenience
const list = new ScrollList(container, {
  itemFactory: (slot, data) => new DriveItem(slot, { data })
});
list.addItem(driveData);
```

---

## Nestability

ScrollList inside ScrollList works because each is self-contained:

```
┌─────────────────────────────────────────────────┐
│  Outer ScrollList (vertical)                    │
│  ┌───────────────────────────────────────────┐  │
│  │ Slot: Category "Downloads"                │  │
│  │ ┌───────────────────────────────────────┐ │  │
│  │ │ Inner ScrollList (can also scroll)   │ │  │
│  │ │ ┌─────────────────────────────────┐  │ │  │
│  │ │ │ DriveItem                       │  │ │  │
│  │ │ └─────────────────────────────────┘  │ │  │
│  │ │ ┌─────────────────────────────────┐  │ │  │
│  │ │ │ DriveItem                       │  │ │  │
│  │ │ └─────────────────────────────────┘  │ │  │
│  │ └───────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │ Slot: Category "Uploads"                  │  │
│  │ ┌───────────────────────────────────────┐ │  │
│  │ │ Inner ScrollList                     │ │  │
│  │ └───────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Action Handling Layer

Actions flow through distinct layers, each with a single responsibility:

```
┌─────────────────────────────────────────────────────────────┐
│ DriveItem (UI Layer)                                        │
│ - Emits action string ('open', 'remove', 'pause', etc.)     │
│ - Knows nothing about Electron, shell, or file system       │
│ - Pure UI component — works in any context                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ emits: { action: 'open', data: {...} }
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ DriveActions (Operation Layer) — lib/drive-actions.js       │
│ - Maps action strings → API calls                           │
│ - Takes any API interface (not tied to Electron)            │
│ - Handles: open, show-files, remove, pause, resume, etc.    │
│ - Reusable across different apps                            │
└──────────────────────────┬──────────────────────────────────┘
                           │ calls: api.driveGet(), api.openFile(), etc.
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ API Interface (IPC Layer) — preload.js                      │
│ - Exposes methods: driveGet, openFile, showFileInFolder     │
│ - Bridges renderer → main process                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC invoke
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ main.js (System Layer)                                      │
│ - IPC handlers call DriveManager or shell                   │
│ - DriveManager: data persistence, drive state               │
│ - shell: openPath, showItemInFolder                         │
└─────────────────────────────────────────────────────────────┘
```

**Why this separation?**

| Layer | Concern | Can be swapped? |
|-------|---------|-----------------|
| DriveItem | UI rendering | Yes — any list item component |
| DriveActions | Action mapping | Yes — different action handlers |
| API Interface | IPC bridge | Yes — Pear, web mock, etc. |
| main.js | System calls | Yes — different backends |

**Key benefit:** DriveItem works in:
- Electron (via DriveActions + electronAPI)
- Pear runtime (via DriveActions + pearAPI)
- Web browser (via DriveActions + mockAPI)
- Tests (via DriveActions + testAPI)

---

## Event Flow

Events bubble up but each layer only handles what it cares about:

```
User clicks DriveItem menu → "Remove"
    ↓
DriveItem emits: { event: 'action', action: 'remove', data: {...} }
    ↓
DriveActions.handle('remove', data)
    ↓
api.drivesRemove({ id: data.id })
    ↓
main.js IPC handler → driveManager.remove(id)
    ↓
(Result bubbles back)
    ↓
App code calls list.removeSlot('drive_123')
    ↓
ScrollList removes the slot from DOM
    ↓
DriveItem.destroy() called automatically
```

---

## API Reference

### ScrollList (v2 - Slot-Based)

```javascript
// Constructor
new ScrollList(container, {
  emptyMessage: 'No items',
  gap: 8,              // Gap between slots (px)
  padding: 8,          // Padding around list (px)
  keyField: 'id',      // Field for item identity
  itemFactory: null    // Optional: (slot, data) => Component
});

// Slot management
list.createSlot(options)     // → HTMLElement (the slot container)
list.getSlot(id)             // → HTMLElement or null
list.removeSlot(id)          // Removes slot and calls destroy on component
list.reorderSlot(id, toIndex)
list.clear()

// If using itemFactory:
list.addItem(data)           // Creates slot + calls factory
list.updateItem(id, data)    // Passes data to component.update()
list.removeItem(id)          // Same as removeSlot

// Scroll
list.scrollToSlot(id)
list.scrollToTop()
list.scrollToBottom()

// State
list.getCount()
list.getSlotIds()
list.isEmpty()

// Events
list.on('slot:added', ({ id, slot }) => {})
list.on('slot:removed', ({ id }) => {})
list.on('slot:reordered', ({ id, fromIndex, toIndex }) => {})
list.on('scroll', ({ scrollTop, scrollHeight, clientHeight }) => {})
list.on('empty', () => {})
```

### DriveItem (unchanged)

```javascript
new DriveItem(container, {
  data: { id, title, size, progress, status, ... },
  show: 'compact' | 'download' | ['title', 'progress', ...],
  theme: 'dark' | 'light',
  onAction: (action, data) => {}
});

item.update(data)
item.setVisibility(preset)
item.setTheme(theme)
item.getData()
item.destroy()

item.on('click', (data) => {})
item.on('action', ({ action, data }) => {})
item.on('transition-complete', (event) => {})
```

---

## File Structure

```
lib/
├── scroll-list/
│   ├── scroll-list.js      # Slot-based ScrollList (v2)
│   ├── standalone.html     # Test page
│   └── README.md
├── drive-item/
│   ├── drive-item.js       # UI component (no Electron deps)
│   ├── download-simulator.js
│   ├── standalone.html     # Test page
│   └── README.md
├── peer-preview/
│   ├── peer-preview.js     # Media preview API
│   ├── video-player.js     # HTML5 video player
│   ├── preview-overlay.js  # Modal overlay
│   ├── standalone.html     # Test page
│   └── README.md
├── drive-actions.js        # Action → API mapping (standalone)
├── drive-manager.js        # Data persistence (main process)
├── hyperdrive-manager.js   # Hyperdrive operations (main process)
├── downloader.js           # Download orchestration
├── _archive/
│   └── 2026-03-06-pre-refactor/  # Backup of v1
└── ARCHITECTURE.md         # This file
```

---

## Implementation Checklist

- [x] Rewrite ScrollList with slot-based API
- [x] Preserve all existing styling from standalone.html
- [x] Preserve reorder mode (wiggle animation, drag/drop)
- [x] Preserve menu button animation
- [x] Create new standalone.html that uses DriveItem
- [x] Create DriveActions module for action handling
- [x] Connect DriveItem menu → DriveActions → API
- [ ] Test nesting (ScrollList inside ScrollList)
- [ ] Build DriveInfoPanel (macOS-style info window)
- [ ] Hook PeerPreview to Hyperdrive streams
