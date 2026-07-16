# ADR-0007: Android Driver Internals

| | |
|---|---|
| **Status** | **Accepted** (2026-07-04) — validated on the real emulator — CTK 11/11 supported |
| **Date** | 2026-07-04 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §5.6/§5.10 (ratified 2026-07-02) |
| **Relates to** | ADR-0001 §5.5 (import safety), §5.6 (independent sessions), §5.10 (lockfile-governed Appium), §5.13 (doctor) |

## Context

`@kraken/driver-android` drives real Android devices/emulators through Appium 3 + appium-uiautomator2-driver. The open design question ADR-0001 §5.10 deferred here: **how does an embedded Appium find its drivers while the lockfile stays the only version source?** All mechanics below were live-verified against appium@3.5.2 on 2026-07-03 (research probe + this repo's live-boot tests).

## Decisions

### D1 — Synthesized project-mode APPIUM_HOME (the load mechanism)

At `start()`, the driver generates `<projectRoot>/.kraken/appium/android-home/`:

- a `package.json` declaring the **exact** `appium` + `appium-uiautomator2-driver` versions resolved from THIS package's own dependency tree (`createRequire(import.meta.url).resolve` — pnpm-safe, lockfile-governed);
- `node_modules/` symlinks pointing at those resolved package dirs, refreshed every start (store paths move) via a temp-name + atomic-rename swap — a plain rm+symlink pair races a sibling run sharing the project home.

Appium's project-mode manifest then auto-discovers the driver: `Manifest.read()` globs the home's `node_modules` for packages with an `appium.driverName` field, and re-syncs whenever the generated package.json's md5 changes (i.e., on version bumps). **Zero install step, zero npm at runtime.**

**Rejected: `appium driver install --source=local`** — live-verified broken for published packages: it shells out to `npm link`, which fires the target's `prepare` lifecycle (`npm run rebuild` → tsc without a tsconfig in the tarball), and it is not idempotent (second run: "already installed").

### D2 — Embedded server lifecycle (hazards live-verified)

`main({ subcommand: 'server', port, address: '127.0.0.1', appiumHome, throwInsteadOfExit: true, loglevel: 'error:debug', logFile })` — awaiting `main()` IS the readiness signal (resolves after the HTTP listener binds); the returned server's `close()` releases the port. Two hazards Kraken must own:

1. **EADDRINUSE calls `process.exit(1)` even with `throwInsteadOfExit`** → Kraken allocates an OS-assigned free port itself (`allocatePort()`) AFTER the seconds-cold appium import and immediately before `main()`, keeping the reuse window at microseconds; the server binds 127.0.0.1 only.
2. **`main()` registers SIGINT/SIGTERM handlers that `process.exit(0)`**, in a continuation AFTER it resolves → stripped one macrotask later, comparing listener snapshots (only appium's `onSignal` handlers; transitive signal-exit-style re-raisers are left alone). The Kraken CLI owns signals (ADR-0001 §5.11).

Console log level is `error` (the TUI owns stdout); full `debug` goes to `<artifactsDir>/appium-android.log` per run.

### D3 — Sessions: one independent `remote()` per actor

Per ADR-0001 §5.6 — never multiremote, never `@wdio/appium-service`. Capability policy:

- `appium:systemPort` OS-allocated per session via `allocatePort()` (uia2 requires uniqueness for parallel sessions; fixed-base counters were replaced at the Phase 2 seal — they collide across CONCURRENT kraken runs on one machine);
- `appium:avd` boots the emulator on demand (generous `avdLaunchTimeout`/`avdReadyTimeout` 180 s — cold laptop boots); `appium:udid` targets connected devices;
- actor config passthrough: `app`, `appPackage`, `appActivity`, `udid`, `avd`, plus a raw `capabilities` object merged last (the escape hatch for anything else);
- `webSocketUrl` is never set (BiDi is a browser thing — ADR-0001 §5.6).

### D4 — Locator mapping (ADR-0002 D1)

`testId` → resource-id (package-agnostic `resourceIdMatches(".*:id/<value>")` for unqualified ids); `text` → `UiSelector().text/textContains`; `a11y` → content-desc (`~`); `native` → raw selector passthrough. `pressKey` → `mobile: pressKey` with real key codes (enter 66, escape 111, tab 61 — back left SemanticKey at contract 2.0, see ADR-0002 Amendment 1). `navigate` → `mobile: deepLink` with the session's `appPackage`. `scrollIntoView` → `UiScrollable().scrollIntoView` with a plain-find fallback.

### D5 — Import safety and testing tiers

The main entry imports neither appium nor webdriverio at top level (dynamic imports inside `start()`/`createSession()` — ADR-0001 §5.5); appium is imported through a **non-literal specifier** because it ships raw `.ts` type sources that break strict `verbatimModuleSyntax`. Test tiers: unit (mocked `WdioBrowserLike` — in `pnpm check`), live-boot (real embedded server, no devices — in `pnpm check`, ~1 s), device-gated CTK (`KRAKEN_DEVICE_TESTS=1`, real emulator + the pinned native-demo-app fixture — emits `parity-reports/parity-report.android.json`, the M1 gate artifact).

## Consequences

- The generated home is disposable state (never the version source); `rm -rf .kraken/appium` is always safe.
- The port-allocation race (allocate → boot) is a known small window, accepted for v1 and documented here; the alternative (retrying) is impossible because appium exits the process on collision.
- `kraken doctor` wraps `appium driver doctor uiautomator2` in a later pass; the Kraken-specific checks (ANDROID_HOME, JDK 17+, AVD/device presence, arm64 note) already ship.
