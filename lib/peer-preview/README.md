# PeerPreview

QuickTime-inspired media previewer for PearDrive. Streams video/audio from Hyperdrives with buffer visualization and adaptive quality support.

## Quick Start

```html
<script src="video-player.js"></script>
<script src="preview-overlay.js"></script>
<script src="peer-preview.js"></script>

<script>
  const preview = new PeerPreview();
  
  // Simple URL
  preview.open('https://example.com/video.mp4');
  
  // With metadata
  preview.open({
    url: 'https://example.com/video.mp4',
    filename: 'My Video.mp4',
    size: 158008374
  });
  
  // With quality tiers (adaptive streaming)
  preview.open({
    filename: 'video.mp4',
    qualities: [
      { id: '480p', label: '480p', src: '/video.480p.mp4' },
      { id: '720p', label: '720p', src: '/video.720p.mp4' },
      { id: '1080p', label: '1080p', src: '/video.1080p.mp4' }
    ]
  });
</script>
```

## Components

### PeerPreview (main)

High-level API for previewing any supported media type.

```javascript
const preview = new PeerPreview(options);

// Open preview
preview.open(source, options);
preview.close();

// Check support
PeerPreview.canPreview('video.mp4');  // true
PeerPreview.getType('photo.jpg');     // 'image'

// Events
preview.on('open', ({ type, filename, url }) => {});
preview.on('close', () => {});
preview.on('play', () => {});
preview.on('pause', () => {});
preview.on('buffer-low', () => {});
preview.on('quality-change', ({ quality }) => {});
```

### VideoPlayer

Standalone video player with buffer visualization.

```javascript
const player = new VideoPlayer('#container', {
  autoplay: false,
  muted: false,
  loop: false,
  qualities: [...]  // Optional quality tiers
});

player.load('video.mp4');
player.play();
player.pause();
player.toggle();
player.seek(30);           // Seek to 30 seconds
player.seekPercent(0.5);   // Seek to 50%
player.setVolume(0.8);
player.setQuality('720p');
player.enterFullscreen();
player.exitFullscreen();
player.destroy();
```

### PreviewOverlay

macOS-style modal overlay with traffic light buttons.

```javascript
const overlay = new PreviewOverlay({
  showTrafficLights: true,
  closeOnBackdrop: true,
  closeOnEscape: true
});

overlay.open({ title: 'video.mp4', meta: '15.8 MB' });
overlay.setTitle('New Title', 'metadata');
overlay.getContentSlot();  // Mount your content here
overlay.enterFullscreen();
overlay.exitFullscreen();
overlay.close();
overlay.destroy();
```

## Supported Formats

| Type  | Extensions |
|-------|------------|
| Video | mp4, webm, mov, mkv, avi, m4v, ogv |
| Audio | mp3, wav, ogg, flac, m4a, aac, opus |
| Image | jpg, jpeg, png, gif, webp, svg, bmp |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space / K | Play/Pause |
| F | Toggle fullscreen |
| M | Mute/Unmute |
| ← | Seek -10s |
| → | Seek +10s |
| ↑ | Volume up |
| ↓ | Volume down |
| Esc | Close preview / Exit fullscreen |

## Architecture

```
peer-preview/
├── peer-preview.js      # Main component (coordinates others)
├── video-player.js      # HTML5 video player with controls
├── preview-overlay.js   # Dark modal overlay (macOS style)
├── standalone.html      # Test harness
└── README.md
```

Each component is standalone and can be used independently:

- Use `VideoPlayer` alone for embedded video
- Use `PreviewOverlay` as a generic modal
- Use `PeerPreview` for the full experience

## Buffer Visualization

The progress bar shows two layers:

1. **Buffer bar** (lighter) — How much is downloaded
2. **Progress bar** (white) — Current playback position

When buffering, a spinner appears and `buffer-low` event fires. When playback can resume, `buffer-ok` fires.

## Adaptive Quality (Future)

For Hyperdrive streaming, files can include multiple quality tiers:

```
/video.mp4           # Original quality
/video.720p.mp4      # Auto-generated
/video.480p.mp4      # For slow connections
/.peardrive/manifest.json
```

The viewer starts with lowest quality for fast start, then upgrades as buffer grows.

## Integration with DriveItem

```javascript
// In DriveItem, handle the 'Open' menu action
driveItem.on('action', ({ action, data }) => {
  if (action === 'open') {
    preview.open({
      url: data.streamUrl,  // Hyperdrive stream URL
      filename: data.title,
      size: data.size
    });
  }
});
```

## License

MIT
