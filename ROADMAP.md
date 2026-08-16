# PearDrop Roadmap

*Created: 2026-03-28*
*Goal: Complete, stable PearDrop on all platforms → Alpha launch → Grants*

---

## Overview

PearDrop needs to be built on top of **pearcore** to enable:
- Static device "accounts" (persistent identity per device)
- Adding your own devices to assist uploads/downloads
- Path to adding friends
- Direct send to own devices without confirmation

This requires a **key attestation system** where one key can sign to "login" on another device, approving it as part of the same account. All devices in the same space treat attested devices as the same user.

---

## Roadmap

### Phase 1: Pearcore Migration
- [ ] Migrate PearDrop onto pearcore foundation
- [ ] Establish device identity via pearcore primitives

### Phase 2: Stabilization Round 1
- [ ] Fix edge cases and bugs from migration
- [ ] Clean up code, ensure reliable operation

### Phase 3: My Devices System
- [ ] Implement key attestation (device linking)
  - Main key signs to approve secondary device key
  - Approved devices = same user within a space
- [ ] Add own computers/devices to each other in same "space"
- [ ] Enable direct send to own devices (no confirmation needed)
- [ ] Devices can assist each other with uploads/downloads

### Phase 4: Stabilization Round 2
- [ ] Fix issues discovered during device system implementation
- [ ] Harden the attestation flow

### Phase 5: Mobile Apps
- [ ] iOS app development
- [ ] Android app development
- [ ] Cross-platform testing (macOS, Windows, Linux, iOS, Android)

### Phase 6: Final Cleanup & Testing
- [ ] Full test suite across all platforms
- [ ] UX polish
- [ ] Edge case handling

### Phase 7: Alpha Release
- [ ] Release on all operating systems
- [ ] Public alpha announcement

### Phase 8: Grants
- [ ] Push for funding/grants with working alpha

---

## Key Architecture: Device Attestation

**Problem:** Need to distinguish devices while recognizing they belong to the same user.

**Solution:** Account Space with Device Whitelist
1. Each device has its own device key (ed25519)
2. **Account space created lazily** — only when user initiates "Add Device"
3. Account space = special space type with device list in whitelist
4. Adding a device = signing their key into the whitelist
5. All devices sync the same signed device list

**Key Decision (2026-03-28):** Don't create account space at first launch. Wait until user explicitly wants to add another device. This avoids:
- Orphan account spaces for single-device users
- DHT pollution from unused spaces
- Complexity when device joins a different account

**Flow:**
1. First device: Normal account, no account space
2. User clicks "Add Device" → Create account space, add self as first device, generate invite
3. Second device scans/enters invite → Gets added to whitelist
4. All devices can now see each other and assist transfers

**Implementation:** Extend existing space system with `spaceType="account"` rather than new tables. Device metadata (name, platform, keyType) stored in whitelist entries.

---

## Notes

- This is the final feature push before app launch
- After mobile apps work, we're in polish/launch mode
- Grants come after we have something real to show
