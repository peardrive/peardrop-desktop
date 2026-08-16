# PearDrop Metadata Layer Proposal

**Goal:** Provide file information (name, size, type) to downloaders BEFORE they commit to downloading, and enable accurate progress tracking.

---

## The Current Problem

1. **Blind downloads** - User pastes link, clicks Download, has no idea what they're getting
2. **No progress info** - We don't know total bytes, so can't show percentage
3. **No file preview** - Downloader sees "0 B / —" until transfer completes

---

## Investigation Findings

### Hyperdrive Native Metadata

Hyperdrive entries DO contain size information:
```javascript
entry = {
  key: "/movie.mp4",
  value: {
    blob: {
      blockOffset: 0,
      blockLength: 1842,
      byteLength: 453234567  // ← SIZE IS HERE
    },
    metadata: null  // ← UNUSED, available for custom data
  }
}
```

**The issue:** For remote drives, `drive.update({ wait: true })` may not fully sync blob metadata before we list files. The size shows as 0 because the blobs core hasn't replicated yet.

### pearcore Capabilities

pearcore has a full messaging layer:
- **SpaceMessageManager** - Routes typed messages between peers
- **SpaceSocketManager** - Tracks peer connections
- Message types: ProfileUpdate, SpaceMetadata, custom types possible

---

## Proposed Options

### Option 1: Manifest File in Hyperdrive
**Add `/.peardrop.json` to every shared drive**

```json
{
  "version": 1,
  "name": "Rifftrax - Birdemic",
  "created": 1771811039796,
  "files": [
    {
      "path": "/Rifftrax - Birdemic_converted.mp4",
      "name": "Rifftrax - Birdemic_converted.mp4",
      "size": 453234567,
      "type": "video/mp4",
      "blocks": 1842
    }
  ],
  "totalBytes": 453234567,
  "totalBlocks": 1842
}
```

**Flow:**
1. Sharer creates drive, adds files, adds manifest
2. Downloader connects, downloads ONLY the manifest first (tiny)
3. UI shows: "Rifftrax - Birdemic_converted.mp4 (432 MB)"
4. User confirms → full download begins with known total

**Pros:**
- Simple to implement
- No external dependencies
- Manifest downloads in milliseconds
- Full control over metadata format
- Works offline (no handshake needed)

**Cons:**
- Extra file in every share
- Need to ensure manifest syncs first
- Sharer must be online for initial manifest fetch

**Implementation effort:** Low (2-3 hours)

---

### Option 2: Two-Phase Preview Connection
**Split openDrive into preview + download**

```javascript
// Phase 1: Preview (fast, metadata only)
const preview = await peardrop.preview(link);
// Returns: { files: [...], totalBytes, ready: true }

// Phase 2: Download (user confirmed)
await preview.downloadAll(destDir, { onProgress });
```

**Flow:**
1. Paste link → auto-connects and fetches file list
2. UI shows file info immediately
3. User clicks "Download" → actual transfer begins

**Pros:**
- Better UX - info shown before commitment
- Can cancel before downloading large files
- Uses native Hyperdrive listing

**Cons:**
- Two connection phases
- Still relies on Hyperdrive metadata syncing correctly
- Slight latency for preview

**Implementation effort:** Medium (4-6 hours)

---

### Option 3: pearcore Signaling Layer
**Use pearcore messaging for metadata exchange**

```
Downloader                              Sharer
    |                                      |
    |------ REQUEST_METADATA(driveKey) --->|
    |                                      |
    |<----- FILE_METADATA(files, size) ----|
    |                                      |
    |------ CONFIRM_DOWNLOAD ------------->|
    |                                      |
    |<===== Hyperdrive Transfer ===========|
```

**Enables future features:**
- **Receive links** - QR code to let someone send TO you
- **Transfer approval** - Sharer can approve/deny requests
- **Group sharing** - Share to a Space, anyone can download
- **Progress sync** - Both sides see same progress
- **Resume interrupted transfers**

**Pros:**
- Rich interaction model
- Enables many future features
- Bidirectional communication
- Real-time negotiation

**Cons:**
- More complex
- Both peers must be online for handshake
- pearcore dependency for all sharing
- Message protocol design needed

**Implementation effort:** High (1-2 days)

---

### Option 4: Hybrid (Manifest + pearcore)
**Use manifest for basic info, pearcore for enhanced features**

1. **Always:** Include `.peardrop.json` manifest in drives
2. **If pearcore available:** Enable rich features (receive links, groups)
3. **Graceful fallback:** Works without pearcore, just fewer features

**Pros:**
- Best of both worlds
- Progressive enhancement
- Works offline
- Future-proof

**Cons:**
- Two systems to maintain
- Complexity

**Implementation effort:** Medium-High

---

## Recommended Path

### Phase 1: Manifest File (Do Now)
1. Add `.peardrop.json` to every shared drive
2. On connect, download manifest first
3. Show file info before full download
4. Use manifest's `totalBytes` for progress tracking

### Phase 2: Two-Phase Preview (Do Next)
1. `preview(link)` → returns file info, doesn't download
2. `download()` → user-initiated after seeing preview
3. Progress bar shows real percentage

### Phase 3: pearcore Integration (Future)
1. Design message protocol for file sharing
2. Implement receive links
3. Group sharing via Spaces
4. Transfer approval/negotiation

---

## Manifest File Specification (Phase 1)

**Location:** `/.peardrop.json` (root of Hyperdrive)

**Schema:**
```typescript
interface PearDropManifest {
  version: 1;
  name?: string;                    // Human-friendly share name
  created: number;                  // Unix timestamp ms
  expires?: number;                 // Optional TTL
  
  files: Array<{
    path: string;                   // Full path in drive
    name: string;                   // Display name
    size: number;                   // Bytes
    type?: string;                  // MIME type
    blocks?: number;                // Hypercore blocks
  }>;
  
  totalBytes: number;
  totalBlocks?: number;
  
  // Future extensions
  sender?: {
    name?: string;
    publicKey?: string;
  };
}
```

**Download order:**
1. Connect to drive
2. `await drive.get('/.peardrop.json')` - tiny, fast
3. Parse manifest, show UI
4. Download remaining files

---

## Progress Tracking Fix

With manifest, progress becomes simple:
```javascript
const manifest = JSON.parse(await drive.get('/.peardrop.json'));
const totalBytes = manifest.totalBytes;

// Now we can show real progress
const percent = (bytesDownloaded / totalBytes) * 100;
```

---

## Questions to Consider

1. **Manifest security** - Should we sign/verify manifests?
2. **Large file lists** - What if share has 1000 files? Pagination?
3. **Streaming shares** - What about live/appending files?
4. **Version migration** - How to handle old shares without manifests?

---

## Next Steps

If you approve this direction:
1. Implement manifest creation in `createDrive()`
2. Implement manifest-first download in `openDrive()`
3. Update UI to show file preview before download
4. Fix progress tracking with known totals

Ready to proceed when you give the go-ahead.
