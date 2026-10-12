# ScrollList

A universal, standalone scrolling list component.

**Zero dependencies. Pure DOM. Works everywhere.**

## Philosophy

This component is built to last:
- No frameworks, no build step, no dependencies
- Works in any browser, Electron, mobile webview
- Touch and mouse scrolling with native feel
- Can run completely standalone for testing
- Clean API that won't change

## Quick Start

### Standalone Testing

Open `standalone.html` in any browser. It will:
1. Try to load `drives.json` from PearDrop data directory
2. Fall back to sample data if not found
3. Let you add/remove items to test behavior

```bash
# Open standalone test
open ~/Apps/peardrop/lib/scroll-list/standalone.html
```

### Integration

```html
<div id="my-list" style="height: 400px;"></div>
<script src="lib/scroll-list/scroll-list.js"></script>
<script>
  const list = new ScrollList('#my-list', {
    renderItem: (item, index) => `
      <div class="scroll-list-item" data-index="${index}">
        ${item.name}
      </div>
    `,
    emptyMessage: 'Nothing here yet',
    onItemClick: (item, index) => {
      console.log('Clicked:', item);
    }
  });

  list.setItems([
    { id: 1, name: 'First item' },
    { id: 2, name: 'Second item' }
  ]);
</script>
```

## API Reference

### Constructor

```javascript
new ScrollList(container, options)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| container | HTMLElement \| string | Container element or CSS selector |
| options | Object | Configuration (see below) |

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| renderItem | Function | (default renderer) | `(item, index) => HTML string` |
| emptyMessage | string | 'No items' | Message shown when list is empty |
| keyField | string | 'id' | Field used for item identity |
| onItemClick | Function | null | `(item, index) => void` |
| onItemAction | Function | null | `(item, index, action) => void` |

### Methods

#### Data Management

```javascript
// Replace all items
list.setItems(items)

// Get all items (returns copy)
list.getItems()

// Get count
list.getCount()

// Add to end
list.addItem(item)

// Add to beginning
list.prependItem(item)

// Remove by index
list.removeAt(index)

// Remove by key field (e.g., id)
list.removeByKey(value)

// Update item at index
list.updateAt(index, { name: 'New name' })

// Update item by key field
list.updateByKey(value, { status: 'done' })

// Find item by key
list.findByKey(value)

// Clear all
list.clear()

// Force re-render
list.refresh()
```

#### Scrolling

```javascript
list.scrollToTop()
list.scrollToBottom()
list.scrollToIndex(5)
```

#### Events

```javascript
// Item clicked
list.on('item:click', ({ item, index, element }) => { })

// Action button clicked (if using actions)
list.on('item:action', ({ item, index, action, element }) => { })

// Scroll position changed
list.on('scroll', ({ scrollTop, scrollHeight, clientHeight }) => { })

// List became empty
list.on('empty', () => { })

// Data changed
list.on('update', ({ items, count }) => { })

// Remove listener
list.off('item:click', handler)
```

#### Cleanup

```javascript
list.destroy()
```

### Custom Rendering

The `renderItem` function must return an HTML string with:
- Root element having class `scroll-list-item`
- `data-index` attribute set to the index
- Optionally `data-id` for debugging

```javascript
const list = new ScrollList('#container', {
  renderItem: (item, index) => `
    <div class="scroll-list-item" data-index="${index}" data-id="${item.id}">
      <img src="${item.avatar}" class="avatar">
      <div class="info">
        <strong>${item.name}</strong>
        <span>${item.email}</span>
      </div>
      <button class="scroll-list-item-action" data-action="delete">×</button>
    </div>
  `,
  onItemAction: (item, index, action) => {
    if (action === 'delete') {
      list.removeAt(index);
    }
  }
});
```

## Styling

The component injects minimal base styles. Override with CSS:

```css
/* Container */
.scroll-list-container { }

/* The scrolling area */
.scroll-list { }

/* Each item */
.scroll-list-item { }
.scroll-list-item:hover { }
.scroll-list-item:active { }

/* Empty state */
.scroll-list-empty { }
```

## Mobile Support

Built-in features:
- `-webkit-overflow-scrolling: touch` for iOS momentum
- `overscroll-behavior: contain` to prevent scroll chaining
- Touch-friendly hit targets via media query
- No hover-dependent interactions

## Browser Support

- All modern browsers (Chrome, Firefox, Safari, Edge)
- iOS Safari 12+
- Android Chrome 80+
- Electron (any version)

## Files

```
lib/scroll-list/
├── scroll-list.js   # The component (15KB, no deps)
├── standalone.html  # Test page
└── README.md        # This file
```

## Version

1.0.0 - Initial release
