# DriveItem

Standalone, themeable drive display component for PearDrop.

## Features

- **Zero dependencies** - Works anywhere
- **API-driven visibility** - Show/hide any field via presets or arrays
- **Themeable** - Dark/light modes + full CSS variable override
- **Event system** - Click, action callbacks
- **Progress bar slot** - Accepts external ProgressBar module

## Quick Start

```html
<div id="drive"></div>
<script src="drive-item.js"></script>
<script>
  const item = new DriveItem('#drive', {
    data: {
      title: 'My Files.zip',
      size: 52428800,
      fileCount: 12,
      status: 'downloading',
      progress: 0.45,
      speed: 1250000,
      peers: 3
    },
    show: 'download', // or ['title', 'progress', 'speed']
    theme: 'dark'
  });
</script>
```

## API

### Constructor

```js
new DriveItem(container, options)
```

**Options:**
- `data` - Drive data object (see Data Fields below)
- `show` - Visibility preset or field array
- `theme` - `'dark'` | `'light'` | `{ custom CSS vars }`
- `onAction` - Callback for action buttons (tip, etc.)
- `progressBar` - External ProgressBar module instance

### Methods

| Method | Description |
|--------|-------------|
| `update(data)` | Partial data update |
| `setVisibility(preset\|array)` | Change visible fields |
| `getVisibility()` | Get current visible fields |
| `setTheme(theme)` | Change theme |
| `getData()` | Get current data |
| `setProgressBar(module)` | Set external progress bar |
| `on(event, callback)` | Add event listener |
| `off(event, callback)` | Remove event listener |
| `getElement()` | Get DOM element |
| `destroy()` | Clean up |

### Events

- `click` - Item clicked (not on action button)
- `action` - Action button clicked (e.g., tip)
- `update` - Data updated

### Static Properties

```js
DriveItem.version   // '0.1.0'
DriveItem.fields    // All available field names
DriveItem.presets   // Preset configurations
```

## Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `title` | string | Display name |
| `size` | number | Total bytes |
| `fileCount` | number | Number of files |
| `status` | string | sharing\|downloading\|paused\|inactive\|missing\|complete |
| `progress` | number | 0-1 download progress |
| `speed` | number | Bytes per second |
| `peers` | number | Connected peer count |
| `thumbnail` | string | Image URL or data URI |
| `path` | string | Local file path (hidden by default) |
| `creator` | string | Creator ID (npub, etc.) |
| `tipAddress` | string | Lightning/payment address |
| `type` | string | download\|upload |

## Visibility Presets

| Preset | Fields |
|--------|--------|
| `minimal` | title, status |
| `compact` | title, size, status |
| `download` | title, size, progress, speed, status |
| `share` | title, size, fileCount, peers, status |
| `full` | All visible fields |
| `all` | Everything except path |

## Theming

### Named Themes

```js
item.setTheme('dark');  // Default
item.setTheme('light');
```

### Custom CSS Variables

```js
item.setTheme({
  '--di-bg': '#2a2a2a',
  '--di-text': '#fff',
  '--di-radius': '12px',
  '--di-progress-fill': '#22c55e'
});
```

### Available Variables

**Container:**
- `--di-bg`, `--di-bg-hover`, `--di-border`
- `--di-radius`, `--di-padding`
- `--di-shadow`, `--di-shadow-inset`

**Text:**
- `--di-text`, `--di-text-secondary`
- `--di-text-size`, `--di-text-size-small`

**Thumbnail:**
- `--di-thumb-size`, `--di-thumb-radius`, `--di-thumb-bg`

**Progress:**
- `--di-progress-bg`, `--di-progress-fill`
- `--di-progress-height`, `--di-progress-radius`

**Status Badge:**
- `--di-badge-padding`, `--di-badge-radius`, `--di-badge-size`
- `--di-status-sharing`, `--di-status-downloading`, etc.

## External Progress Bar

```js
// Use your own progress bar module
const progressBar = new MyProgressBar();

const item = new DriveItem('#drive', {
  data: { ... },
  show: ['title', 'progress'],
  progressBar: progressBar
});

// Progress bar will be mounted into the slot
// and updated when item.update({ progress: x }) is called
```

## Files

```
drive-item/
├── drive-item.js      # Main module (UMD)
├── standalone.html    # Interactive demo
└── README.md          # This file
```
