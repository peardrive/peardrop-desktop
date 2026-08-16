# ARCHITECTURE.md - PearDrop UI Component Architecture

*Last updated: 2026-03-08*

---

## Core Philosophy: Blocks Inside Blocks

Every component owns its "block" of space:
- **Parent components** provide **slots** (empty containers)
- **Child components** control everything **inside** their slot
- No component reaches outside its block
- No parent manipulates child internals

```
App Window
└── ScrollList (provides slots)
    └── slot (empty div)
        └── DriveItem (owns slot contents)
            └── menu-container
                └── menu-button
                └── menu-dropdown
```

---

## Component Manifest

### ScrollList (`lib/scroll-list/scroll-list.js`)

**Purpose:** Universal scrolling container with slot-based architecture

**Responsibilities:**
- Create/manage empty slot containers
- Handle scroll events, reordering
- Slot lifecycle (create, remove, reorder)

**Does NOT:**
- Know what's inside slots
- Handle menu interactions
- Create stacking contexts with z-index

**CSS Rules:**
```css
.scroll-list-slot {
    position: relative;
    /* NO z-index - would trap child menus */
}
```

---

### DriveItem (`lib/drive-item/drive-item.js`)

**Purpose:** Self-contained drive display with built-in context menu

**Responsibilities:**
- Render drive info (title, progress, status)
- Own and control context menu
- Emit `action` events for menu selections
- Handle menu open/close with document click handler
- **Elevate itself when menu is open** (so menu appears above sibling DriveItems)

**Menu Stacking (within component):**
```css
.drive-item-menu-btn { position: relative; z-index: 1; }
.drive-item-menu-container { position: relative; z-index: 2; }
.drive-item-menu { position: absolute; z-index: 10000; }

/* KEY: When menu opens, elevate entire DriveItem above siblings */
.drive-item.menu-open { position: relative; z-index: 1000; }
```

**Why `.menu-open` is needed:**
When DriveItem A opens its menu, DriveItem B (later in DOM) would normally stack above A due to DOM order. By adding `z-index: 1000` to the active DriveItem, we ensure its menu appears above all siblings.

**Menu Close Strategy:**
```javascript
// Document click handler (capture phase) - works in any stacking context
document.addEventListener('click', (e) => {
    if (this._menuOpen && !this._menuContainer.contains(e.target)) {
        this._closeMenu();
    }
}, true);
```

**Why NOT backdrop element:**
- Backdrop at `document.body` exists at root stacking context
- Menu inside container is trapped in container's stacking context
- Even if menu has z-index: 10000, it's relative to container's context
- Backdrop at z:9999 at root > any z-index inside a nested context

---

### DriveActions (`lib/drive-actions.js`)

**Purpose:** Bridge between UI actions and system APIs

**Pattern:** DriveItem → emits action → DriveActions → calls API

**Responsibilities:**
- Map action names to API calls
- Handle file path resolution
- Return success/failure for UI updates

**Does NOT:**
- Know about UI/DOM
- Import Electron directly (receives API as parameter)

---

## Stacking Context Rules

### The Problem

CSS z-index creates **stacking contexts**. Child elements with high z-index are still trapped within parent's context level.

```
document.body (root context)
├── backdrop (z-index: 9999) ← Wins because at root
└── .container (z-index: 50) ← Creates new context
    └── .menu (z-index: 10000) ← TRAPPED at level 50!
```

### Safe Pattern

```
document.body (root context)
└── .container (position: relative, NO z-index) ← No stacking context
    └── .menu (z-index: 10000) ← At root context, can compete
```

### Rules

| Do | Don't |
|----|-------|
| Use `position: relative` without z-index for containers | Add z-index to layout containers |
| Use document click handler for menu close | Use backdrop element at document.body |
| Explicit z-index within component siblings | Assume z-index works globally |
| Test menus work after container changes | Skip menu interaction testing |

### What Creates Stacking Contexts

Any of these on an element creates a new stacking context:
- `z-index` (with position other than static)
- `opacity` < 1
- `transform` (any value)
- `filter` / `backdrop-filter`
- `isolation: isolate`
- `will-change: transform` or similar

### Testing Checklist

After any UI change:
- [ ] Context menu opens on 3-dot click
- [ ] Cursor changes to pointer on menu items
- [ ] Menu items respond to clicks
- [ ] Menu closes on outside click
- [ ] Escape key closes menu
- [ ] Right-click opens context menu

---

## Layer Diagram

```
Layer Order (top to bottom):

┌─────────────────────────────────┐
│  Confirm Dialog (z: 10001)      │  ← Fixed, at document.body
├─────────────────────────────────┤
│  DriveItem.menu-open (z: 1000)  │  ← Elevated when menu active
│    └── Context Menu (z: 10000) │  ← Absolute within elevated item
├─────────────────────────────────┤
│  Other DriveItems (z: auto)     │  ← Normal stacking
│    └── Menu Button (z: 1)       │
├─────────────────────────────────┤
│  Scroll slot                    │  ← position: relative (no z)
├─────────────────────────────────┤
│  ScrollList                     │  ← Container (no z-index!)
├─────────────────────────────────┤
│  .list-container                │  ← position: relative (no z)
├─────────────────────────────────┤
│  .app                           │  ← Main app container
├─────────────────────────────────┤
│  drag-region (z: 100)           │  ← Fixed, top of window
└─────────────────────────────────┘

KEY INSIGHT: When DriveItem opens its menu, it gets .menu-open class
which sets z-index: 1000, lifting it above all sibling DriveItems.
```

---

## Adding New Components

### If your component has a dropdown/menu:

1. **Use document click handler, not backdrop**
   ```javascript
   this._closeHandler = (e) => {
       if (!this._element.contains(e.target)) this._close();
   };
   document.addEventListener('click', this._closeHandler, true);
   ```

2. **Clean up in destroy()**
   ```javascript
   document.removeEventListener('click', this._closeHandler, true);
   ```

3. **Set explicit z-index within component**
   ```css
   .my-trigger { z-index: 1; }
   .my-dropdown { z-index: 10; }
   ```

### If your component is a container:

1. **Do NOT add z-index** unless absolutely required
2. If z-index needed, document why and what it breaks
3. Test that child menus still work

---

## Event Flow

```
User clicks menu item
        ↓
DriveItem._menuContainer captures click
        ↓
DriveItem closes menu, emits 'action' event
        ↓
renderer-v2.js receives action
        ↓
DriveActions.handle(action, data) called
        ↓
DriveActions calls appropriate API method
        ↓
Result returned to renderer
        ↓
renderer updates UI (remove item, change status, etc.)
```

---

## Debugging Menu Issues

If menus aren't working:

1. **Check stacking contexts**
   - Inspect parent elements for z-index
   - Look for opacity < 1, transforms, filters
   
2. **Check pointer-events**
   - Element might have `pointer-events: none`
   - Parent might be blocking
   
3. **Check event capture**
   - Document-level handler might be too greedy
   - Events might be stopped before reaching target

4. **Use DevTools**
   ```javascript
   // In console, check what's under click point:
   document.elementFromPoint(x, y)
   ```

---

## Version History

- **2026-03-08:** Created. Documented stacking context fix for context menus.
