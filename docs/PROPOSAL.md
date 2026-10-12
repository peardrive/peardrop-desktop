# PearDrop: Simplified Architecture Proposal

*Created: 2026-02-21*

## The Vision (Simplified)

**Two features. Clean separation.**

1. **Device Cloud** — Your devices share files seamlessly via a persistent pearcore space
2. **Link Sharing** — Generate a Hyperdrive link anyone can use to download

No friend lists. No identity systems. No push notifications. No trust establishment.

---

## What We're NOT Building

Explicitly out of scope for PearDrop v1:

- ❌ Nostr integration
- ❌ iOS contact import
- ❌ Friend lists
- ❌ Whitelist trust systems
- ❌ Device attestations
- ❌ Push notifications to friends
- ❌ Impersonation protection

All of that belongs in PearDrive proper.

---

## Architecture

### Feature 1: Device Cloud

**Purpose:** Seamless file sharing between your own devices

**How it works:**
```
User's Device Network (Persistent Pearcore Space)
├── MacBook (this device)
├── iPhone (via Pear runtime)
├── Linux Desktop
└── Files sync instantly when devices are online
```

**Implementation:**
- On first launch, create/join a "device network" space
- Space is identified by user's keypair (same keypair = same device network)
- All devices with same keypair automatically see each other
- Files sent via pearcore messaging system (existing infrastructure)
- Store-and-forward through other online devices

**UX Flow:**
1. Drop file onto PearDrop
2. See list of your online devices
3. Click "Send to MacBook"
4. File appears on MacBook instantly

**Technical notes:**
- Reuse existing pearcore space/message infrastructure
- Device list comes from connected peers in the space
- File transfer via message.service.js (may need chunking for large files)
- 10MB limit initially (same as current app)

### Feature 2: Link Sharing

**Purpose:** Share files with anyone via a simple link

**How it works:**
```
1. User drops file
2. PearDrop creates a Hyperdrive with the file
3. User gets a shareable link (hyperdrive key)
4. Anyone with the link can download
5. Optional: auto-delete after X hours/days
```

**Implementation:**
- Add Hyperdrive to pearcore (or use it directly in PearDrop)
- Create ephemeral Hyperdrive per shared file
- Link format: `peardrop://[hyperdrive-key]` or just the raw key
- Recipient opens link → PearDrop (or web gateway) joins swarm → downloads file
- Optional TTL stored locally, cleanup on app launch

**UX Flow:**
1. Drop file onto PearDrop
2. Click "Get Link"
3. Copy link to clipboard
4. Share via text, email, Telegram, whatever
5. Recipient clicks link → downloads file

**Technical notes:**
- Hyperdrive gives us: content-addressable storage + P2P distribution
- Link is the Hyperdrive discovery key
- No central server needed
- Multiple recipients can download simultaneously
- File persists as long as at least one peer is seeding

---

## Current State vs. What's Needed

### What Exists (~/Apps/peardrop)

| Component | Status | Notes |
|-----------|--------|-------|
| Electron shell | ✅ Done | Window, drag-drop, basic UI |
| Device setup | ✅ Done | Device naming, local storage |
| Space creation | ⚠️ Simulated | Fake WebSocket daemon, not real P2P |
| File transfer | ⚠️ Simulated | Local only, no real P2P |
| Hyperdrive | ❌ Missing | Needed for link sharing |

### What Exists (~/Apps/pearcore)

| Component | Status | Notes |
|-----------|--------|-------|
| Hyperswarm | ✅ Done | Real P2P connectivity |
| Space service | ✅ Done | Create/join/list spaces |
| Message service | ✅ Done | Send messages in spaces |
| RPC interface | ✅ Done | WebSocket API |
| Hyperdrive | ❌ Missing | Not integrated yet |

---

## Implementation Plan

### Phase 1: Device Cloud (Real P2P)

**Goal:** Replace fake daemon with real pearcore integration

**Status:** ✅ DAEMON LOGIC COMPLETE

**Tasks:**
1. ✅ Connect PearDrop to pearcore daemon (port 8787)
2. ✅ Daemon detection: check if running, start if needed
3. ✅ Track ownership: only kill daemon if we started it
4. ✅ ShareLink → Topic conversion for messaging
5. ⏳ Create "device network" space on first setup
6. ⏳ Display connected devices (peers in the space)
7. ⏳ Real-time file sync between devices

**Changes made:**
- `main.js`: Complete rewrite with real pearcore integration
  - `ensureDaemon()`: Check for existing daemon, spawn if needed
  - `stopDaemonIfOwned()`: Only kill daemon we started
  - `sendRPC()`: Proper WebSocket RPC with request tracking
  - ShareLink decoding and topic generation
  - Space caching for topic lookups
- `package.json`: Added bs58 dependency for sharelink decoding

**Next steps:**
- Test with real pearcore daemon
- Implement device network space creation
- Show connected peers in UI

**Deliverable:** Your devices can share files over real P2P

### Phase 2: Link Sharing (Hyperdrive)

**Goal:** Generate shareable links for files

**Tasks:**
1. Add Hyperdrive to pearcore (or use directly)
2. Create Hyperdrive when user wants to share
3. Add file to Hyperdrive
4. Generate and display shareable link
5. Handle incoming link → download file
6. (Optional) TTL/expiration

**Changes needed:**
- `pearcore/package.json`: Add hyperdrive dependency
- New service or utility for Hyperdrive management
- `main.js`: Add IPC handlers for link creation/download
- `renderer.js`: UI for link generation and paste-to-download

**Deliverable:** Generate a link, share it anywhere, recipient downloads

---

## Open Questions

1. **Pearcore daemon management:** Should PearDrop start/stop its own pearcore daemon, or expect it running?
   - Option A: PearDrop manages daemon lifecycle
   - Option B: User runs `pearcore daemon` separately
   - Recommendation: Option A for simple UX

2. **Hyperdrive integration:** Add to pearcore or use directly in PearDrop?
   - Option A: Add to pearcore (cleaner architecture)
   - Option B: Use directly in PearDrop (faster to implement)
   - Recommendation: Option A, but start with B for PoC

3. **Large file handling:** Current 10MB limit. Increase?
   - Hyperdrive handles large files natively
   - Device-to-device via messages may need chunking
   - Recommendation: Keep 10MB for device sync, unlimited for link sharing

4. **Web gateway for links:** Should non-PearDrop users be able to download via browser?
   - Would need a web gateway service
   - Nice-to-have, not MVP
   - Recommendation: Later

---

## Summary

**What we're building:**
- Device sync via pearcore spaces (already possible)
- Link sharing via Hyperdrive (needs integration)

**What we're skipping:**
- Everything else from ARCHITECTURE.md

**Effort estimate:**
- Phase 1 (Device Cloud): 2-3 days
- Phase 2 (Link Sharing): 3-4 days

This gets you a working demo of both core primitives without the complexity of identity, trust, and friend management.
