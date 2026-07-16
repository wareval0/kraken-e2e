# ADR-0002: Core Contracts and Session Surface

| | |
|---|---|
| **Status** | **Accepted** (2026-07-03) — implemented in @kraken/contracts + @kraken/core; CONTRACT_VERSION frozen at 1.0 |
| **Date** | 2026-07-03 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §5.3–§5.5, §5.10, §5.12 (ratified 2026-07-02) |
| **Relates to** | ADR-0001 §5.4 (hybrid surface + parity gate + CTK), §5.5 (host gating), §5.10 (version skew), §5.12 (events), §9.2 (deferred core questions) |

## Context

ADR-0001 fixed the shape (hybrid Option C session surface, manifest-gated host detection, contracts as an independently versioned SPI package, single `KrakenEvent` union). This ADR fixes the exact SPI so `@kraken/contracts` and `@kraken/core` can be implemented, and resolves the §9.2 questions assigned to it.

## Decisions

### D1 — The core session surface v1: 11 locator-driven operations (no element handles)

ADR-0001's candidate list included `find(...) → ElementHandle`. **`find` and element handles are dropped from the common surface.** Rationale: handles introduce driver-side state (staleness, invalidation across app navigation — a notorious WebDriver bug class), while every consumer need in the choreography vocabulary is expressible with locator-driven, stateless calls. Drivers stay simpler; the CTK stays deterministic; platform code that genuinely needs handles has `native()`.

```ts
interface UserSession {
  readonly actorId: string;
  readonly driverId: string;
  readonly platform: string;
  readonly capabilities: Readonly<Record<CoreOperation, 'supported' | 'unsupported'>>;
  // The core surface — grows ONLY via the parity gate (ADR-0001 §5.4):
  tap(target: TargetLocator): Promise<void>;
  typeText(target: TargetLocator, text: string): Promise<void>;
  readText(target: TargetLocator): Promise<string>;
  waitFor(target: TargetLocator, state: 'visible' | 'hidden' | 'attached', opts?: WaitOptions): Promise<void>;
  isDisplayed(target: TargetLocator): Promise<boolean>;
  scrollIntoView(target: TargetLocator): Promise<void>;   // intent-level; not a raw gesture
  pressKey(key: SemanticKey): Promise<void>;              // 'enter' | 'back' | 'escape' | 'tab'
  navigate(destination: string): Promise<void>;           // URL (web) / deep link (mobile)
  screenshot(): Promise<ArtifactRef>;                     // path ref, never bytes
  source(): Promise<string>;                              // DOM / view-hierarchy dump
  dispose(): Promise<void>;                               // idempotent — SIGINT teardown calls it
  // Typed escape hatch (declaration merging; zero core→driver imports):
  native<K extends keyof KrakenNativeSessions>(kind: K): KrakenNativeSessions[K];
}
interface KrakenNativeSessions {} // driver-web augments: { web: WebdriverIO.Browser }, etc.
```

`TargetLocator` = `{ by: 'testId' | 'text' | 'a11y', value, exact? }` (portable; drivers map `testId` → `data-testid` / `resource-id` / `accessibilityIdentifier`) plus `{ by: 'native', value }` (explicitly non-portable, CTK-exempt). An op a platform lacks throws `KRK-SESSION-OP-UNSUPPORTED` and is declared in `capabilities` — the CTK renders that visible.

**Deferred capabilities (ADR-0001 §9.2, resolved):** gestures (swipe/pinch coordinates), app lifecycle (background/foreground/install), and permission-dialog handling are **not** in v1's surface and **not** yet optional capability interfaces either — they enter through the parity gate when a real scenario in Phase 2+ demands them, arriving as optional capability interfaces (discoverable via `capabilities`), never as core-surface growth by default.

### D2 — Driver SPI

```ts
interface KrakenDriver<Opts = unknown> {
  readonly [DRIVER_BRAND]: true;                    // Symbol.for('kraken.driver/v1')
  readonly manifest: DriverManifest;                // { kind, id, platforms, version, contract,
                                                    //   platformLabel, hostRequirements?, disabledFix?, setupHints? }
  readonly doctor?: readonly DoctorCheck[];         // env diagnosis contributed to `kraken doctor`
  start(ctx: HostContext, services: DriverServices): Promise<void>;   // boot infra once per run
  createSession(actor: ResolvedActor, services: DriverServices): Promise<UserSession>;
  stop(): Promise<void>;                            // idempotent
}
const driver = defineDriver<Opts>((opts) => spec); // factory-returning; bakes CONTRACT_VERSION + brand
```

ADR-0001's sketches carried both `probe()` and `doctor` checks; **they are unified into `doctor: DoctorCheck[]`** (one mechanism, one rendering path — `probe` is dropped). `DriverServices = { runId, logger, artifactsDir, emit(event), abort }`; drivers never touch stdout (they get `logger`) and never see reporters.

Driver *packages* additionally export a `/manifest` subpath (zero heavy imports) with the same `DriverManifest` object, for pre-import host gating of string-form registrations (ADR-0001 §5.5); the main entry must be import-safe on all hosts.

