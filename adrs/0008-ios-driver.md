# ADR-0008: iOS Driver Internals

| | |
|---|---|
| **Status** | **Accepted** (2026-07-04) — validated on the real simulator — CTK 11/11 supported incl. the HID pressKey (contract 2.0) |
| **Date** | 2026-07-04 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §5.5/§5.6/§5.10 (ratified 2026-07-02) |
| **Relates to** | ADR-0007 (shared server mechanism), ADR-0001 §5.4 (parity/sign-off), C4/C4b (macOS-only) |

## Context

`@kraken/driver-ios` drives iOS simulators through Appium 3 + appium-xcuitest-driver 11. It shares ADR-0007's synthesized project-mode APPIUM_HOME and embedded-server lifecycle (per-driver copy, `ios-home/`); this ADR records the iOS-specific decisions.

## Decisions

### D1 — macOS-only, enforced in layers (C4/C4b)

`/manifest` declares `hostRequirements: { platforms: ['darwin'] }` with an explicit `disabledFix` naming the Apple platform restriction. The package **never** sets npm's `"os"` field (it would `EBADPLATFORM`-break `pnpm install` for non-mac teammates sharing the lockfile — ADR-0001 §5.10). The main entry stays import-safe on every host: heavy deps load only inside `start()`/`createSession()`, which the registry never reaches on non-darwin hosts.

### D2 — Sessions and ports

One independent `remote()` per actor. `appium:wdaLocalPort` and `appium:mjpegServerPort` OS-allocated per session via `allocatePort()` (fixed-base counters were replaced at the Phase 2 seal — concurrent-run collisions). `appium:deviceName` defaults to `'iPhone 16'` (overridable per actor or via driver options); `platformVersion`/`udid`/`app`/`bundleId` pass through from actor config; raw `capabilities` merged last.

### D3 — WebDriverAgent strategy

Default: let the first session `xcodebuild` WDA (slow once — minutes — then cached by Xcode's derived data; `wdaLaunchTimeout` 120 s). Optional fast path for simulators: `prebuiltWDAPath` (driver option or actor config) sets `appium:usePreinstalledWDA: true` + `appium:prebuiltWDAPath` — requires iOS 17+ (a hard xcuitest gate, satisfied by this machine's 18.6/26.5 runtimes). A prebuilt WDA can be fetched with `appium driver run xcuitest download-wda -- --outdir <dir> --platform iOS --kind sim` (script args after `--`); wiring that into `kraken doctor --fix` is future work.

### D4 — Locator mapping and HONEST parity

`testId`/`a11y` → accessibility id (`~`); `text` → `-ios predicate string` on label/value (contains vs exact); `native` → raw passthrough (class chains, predicates). `navigate` → `mobile: deepLink`; `scrollIntoView` → `mobile: scroll { elementId, toVisible }`.

**`pressKey` is SUPPORTED via device-level HID keyboard events** (contract 2.0 — see the ADR-0002 Amendment 1 for the full evidence trail): `mobile: performIoHidEvent` with page 0x07 and usages Return 0x28 / Escape 0x29 / Tab 0x2B, `durationSeconds: 0.005`. Live-verified faithful hardware-key semantics on iOS 18.6. The original v1 asymmetry ('back' has no iOS equivalent) was resolved by redefining SemanticKey rather than signing it off — 'back' proved to be an Android platform concept, not a key.

### D5 — Fixture and known quirks (from the verified fixture research)

The CTK fixture is the same pinned native-demo-app v2.2.0 (iOS build: `wdiodemoapp.app`, arm64 **simulator-only**, MinimumOSVersion 15.1, bundle `org.wdiodemoapp`) — accessibility-id locators on BOTH platforms (the app maps ids via accessibilityLabel/testID, never Android resource-id). Known quirks encoded in tests, never in the core: `hideKeyboard()` fails on iOS (known XCTest issue — tap another element instead); the dropdown opens via `~dropdown-chevron` on iOS.

### D6 — The deviceName/platformVersion trap (observed live, 2026-07-04)

Without `appium:platformVersion`, xcuitest targets the NEWEST installed runtime; if no device named exactly `deviceName` exists there, it silently **creates** a fresh `appiumTest-<UUID>-<name>` simulator — per session. Combined with the CTK's session-per-operation model this produced a live boot-storm (simulators creating/booting/dying in a loop) on this machine, because 'iPhone 16' existed on iOS 18.6 but not on 26.5. Rules derived: integration configs pin BOTH `deviceName` and `platformVersion` (or `udid`); a doctor warning for ambiguous device selection is future work; leftover `appiumTest-*` simulators are safe to delete.

## Consequences

- Simulator-only for M1 (matching the fixture's published artifacts); real-device support (signing, Developer Mode, tunnels) is documented doctor-side and deferred.
- The Xcode support window (currently 16.x/26.x for driver 11) moves every September — the doctor check and CONTRIBUTING's quarterly ritual own that clock.
- First-session WDA builds make the FIRST iOS run slow on a fresh machine; the prebuilt-WDA option is the escape hatch and a candidate default once `kraken doctor --fix` can fetch it.