### D3 — Host detection and gating (C4b, testable by construction)

`HostProbe.detect(): HostInfo` — `systemHostProbe` is the **only** code reading `process.platform`/`process.arch`/`process.version`. `checkHostRequirements(requirements, host)` is a pure function returning `ok` or `{ code, reason, fix }`. The registry consumes an injected `HostProbe`; the mandated non-darwin unit test injects `{ platform: 'linux', arch: 'x64' }` and asserts: `driverDisabled` event emitted, a `DisabledDriver` stub registered whose `createSession` throws `KRK-HOST-IOS-UNSUPPORTED` (driver-specific code from the manifest), and sibling drivers unaffected. In Phase 2 the same test is parameterized over every real driver manifest.

### D4 — Registry and version skew

`DriverRegistry.create({ registrations, host, events, projectRoot? })` accepts value-form (`KrakenDriver` instances from config factories) and string-form (`'@kraken/driver-ios'`, resolved from `projectRoot` via `createRequire`, `/manifest` imported and host-checked **before** the main entry). Checks, in order: brand present → manifest schema valid → contract compatibility (**driver's baked `CONTRACT_VERSION` vs the `CONTRACT_VERSION` core was built against**: same major, driver minor ≤ core minor; duplicate-copy detection reported) → host requirements. Every failure is a `KrakenError` with a stable code and a `fix` string; statuses (`ready` / `unavailable-on-host` / `incompatible` / `invalid`) feed `kraken doctor` and `plugins list`.

### D5 — Events

`KrakenEvent` is one discriminated union (envelope `{ type, ts, runId, seq }` + correlation ids), with exactly the families ADR-0001 §5.12 lists (including `signalWaitStarted`). Types live in `@kraken/contracts` (pure TS — contracts stays dependency-clean); **zod schemas live inside `@kraken/core`** (internal validation + generated JSON Schema + the additive-only snapshot test). `EventBus` stamps `ts`/`runId`/monotonic `seq`, fans out to `Reporter.onEvent` preserving per-reporter ordering via promise chains (a slow reporter never blocks the run loop; `flush()` awaits all chains). Reporter errors are caught, reported once to stderr-logger, and never fail the run.

### D6 — Errors

`KrakenError extends Error` with stable `code` (`KRK-<DOMAIN>-<SPECIFIC>`; domains: HOST, CONFIG, PLUGIN, DRIVER, SESSION, SIGNAL, STEP, RUN), optional `fix`, structured `data`, `cause`, `toJSON()`. Codes live in one `as const` registry in contracts; released codes are never renamed/reused. Third-party drivers mint under `KRK-DRV-<ID>-*`.

### D7 — Scheduler and orchestrator (core)

- `ScenarioPlan = { scenarioId, name, actors: ResolvedActor[], nodes: PlanNode[] }`; `PlanNode = { id, actorId, kind: 'step' | 'detach' | 'join', dependsOn: string[], title, run(ctx) }`. Default compilation is a chain (screenplay total order, ADR-0001 D6); `detach` spawns a named task tracked by a `TaskRegistry`; `join` awaits it with a timeout; an unjoined task at scenario end fails the scenario (leak detection).
- **Failure policy (ADR-0001 §9.2, resolved): `failFast` is the default** — on the first failed node, in-flight sibling work is aborted via `AbortSignal` fan-out, then artifacts are captured from **all** actors (screenshot + source, best-effort), then sessions are disposed in `finally` with per-session timeout guards. `drainOthers` is not implemented in v1 (kept as a named future policy; the artifact capture already covers its main benefit).
- Session boot: `Promise.allSettled` across actors; any failure rolls back the already-booted sessions before surfacing `KRK-SESSION-CREATE-FAILED` — never leak an emulator.
- The programmatic API is a plan builder mirroring the DSL semantics (`scenario(name).step(actor, title, fn).detach(...).join(...)`) — same orchestrator, no Gherkin required.

### D8 — CTK (`@kraken/core/ctk`)

`describeDriverConformance({ name, createSession, fixture, reportPath })` registers one vitest case per core operation: each must pass against the fixture or be declared `unsupported` in `capabilities` (with the reason recorded). Emits `parity-report.json` (`op → supported | unsupported(reason) | failing`). The parity pass criterion is ADR-0001 §5.4's verbatim. Phase 1 validates the CTK against `FakeDriver`; fixture apps for real platforms arrive in Phase 2.

### D9 — FakeDriver (`@kraken/core/testing`)

An in-memory driver implementing the full contract: per-actor `FakeScreen` (element map: testId → { text, visible }) plus a shared `FakeAppWorld` so one actor's action can change another actor's screen after a configurable latency — a fake "chat backend" that makes the Phase 1 exit scenario a *real* cross-actor E2E on zero devices. Also configurable failures (op errors, slow ops) for orchestrator tests. FakeDriver is a first-class deliverable, not test scaffolding: it is how the engine stays testable forever.

## Consequences

- Dropping `find`/handles keeps drivers stateless per call; if a future vocabulary genuinely needs handles (e.g., list-item iteration), that is a parity-gate RFC, not a quiet addition.
- Unifying probe into doctor checks removes one SPI method at the cost of doctor checks being the only deep-diagnosis channel — acceptable: they are structured, per-driver, and already the rendering path.
- `failFast`-only keeps v1's failure semantics simple and deterministic; the all-actors artifact capture preserves the diagnostic value `drainOthers` would have bought.
- CONTRACT_VERSION stays `0.x` during Phase 1 and flips to `{ major: 1, minor: 0 }` when this ADR is Accepted at phase close — from then on, the parity gate and the API-surface snapshot test govern every change.

## Acceptance notes (2026-07-03)

- Implemented as specified; two recorded refinements against ADR-0001's letter: (1) §5.12's event list mentioned `driverProbeCompleted` — dropped along with `probe()` when D2 unified deep diagnosis into `doctor` checks (an editorial note was added to ADR-0001); (2) the registry indexes `incompatible` drivers by platform so `driverFor()` reports KRK-PLUGIN-INCOMPATIBLE precisely instead of "unknown platform".
- The string-form load path is exercised by fixture packages under `packages/core/tests/fixtures/` whose gated entry module THROWS on import — proving the `/manifest` pre-gate runs before the main entry is touched.
- Post-verification refinements (2026-07-03): (3) the DisabledDriver stub is realized as an `unavailable-on-host` registry STATUS — `driverFor()` throws the manifest-derived code pre-boot, which is equivalent-or-stronger than a throwing stub; (4) D4's "duplicate-copy detection" is DEFERRED — Symbol.for branding makes duplicate contract copies functionally safe, and detection is revisited only if skew bugs appear in practice; (5) the parity-report status literal is `supported` (not `supported-pass`); (6) join nodes REQUIRE joinTimeoutMs (no silent 30s default — explicit-duration policy); (7) TaskRegistry.register takes a thunk (check-then-start: a duplicate handle never leaves an untracked task running) and drain() is budget-bounded (abort-ignoring tasks fail the scenario instead of hanging the run).

## Amendment 1 (2026-07-04, human-ratified): SemanticKey redefined — contract 2.0

The M1 parity gate blocked on a pressKey asymmetry (Android supported, iOS unsupported). The ratifier chose "block and search" over sign-off; the mandated research (live HID probing on the booted iOS 18.6 simulator) concluded:

- **enter/escape/tab have a FAITHFUL iOS implementation**: device-level HID keyboard events via `mobile: performIoHidEvent` (page 0x07, usages 0x28/0x29/0x2B) — Return commits+dismisses, Escape performs UIKit's hardware-Escape cancel, Tab behaves as hardware Tab. No hardware-keyboard setting required; the same injection path WDA itself uses for its clear-text shortcut.
- **'back' is not a key on iOS at any OS layer**: even the HID Consumer 'AC Back' event (page 0x0C, usage 0x224) is accepted by WDA and ignored by iOS (live-tested); nav-bar back and edge-swipe are app-specific conventions, not system key semantics.
- `mobile: keys` (typeKey) was empirically DISQUALIFIED on iPhone: printable characters only; named keys silently no-op (plus a WDA 15.1.x dict-form defect).

**Decision (ratified):** `SemanticKey = 'enter' | 'escape' | 'tab'`; Android's BACK leaves the cross-platform surface (reachable via native()/raw flows; candidate for a future Android-only capability). BREAKING → **CONTRACT_VERSION 2.0** (the api-surface snapshot was regenerated in the same commit — the versioning machinery exercising itself). pressKey is now symmetric-supported; the gate asymmetry is RESOLVED faithfully rather than signed off — the §5.4 governance mechanism working end to end.

## Amendment 2 (2026-07-09): contract 2.1 — device enumeration (`kraken devices`)

Field feedback from the first tutorial users: with real devices there was no
way to see what the machine already had (booted simulators, running emulators,
connected devices, installed browsers) to REUSE it, and misconfigured runs
failed slowly and cryptically. Additive SPI change → **CONTRACT_VERSION 2.1**:

- `KrakenDriver.listTargets?(host): Promise<readonly DeviceTarget[]>` —
  optional, cheap, read-only, never boots anything. `DeviceTarget` carries
  `state: 'running' | 'available'` and a ready-to-paste `actorConfig`
  (running targets pin by udid/serial — instant reuse; available iOS sims pin
  BOTH deviceName+platformVersion, the ADR-0008 D6 anti-ghost rule encoded).
- The CLI composes it as `kraken devices` (same composition pattern as doctor).
- Alongside (not contract-level): mobile drivers now FAIL FAST with
  `KRK-DRIVER-APP-NOT-FOUND` when an actor's app file is missing (was: minutes
  of emulator boot before Appium's error), and driver-web keeps its browser-
  driver cache project-local (`.kraken/browser-cache`) so a corrupted OS-tmp
  cache can never break runs again.
