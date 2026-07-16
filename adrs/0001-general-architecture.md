# ADR-0001: Kraken 3.0 General Architecture

| | |
|---|---|
| **Status** | **Accepted** (2026-07-02) — deviations [D3], [D4] and [D6] ratified by the team the same day; see the ratification log at the end of §9.1. Factual-refresh deviations (D1, D2, D7, D10, D11) took effect unvetoed. |
| **Date** | 2026-07-02 |
| **Deciders** | Software Design Lab (Universidad de los Andes) + Claude (Fable 5, lead implementer) |
| **Supersedes** | `adrs/context.md` (working draft v0.1) — kept in the repo as historical input |
| **Note on file naming** | The team brief referred to this file as `ADR-0001-arquitectura-general.md`. Per the project-wide English-only rule (constraint C12 below), ADRs are named `NNNN-title.md` in English. |

Every ecosystem fact in this document (versions, release dates, maintenance status) was **verified against the live ecosystem on 2026-07-02** by a fan-out of research agents with web access — not recalled from training data. The one exception is marked inline (§5.13, safaridriver session limit). Key sources are in §10.

---

## 1. Context

Kraken is an open-source E2E testing tool from the Software Design Lab whose differentiator is **multi-user / multi-device inter-communication testing**: one scenario choreographs two or more users on different devices/platforms (one sends a chat message from an Android app, another verifies it in Safari on iOS, a third checks a web dashboard), synchronized during execution. The canonical academic record: Kraken-Mobile (ICSME 2019, IEEE 8918941), Kraken (Science of Computer Programming 206:102627, 2021), Kraken 2.0 (SCP 225:102897, 2023; ICSE 2022 demo, IEEE 9825889).

Both prior implementations are dormant and unmaintainable: v1 (`github.com/TheSoftwareDesignLab/KrakenMobile`, Ruby/Calabash — Calabash itself is long abandoned) last released February 2021; v2 (`github.com/TheSoftwareDesignLab/Kraken`, Node/Cucumber/old Appium/old WDIO) has zero published releases and pins dead dependency lines. Those two repositories are also the **v1/v2 scenario corpus** referenced throughout this document (the evidence base for the D6 lanes decision, §5.9/§7). The predecessors died of **dependency rot plus loss of inherited context** across thesis-student rotations, not of a flawed idea. The 2026 landscape scan (§6) confirms the idea's gap in the market still exists.

Kraken 3.0 is a **complete rewrite** — no backward compatibility with v1/v2 specs, APIs, or Gherkin vocabulary. This ADR is the architecture umbrella: it ratifies or amends every decision in the preliminary architecture document (`context.md`), declares all deviations explicitly, and defines the decisions finer-grained ADRs will elaborate per phase (§9.3).

### 1.1 Development environment (as of 2026-07-02)

All development runs on a single MacBook Pro M1 Pro. Inventory taken on this machine: macOS 26.5.1 (arm64), Xcode 26.6 with iOS 18.6 and 26.5 simulator runtimes, Node v22.19.0, npm 11.6.0, corepack 0.34 (pnpm not yet installed), OpenJDK 21, full Android SDK at `~/Library/Android/sdk` with `ANDROID_HOME` set. This host can exercise all three target platforms locally — which is exactly why host-platform detection must be explicit code, not an ambient assumption (constraint C4b).

---

## 2. Decision drivers (non-negotiable constraints)

Restated from the team brief so this document is self-contained for future maintainers:

- **C1** TypeScript strict everywhere; Node.js 22 LTS as target runtime *(amended by [D1]: Node 22 becomes the engine floor, not the ceiling)*.
- **C2** Hexagonal architecture: `@kraken/core` never imports or knows Appium/ADB/WebdriverIO/browsers; everything crosses contracts implemented by `driver-*` packages.
- **C3** Android/iOS feature parity within the same milestone — never "Android now, iOS someday".
- **C4** iOS only runs on macOS (Apple restriction via Xcode/XCUITest/WebDriverAgent); surfaced in `kraken doctor` and docs as a structural fact.
- **C4b** Host OS+arch detection at runtime in the core, hard-disabling the iOS driver with an explicit message on non-`darwin` hosts; at least one unit test forces the non-Apple branch.
- **C5** No hand-rolled signaling plumbing: build on WebdriverIO's session primitives; `@kraken/signaling` is business semantics (named signals, wait/send, timeouts) on top *(interpreted by [D4] — see §5.6 and §5.7 for what "on top" can and cannot mean, verified)*.
- **C6** BDD/Gherkin stays as the primary scenario language, with a from-scratch vocabulary and typed TypeScript step definitions (no magic strings).
- **C7** Monorepo: pnpm workspaces + Turborepo; each package independently versioned/publishable via Changesets.
- **C8** CLI on oclif + Ink with a real plugin architecture (`kraken plugins:install @kraken/driver-ios` must actually work) *(mechanism amended by [D15])*.
- **C9** Core emits structured events (GUI-ready) so a future GUI subscribes without touching the core. No GUI is built now.
- **C10** Diagnosable provisioning: `kraken doctor` explains what is missing with actionable messages.
- **C11** Quality infrastructure for Kraken itself: Biome, Vitest with real coverage, Changesets, ADRs. CI (GitHub Actions) is out of scope for now, but nothing may hardcode paths/credentials/assumptions that only hold on the current dev machine.
- **C12** Everything — code, UI, comments, docs — in English, with standard naming conventions. *(Scope note: user-authored test data inside example scenarios, and Gherkin's built-in `# language: es` dialect for end users, are outside C12's scope.)*

Two project-level drivers sit above all of these: **survive multi-year thesis-student rotation** (the reason v1/v2 died) and **protect the differentiator** (concurrent multi-actor choreography; everything else exists to support it).

---

## 3. Deviations from `context.md` — declared explicitly

This ledger is exhaustive: every `context.md` decision is either in the ratified list at the end of this section or in a row below. Full arguments live in the referenced sections; the rows are verdicts.

| # | `context.md` said | ADR-0001 decides | Why (short) | Weight |
|---|---|---|---|---|
| **D1** | "Node.js 22 LTS" as target runtime | Engine floor `node >=22.12`; develop and document on **Node 24 (the actual Active LTS)**; planned floor bump when Node 22 EOLs (2027-04-30). §5.1 | Node 22 entered *Maintenance* LTS in Oct 2025. Not gated on ratification because C1's letter is preserved: Node 22 remains a fully supported runtime (it is the floor); only the primary dev/doc line moves. The team may veto the dev-line move at the §9.1 review. | Minor — factual refresh, vetoable |
| **D2** | TypeScript 5.x | **TypeScript 6.0.x** (5.9.3 closed the 5.x line Oct 2025; 6.0 is the designed bridge to the Go-native TS 7, at RC now). §5.1 | Starting on 5.x would mean an immediate migration. | Minor |
| **D3** | BDD via `@cucumber/cucumber` (cucumber-js runtime) | **Custom runner** on the official parser stack (`@cucumber/gherkin` + `cucumber-expressions` + `tag-expressions` + `messages`); cucumber-js is not an execution dependency. Full argument: §5.8. Coupled to D6 — see the coupling note in §5.8. | cucumber-js's execution model cannot express Kraken's concurrency model; the parser layer is the durable asset; playwright-bdd proved the cost. | **Major — requires ratification** |
| **D4** | Signaling built on **WDIO Multiremote** | **N independent WDIO `remote()` sessions** (one per actor) owned by Kraken's session manager; `multiremote()` demoted to prior art. WDIO remains the session/protocol substrate. Full argument: §5.6. Includes an honest correction of C5's premise — WebDriver has **no** cross-session messaging primitive, so the signal store itself is necessarily Kraken-owned (§5.7); the ratifier is approving that too. | Source-verified: every multiremote broadcast is a lockstep barrier — the opposite of independent per-actor stepping. | **Major — requires ratification** (touches C5's letter, not its spirit) |
| **D5** | Roadmap: *"Fase 1"* = Android e2e (weeks 4–8), *"Fase 2"* = iOS+Web (weeks 9–14); *"doctor mínimo"* in *"Fase 0"* (quoted from the Spanish draft) | Milestones restructured so **no functional release exists before Android+iOS parity** (§7). Also: doctor's *driver-dependent* checks move to Phase 2 deliberately (they ship with the drivers they diagnose); a minimal doctor (Node/pnpm/host checks) ships in Phase 1. | `context.md`'s phase split contradicted non-negotiable C3; the constraint wins. | Structural — enforces C3 |
| **D6** | (implicit) v2-style signal-heavy vocabulary | DSL default: **single choreography file, actor-addressed steps, deterministic "screenplay" total order** on a DAG scheduler; escape hatches = detached tasks + SDK-level signals **plus one built-in feature-file wait step**; concurrent lanes deferred behind the v2-corpus review (scheduled in Phase 1, §7). Full argument: §5.9. | Product-shaping choice; recommended with rationale; genuinely contestable. | **Major — requires ratification** |
| **D7** | appium-xcuitest-driver 10.x ("Appium-3-only") | **xcuitest ^11** (current major since 2026-04-14; also Appium-3-only) and **uiautomator2 ^8** (ESM-only since 8.0.0) | The 10.x claim was true when written, stale now. | Factual refresh |
| **D8** | Monorepo scaffold includes `.github/workflows/` | Removed from initial scaffold | CI explicitly out of scope (C11); design still avoids machine-specific assumptions so CI can be added later. | Minor |
| **D9** | 12 packages | **+2 packages**: `@kraken/contracts` (zero-runtime-dep SPI, independently versioned — the load-bearing piece of version-skew policy, §5.10) and `@kraken/tui` (the only package importing Ink, §5.11) | Both protect rotation survival: contracts decouple driver compatibility from core releases; tui quarantines Ink's fast major churn. | Minor addition |
| **D10** | Allure 3 adopted (its GA status unstated/unverified at writing time) | Allure 3 confirmed **GA** (3.0.0 on 2025-12-22; 3.14.0 current); custom-runner integration path officially documented | Risk retired. | Refresh |
| **D11** | Redis adapter for distributed signaling (library unspecified) | Future Redis transport must use **node-redis with Streams**; `ioredis` is officially deprecated for new projects | Adopting ioredis would recreate the dead-dependency failure mode. | Minor, binding for Phase 4 |
| **D12** | Reporting: Allure 3 + **own HTML reporter** + JSON + live terminal | Reporter set: **Allure 3 + CTRF + JSONL event log + terminal** (§5.12). The first-party HTML reporter is dropped: Allure 3's generated HTML covers it; CTRF/JSONL cover machine-readable output. Revisit only if Allure proves insufficient. | One fewer custom artifact for students to maintain. | Minor |
| **D13** | Credentials: properties file → `.env` + optional keychain/vault | **Deferred, not designed here**: secrets handling for actor sign-in data is assigned to ADR-0004 (step/config surface), with `.env`-based loading as the working recommendation. No package owns it yet. | Needs the config/step surface to exist first. | Minor — deferred |
| **D14** | Distribution: npm + Homebrew + Docker + Node SEA binary | **npm-first** (Phase 4, human-gated). Homebrew/Docker deferred past 3.0. **Node SEA demoted to exploratory**: still officially "Active Development" stability, macOS x64 unsupported, and single-file bundling structurally conflicts with oclif's dynamic plugin loading (§5.15). | Channel reduction; verified SEA immaturity. | Minor |
| **D15** | CLI plugins delivered via oclif's native plugin system | `kraken plugins:install` implemented by a **Kraken-owned `plugins` topic over exact-pinned project devDependencies**; `@oclif/plugin-plugins` deliberately not shipped (its per-user dataDir semantics sit outside the project lockfile — structurally wrong for runtime drivers). C8 stays satisfied: the command is real and both separator forms work (§5.10). | Reproducibility across machines/years requires lockfile-governed drivers. | Minor — mechanism change |

Everything else in `context.md` is **ratified**: hexagonal core + driver plugins, pnpm + Turborepo, Biome, Vitest, Changesets, oclif + Ink, typed `kraken.config.ts`, faker + zod data generation, cross-platform fuzzing engine, `kraken doctor`, host-platform gating as a first-class core capability, CI out of scope.

---

## 4. Verified ecosystem baseline (2026-07-02)

Pin targets for Phase 0. "Floor" = minimum enforced; exact pins live in lockfiles and package manifests (see §5.10 for how Appium drivers are pinned) and are bumped via a documented quarterly ritual (§8.3).

| Area | Package | Verified state (2026-07-02) | Kraken target |
|---|---|---|---|
| Runtime | Node.js | 24 Active LTS (EOL 2028-04); **22 Maintenance** (EOL 2027-04); 26 Current → LTS Oct 2026 | `engines: >=22.12`; develop on 24 |
| Language | typescript | **6.0.3** stable; 7.0 (Go-native `tsgo`) at RC, GA ~July 2026 | 6.0.x; keep tsconfig 7-compatible; no tsc-API coupling |
| Package manager | pnpm | **11.9.0** (v11: Node ≥22, pure ESM, SQLite store) | 11.x + workspace catalogs |
| Build orchestration | turbo | **2.10.2**, active | 2.x |
| Lint/format | @biomejs/biome | **2.5.2**; v2 type-aware linting (~75% parity on floating-promise detection vs typescript-eslint) | 2.x; lint task kept swappable per package (§5.16) |
| Unit tests | vitest | **4.1.9** (`projects` config; AST-based V8 coverage); 5.0 in beta | 4.x pinned |
| Releases | @changesets/cli | **2.31.0**, still the pnpm-monorepo standard | 2.x |
| Mobile automation | appium | **3.5.2** (3.0 GA 2025-08-18); engines `^20.19 \|\| ^22.12 \|\| >=24`; embeddable via typed `main(args) → Promise<AppiumServer>`; ships `appium driver doctor <name> --json` | 3.5.x, embedded in-process (§5.10 for pinning) |
| Android driver | appium-uiautomator2-driver | **8.0.1** (ESM-only since 8.0.0; Appium-3-only since 5.0.0; min Android API 26; needs JDK + `ANDROID_HOME` + platform-tools) | ^8, exact-pinned |
| iOS driver | appium-xcuitest-driver | **11.17.1** (Appium-3-only since 10.0.0; supports the latest two Xcode majors — currently 16.x and 26.x; WDA needs no signing on simulators) | ^11, exact-pinned |
| Session substrate | webdriverio | **9.29.1**; ≥9.27.0 is the Appium 3 protocol-compat floor (PR #15141); v10 milestone due 2026-07-28 (breaking: Node ≥22 — a no-op for us); BiDi default for Chrome/Edge/Firefox, Safari classic-only | ^9.27 now, early v10 adoption |
| Gherkin stack | @cucumber/gherkin / cucumber-expressions / tag-expressions / messages | **41.0.0 / 20.0.0 / 10.0.0 / 33.0.4** — all released within 3 weeks of today; parser has 5.6M weekly downloads (2× cucumber-js), maintained cross-language independent of the runner | Lockstep-pinned, quarterly bump |
| CLI framework | @oclif/core | **4.11.14** (near-daily Salesforce cadence; v4 stable since June 2024; plugins can contribute hooks; `topicSeparator: " "` keeps `:` as alias) | 4.x |
| Terminal UI | ink | **7.1.0** (Node ≥22, React ≥19.2, ESM-only). ⚠ ink-testing-library stale since May 2024 — spike required | 7.x, isolated in `@kraken/tui` |
| Reporting | allure / allure-js-commons | **3.14.0 GA / 3.10.2**; custom-runner integration documented (`ReporterRuntime` + `createDefaultWriter`) | First-party reporter |
| Neutral JSON report | CTRF | Pre-1.0, spec "ready for use", v1.0.0 targeted Q3 2026; wide adoption (346k wk/dl playwright reporter) | Emitter with pinned `specVersion` |
| Config loading | jiti | 2.7.0 (engine behind ESLint/Nuxt/Tailwind TS configs) | `kraken.config.ts` loader |
| Schema validation | zod | 4.x stable | Internal only — never in public type surface |
| Apple toolchain | Xcode / macOS / iOS | Xcode **26.6** (Xcode 27 beta announced WWDC June 2026); macOS Tahoe 26.5.x; iOS 26 automation needs Xcode ≥26 + driver ≥9.5.0 | doctor encodes the "latest two Xcode majors" window |
| Android toolchain | SDK | cmdline-tools 21.0 (**JDK 17+ required**); platform-tools 37; arm64-v8a images: google_apis API 21–36.1, **Play Store images only API ≥28**; no x86 images run on Apple Silicon | doctor validates arm64 image + API ≥26 |

---

## 5. Decisions

### 5.1 Runtime, language, module system

- **Node**: `engines: { "node": ">=22.12.0" }` — a floor, not a whitelist (`^22 || ^24` would wrongly block Node 26+). 22.12 is where `require(esm)` is unflagged. Primary development on Node 24 LTS. `kraken doctor` reports the running Node line's LTS status. Floor bump to `>=24` planned when Node 22 EOLs (April 2027) — recorded here so a future student knows it is expected, not drift.
- **TypeScript 6.0.x**, `strict: true` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No custom transformers, no programmatic tsc-API coupling — keeps the imminent switch to the ~10× faster Go compiler (TS 7 / tsgo) a drop-in.
- **ESM-only** for the whole `@kraken/*` family (`"type": "module"`, `exports` maps, no dual builds). With a ≥22.12 floor, CJS consumers can still `require()` the packages — **provided no `@kraken/*` entry graph contains top-level `await`** (the one condition on `require(esm)`); this is enforced by a lint rule, not hoped for. Dual publishing would be pure maintenance drag on rotating students. The ecosystem is aligned: WDIO v9, Vitest, pnpm 11, uiautomator2 ≥8 are all ESM-first; oclif fully supports ESM CLIs.

### 5.2 Monorepo & tooling

pnpm 11 workspaces (+ **catalogs** to pin shared dependency versions in one place — a direct rotation-survival play) + Turborepo 2.x (`build`, `test`, `lint`, `typecheck` pipelines; local cache only — no vendor-linked remote cache). Biome 2.x for lint+format. Vitest 4.x with root-level `projects` and `@vitest/coverage-v8`. Changesets for independent versioning. Node version pinned via `.nvmrc` + `engines` — never via absolute paths (C11).

### 5.3 Package topology

```
kraken/
├── packages/
│   ├── contracts/        @kraken/contracts       zero-runtime-dep SPI: driver/reporter
│   │                                             interfaces, event types, error codes,
│   │                                             defineDriver/defineReporter, CONTRACT_VERSION;
│   │                                             re-exports signaling's transport SPI type-only
│   ├── core/             @kraken/core            orchestrator, session manager, DAG step
│   │                                             scheduler, plugin registry, host detection,
│   │                                             event bus; exports the CTK at @kraken/core/ctk
│   ├── signaling/        @kraken/signaling       standalone signal log; OWNS the SignalTransport
│   │                                             SPI; transports + transport-conformance suite
│   ├── gherkin/          @kraken/gherkin         .feature parsing (official Gherkin stack),
│   │                                             typed step registry, scenario compiler,
│   │                                             built-in choreography/system steps
│   ├── config/           @kraken/config          defineConfig, jiti loading, validation
│   ├── cli/              @kraken/cli             oclif commands; the COMPOSITION layer that
│   │                                             wires core+doctor+tui+reporters together
│   ├── tui/              @kraken/tui             Ink live UI — the ONLY package importing ink
│   ├── driver-android/   @kraken/driver-android  Appium 3 + uiautomator2
│   ├── driver-ios/       @kraken/driver-ios      Appium 3 + xcuitest (hostRequirements: darwin)
│   ├── driver-web/       @kraken/driver-web      WebdriverIO native (BiDi where available)
│   ├── doctor/           @kraken/doctor          pure check-execution engine (see §5.13 for
│   │                                             how inputs are injected)
│   ├── reporters/        @kraken/reporters       allure, ctrf, jsonl, plain-line
│   ├── data-gen/         @kraken/data-gen        faker + zod-validated typed fixtures
│   └── fuzz/             @kraken/fuzz            cross-platform random-event engine
├── examples/
│   └── multi-user-android-ios-web/               flagship 3-platform scenario (Phase 3)
├── apps/docs/                                    VitePress + TypeDoc (Phase 4)
└── adrs/
```

**Dependency direction rules** (enforced by lint/review, violations are architecture bugs). Runtime dependencies:

```
signaling  ← nothing (standalone-first; owns the SignalTransport SPI)
contracts  ← signaling (TYPE-ONLY re-export, erased at runtime — contracts stays zero runtime deps)
core       ← contracts, signaling
gherkin    ← contracts, core
config     ← contracts
drivers    ← contracts ONLY (peerDependency; never @kraken/core)
reporters  ← contracts ONLY
tui        ← contracts (event types); owns ink+react
doctor     ← contracts, config
cli        ← everything above; the composition/entry layer
```

Sanctioned exceptions, explicit so nobody "discovers" them as violations:
- **Drivers may take `@kraken/core/ctk` as a devDependency** to run conformance tests (§5.4). Runtime rule unchanged.
- **A driver's optional step library** (`@kraken/driver-android/steps` subpath) may peer-depend on `@kraken/gherkin` for the step-authoring API. The driver's runtime entry still depends on contracts only.

WebdriverIO/Appium types appear **only** inside `driver-*` packages. Ink types appear **only** inside `tui`. zod never appears in any public `.d.ts`.

### 5.4 The hexagonal boundary: how much automation surface does core abstract?

The hardest design question. Three options were analyzed:

- **A — thick core** (full device-command vocabulary in core, drivers translate): maximum decoupling, but historically fatal — the lowest-common-denominator API lags platforms and accretes without limit; it is the Calabash pattern that killed Kraken v1.
- **B — thin core** (core only orchestrates lifecycle/actors/signals; steps consume opaque platform sessions): best raw survivability, but kills the differentiator — every cross-platform step gets written three times, and C3's parity requirement becomes unmeasurable because there is no common surface to measure against.
- **C — hybrid (CHOSEN)**: core defines a **frozen, minimal common `UserSession` surface** — working label **"the core surface"** (nicknamed Core-15; the exact operation list is fixed in ADR-0002; the initial candidate set is `find, tap, typeText, readText, waitFor, isDisplayed, screenshot, navigate, pressKey, scrollIntoView, source, dispose` plus capability introspection) — over **portable locators** (`testId` → `data-testid` / `resource-id` / `accessibilityIdentifier`; `text`; `a11y`; plus an explicitly non-portable `native` strategy), and a **typed escape hatch** to the platform-native session via TypeScript declaration merging (`session.native('web')` → `WebdriverIO.Browser`, typed by the driver package, zero core→driver imports). Note `scrollIntoView` is *intent-level* (bring element into view) and stays; raw gesture primitives (swipe/pinch coordinates) are what ADR-0002 decides as optional capabilities.

Option C is only safe with two structural guardrails, which are **part of this decision**, not documentation:

1. **Parity gate.** The common surface grows *only* via: an RFC note + a Conformance Test Kit case + passing implementations in **both** mobile drivers within the same change. This turns death-by-accretion from a discipline hope into a process impossibility.
2. **Conformance Test Kit (CTK).** Exported at `@kraken/core/ctk`, consumed by driver packages as a devDependency (§5.3). It exercises every common operation against a driver + fixture app and emits `parity-report.json` (`op → supported | unsupported(reason) | failing`). **Parity pass criterion, precisely**: zero `failing` entries on both platforms **and an empty diff between the Android and iOS supported-op sets**. A *symmetric* `unsupported(reason)` (both platforms) is allowed and enumerated in the milestone notes; an *asymmetric* `unsupported` blocks the milestone unless a human signs it off, with the sign-off recorded in the report artifact. This is the operational meaning of C3.

`driver-web` runs the same CTK (with `unsupported(reason)` permitted where the web genuinely lacks an operation) and publishes its own report in Phase 3; the parity *gate* (blocking rule) remains mobile-only per C3.

*(Amendment pointer 2026-07-04: SemanticKey was narrowed to enter|escape|tab at contract 2.0 — see ADR-0002 Amendment 1; the parity-gate governance this section designed ran end-to-end on its first real case.)* Gestures, app lifecycle (background/install), and permission-dialog handling are **not** in the initial common surface; they are candidate optional capability interfaces, to be decided in ADR-0002 with real scenario evidence.

Core also ships a **FakeDriver** implementing the full contract in-memory: the entire engine (orchestrator, scheduler, signaling, reporting) is unit-testable with zero devices — this is what makes "tests from the first commit of logic" real.

### 5.5 Host platform detection — first-class, injectable, tested

- A single `HostProbe` service is the **only** place `process.platform` / `process.arch` are read. Everything downstream receives an injected `HostInfo`.
- Every driver package exposes a **`/manifest` subpath export**: a tiny module with zero heavy imports declaring `{ id, contractVersion, platforms, hostRequirements, disabledFix }` (`disabledFix` = the actionable remediation string shown when the driver is host-disabled).
- **Import-safety rule** (reconciles this section with §5.10's factory-form registration): every driver package's **main entry must be import-safe on all hosts** — no top-level imports of Appium/WDIO/native dependencies; heavy modules are dynamically imported inside `start()`/`createSession()`. Enforced by lint plus a Linux-container import smoke test. Host gating then works for both registration forms: for the *string* form the registry imports `/manifest` and checks `hostRequirements` **before** importing the main entry; for the *factory* form (config already imported the entry — safely, per this rule) the registry checks the manifest carried by the value before any heavy path runs.
- On an unmet requirement the registry emits a `driverDisabled` event and registers a stub whose `createSession` throws `KRK-HOST-IOS-UNSUPPORTED` with an actionable message ("The iOS driver requires macOS (Xcode/XCUITest is an Apple platform restriction). This host is linux/x64. Android and Web remain available."). Scenarios not binding an iOS actor run normally; a scenario that does fails **fast, pre-run**.
- Because the probe is injectable, the C4b unit test is trivial and honest: inject `{ platform: 'linux', arch: 'x64' }`, assert the `driverDisabled` event, the stub's error code, and that other drivers still load. This ships in Phase 1 against FakeDriver + a fake darwin-only manifest; **in Phase 2 the same test is parameterized over every real shipped driver manifest** (a typo like `"darwn"` in driver-ios's manifest must fail a test, not silently gate nothing) — this is a Phase 2 exit criterion (§7).
- `kraken doctor`, CLI banners, and the README all surface the same single source of truth.

### 5.6 Session substrate — N independent sessions, not `multiremote()` **[D4 — ratify]**

Kraken's execution model is N concurrent per-actor step programs whose only legal synchronization points are explicit, named constructs. Verified against WDIO 9 source:

- `multiremote()` is a thin wrapper that calls `remote()` once per named capability, then wraps instances in a broadcast proxy where **every awaited command is a `Promise.all` lockstep barrier** (resolves at the slowest instance). The docs say it verbatim: multiremote "is *not* meant to execute all your tests in parallel".
- It has no public API to add/remove instances after creation; broadcast failures reject wholesale; an open bug (webdriverio PR #15218) has one browser closing its windows kill the entire pod; per-name property access is marked "deprecate and remove" in source.

Implicit barriers are undeclared synchronization points: they can mask real app races locally and un-mask them the day execution is distributed. Design principle, given that v1/v2 died of flakiness: **no implicit synchronization anywhere — every ordering guarantee is either per-actor step FIFO or an explicit construct.**

Therefore: each driver creates **one independent WDIO `remote()` session per actor**; `@kraken/core`'s session manager owns bootstrap (`Promise.allSettled` with rollback — never leak a booted emulator when actor 3/3 fails), name lookup, failure isolation (AbortSignal fan-out), and `finally`-guarded teardown. That is ~20 lines replacing multiremote's two useful features (parallel boot, named lookup). Actors are logical threads (promise chains) in one Node process — WebDriver commands are I/O-bound, so worker threads would add serialization cost for nothing.

**C5 compliance, stated honestly:** WebdriverIO remains the substrate — sessions, protocol, capabilities, BiDi/classic negotiation are all WDIO's; Kraken hand-rolls no session plumbing and no file/polling signaling. Two qualifications the ratifier is approving: (1) the deviation from C5's *letter* is which WDIO API arranges concurrency — N `remote()` calls instead of the `multiremote()` wrapper whose semantics contradict the product; (2) C5's premise that WDIO offers signaling primitives to "build on top of" turned out to be partially incorrect — WebDriver has **no cross-session messaging primitive** (context.md §7 itself conceded "wait for signal X" was never free), so the signal *store* in §5.7 is necessarily Kraken-owned; what C5 correctly prohibits, and what we do not do, is reinventing session management or reverting to v1/v2's file-polling.

Never `@wdio/appium-service` (testrunner-only; historically the source of most multiremote+Appium bugs) — drivers own the Appium server lifecycle via Appium 3's typed programmatic API (`main(args) → AppiumServer`), with a spawn-the-binary fallback behind the same port. Capability rules: never set `webSocketUrl` on Appium caps; BiDi is a progressive enhancement for Chrome/Edge/Firefox actors; Safari and native-app actors run classic WebDriver.

### 5.7 Signaling — `@kraken/signaling`

A standalone library (usable without Gherkin or WDIO; zero runtime dependencies), built as **a scoped append-only signal log with per-subscriber cursors** — the shape of Redis Streams, which is exactly the future distributed transport:

- `publish(name, payload)` appends `{seq, name, from, payload}` to the `{runId, scenarioId}` scope's log; resolves when durably ordered; never blocks on receivers.
- `waitFor(name, {timeoutMs, from?})` resolves **exactly one record per call**: the earliest record newer than the subscriber's cursor for that name — *replaying history first, then waiting live*. The v2 killer race (signal sent before the receiver waits → lost forever) is **defined away**, not patched.
- **Subscriber identity, precisely** (the term every delivery rule hangs on): cursors are keyed by `(subscriberId, signalName)`; the `subscriberId` **defaults to the waiting actor's id** (each actor's `ctx.signals` handle is bound to it). *Broadcast* means **distinct subscribers each independently receive the same record** (delivery never deletes; alice, bob and carol can all wait for `message-sent`). *FIFO counting* means **successive waits by the same subscriber on the same name consume successive records** (a loop publishing 3× satisfies 3 sequential waits by one subscriber, in order). Concurrent same-subscriber waits on the same name and non-consuming `peek` variants are ADR-0003 questions (§9.2) — not silently decided here.
- Timeouts reject with a `SignalTimeoutError` carrying the full in-scope history snapshot plus fuzzy near-miss name suggestions — turning "flaky" into "bob waited for `mesage-sent` but alice published `message-sent` at seq 4".
- **Transport parity is enforced, not hoped for**: a shipped conformance suite (`publish-before-wait`, ordering, loop-counting, multi-waiter, scope isolation, never-synchronous resolution via microtask deferral, JSON round-trip payload isolation with a size cap, destroy-rejects-waiters) runs against every transport — the in-memory one now, Redis Streams (node-redis) and WebSocket later, and any student-written one. A ChaosTransport decorator (injected latency/disconnects) **ships with the conformance suite in Phase 1**, so distributed-mode bugs surface years before a device farm exists.
- In-memory transport: `Map`-based log; `EventEmitter` only as internal wakeup, never as the store.

### 5.8 BDD layer — custom runner on the official Gherkin stack **[D3 — ratify]**

`@kraken/gherkin` parses features with `@cucumber/gherkin` (AST → pickles), matches steps with `@cucumber/cucumber-expressions` (typed parameters, custom `{actor}` type), filters with `@cucumber/tag-expressions`, and emits `@cucumber/messages` envelopes for ecosystem compatibility — but **execution is Kraken's own scheduler** (§5.9). Reasons, in order:

1. **Capability**: cucumber-js cannot express concurrent per-actor lanes inside one scenario (one World per scenario, strictly sequential steps, worker-thread parallelism only at whole-pickle granularity — all documented). Bending it means either sequential-only choreography or reviving v2's fragile N-coordinated-processes design.
2. **Survivability**: the parser stack is the durable asset — maintained cross-language in its own monorepos, 5.6M weekly downloads (2× cucumber-js), consumed independently by playwright-bdd (~366k/wk), cypress-cucumber-preprocessor, and others. cucumber-js itself is community-owned since Dec 2024 but effectively one spare-time maintainer on a funding deficit; even WDIO's own cucumber adapter is pinned three majors behind it — the embedding treadmill in action.
3. **Proven cost**: playwright-bdd removed the cucumber-js runner in v7 (2024) and rebuilt only a step registry, hooks, tag filtering, and messages emission — modest, well-trodden scope.

**Coupling with D6, stated for the ratifier**: D6 defers concurrent lanes, and its corpus review may conclude lanes are never needed — so reason 1 alone would be contingent. The custom runner is justified **even if lanes never ship**, by what v3.0 delivers on day one that cucumber-js's model cannot: per-actor step attribution throughout the event stream and reports; detached tasks with scheduler-integrated leak detection; the dry-run analyzer (static deadlock/actor/capability checking before any device boots); polling-by-default `Then` semantics; and full control of messages emission. And it is **insurance on D6's open question**: if the corpus review pulls lanes forward, the DAG scheduler makes them a feature; under cucumber-js they would be a second rewrite. Reasons 2–3 (bus factor, treadmill, proven cost) are independent of D6 entirely.

100% **standard Gherkin** — no custom keywords, no forked parser — so the official Cucumber VS Code extension, formatters, and the bundled `# language: es` Spanish dialect keep working. Actor addressing lives in step text (verified: tags on steps/Background are parse errors; scenario-level tags are inherited into pickles).

*Anti-regression note for future students:* cucumber-js is healthy enough that someone will ask "why not just use it?" — the answer is the capability-and-insurance argument above plus the maintenance treadmill (reason 2), not a maintenance dodge; swapping it back in would delete per-actor execution semantics and close the lanes door behind a rewrite.

### 5.9 Multi-actor DSL — screenplay semantics with typed escape hatches **[D6 — ratify]**

Kraken v2 sliced one logical test into N tagged per-user monologues joined by stringly-typed signals; a signal typo produced a silent multi-second timeout hang. The 3.0 DSL inverts this:

**One `.feature` file tells the whole choreography; each step is addressed to a named actor; default execution order is the text order — a deterministic "screenplay" total order** implemented on a step-DAG scheduler in core (default compilation: a chain).

```gherkin
Feature: Cross-platform direct messaging
  Background:
    Given the following actors are signed in:
      | actor | user      |
      | alice | a.ramirez |
      | bob   | b.gomez   |

  Scenario: A message sent from Android arrives in Safari on iOS
    When alice opens the conversation with "bob"
    And alice sends the message "hola desde los Andes"
    Then bob sees the message "hola desde los Andes" within 10 seconds
```

*(The Spanish message is user-authored test data — outside C12's English-only scope, see §2.)*

Why total order as default: it is literally what the text reads as (to non-programmers above all — the reason Gherkin stays, C6); deadlock is impossible by construction in the default vocabulary; failures are a timeline with one global step index and all-actor snapshots, not an interleaving puzzle; and cross-actor causality — the property Kraken actually tests — is expressed by adjacency instead of signal plumbing. The cost (a slow actor blocks the cursor) is acceptable because E2E choreography is latency-dominated by the polling assertions you need anyway. Consequence discipline: `Then`-steps are **polling assertions by default** in the SDK, or app latency would masquerade as ordering flakiness.

**The dry-run analyzer** (referenced throughout): a static pass that compiles features, resolves actor→driver bindings, and verifies signal reachability and capability requirements — **without booting any session**. It runs implicitly at the start of every `kraken run` (this is what makes "fails fast, pre-run" true) and standalone via `kraken run --dry-run`.

Escape hatches (typed, checked):

- **Detached tasks**: `When alice starts uploading "demo.mp4" in the background as "upload"` … `Then alice's background task "upload" completes within 120 seconds`. Registered under a named handle; an unjoined handle at scenario end fails the scenario (leak detection). Covers ~90% of real overlap needs.
- **Signals, demoted but present**: full `publish/waitFor` SDK for step authors (`ctx.signals`), plus **one built-in feature-file wait step** (v2 conceptual continuity). Step definitions declare the signal names they publish (a `publishes:` field on registration) so the dry-run analyzer can compute producer reachability: a main-cursor wait with no reachable producer is a **guaranteed** deadlock under total order and is rejected statically — v2's worst runtime failure becomes a pre-run error.
- **Concurrent per-actor lanes: deferred**, pending the review of the v2 scenario corpus (repos in §1; review scheduled in Phase 1, §7; exit artifact: a findings appendix to ADR-0004 stating how many real v2 scenarios required sustained simultaneity vs. causal ping-pong). Hypothesis to test: v2's concurrency was an artifact of its N-process architecture, not a property users needed. The DAG scheduler makes lanes additive later — not a rewrite.

Actor↔platform binding: `kraken.config.ts` declares a **closed actor set** (`actors: { alice: { driver: 'android', … } }`); a step naming an undeclared actor is a dry-run error with did-you-mean. Features stay platform-neutral; optional `@requires:` scenario tags enable skip-with-reason; CLI overrides (`--actor alice=web:firefox`) and optional matrix permutations (run the same neutral scenario across android↔web swaps) serve the lab's research use cases. Binding an iOS actor on a non-macOS host fails **at startup, when core's registry resolves the actor→driver binding** (§5.5) — before any feature parses a device into existence.

Step definitions: context-first typed functions (no `this`), cucumber-expressions matching, capability contracts (`actor.as(Messaging)`) instead of platform types, platform access as an explicit checked downcast (`requires: AndroidCapable` mismatches are dry-run errors). **Built-in choreography/system steps ship in `@kraken/gherkin`** (not core); drivers may ship optional platform step libraries via a `/steps` subpath (§5.3 exception); app-domain steps belong to the user's project. Pre-freeze spike, scheduled in Phase 1 before ADR-0004 freezes the vocabulary: verify the Cucumber VS Code extension autocompletes Kraken-registered steps and the custom `{actor}` parameter type.

### 5.10 Driver plugin architecture & version skew

**Drivers are exact-pinned project `devDependencies`** — the project's package.json + lockfile is the single source of truth, so `git clone && pnpm install && kraken run` reproduces a 2026 suite bit-for-bit in 2029. This matches every healthy peer (WDIO services, ESLint flat config, Playwright) and Appium's own documented project-mode. The Appium-style global home dir was rejected: it imports "two shells disagree about which driver loaded" without its motivating use case (Kraken projects are npm packages by definition). **Appium pinning follows the same rule**: `appium`, `appium-uiautomator2-driver`, `appium-xcuitest-driver` are exact-pinned dependencies of the driver packages, loaded via Appium's documented project-mode / programmatic API — lockfile-governed. `APPIUM_HOME` is set only to isolate Appium's extension-manifest state, never as a version source (details in ADR-0007/0008).

- **Declaration**: a driver's default export is produced by `defineDriver()` from `@kraken/contracts`, branded with `Symbol.for('kraken.driver/v1')` (survives duplicate contract copies in the tree) and baking in the `CONTRACT_VERSION` it was compiled against. `package.json` carries `"keywords": ["kraken-driver"]` + a `"kraken"` field for tooling/discovery only — never as the load mechanism.
- **Registration**: explicit in `kraken.config.ts` (the composition root, loaded via jiti) — primary form is typed imported factories (`drivers: [android({ avd: 'Pixel_8' }), web()]`), ESLint-flat-config style: drivers arrive as *values* (dependency injection — the hexagonal answer), pnpm-strict-safe, refactor-safe, autocompleted. Safe on every host because driver main entries are import-safe by rule (§5.5). A string form `'@kraken/driver-ios'` (resolved from the project root, manifest-gated before entry import) exists so `kraken plugins install` can append mechanically.
- **Version skew** (what protects a 2028 student running a 2026 driver): drivers `peerDependencies`-depend on **`@kraken/contracts`, never `@kraken/core`** — core ships majors freely without invalidating drivers. At load time the registry compares **the driver's baked-in `CONTRACT_VERSION` against the `CONTRACT_VERSION` core itself was built against** (not whatever copy pnpm happened to resolve — duplicate contract copies are detected and reported): same major required; driver minor ≤ core's contract minor; violations produce a `KrakenError` naming both versions and the exact fix command. A local API-surface snapshot test fails the build when the contract's public surface changes without a version bump — the guard works without CI.
- **`kraken plugins:install @kraken/driver-ios` is a real, functional command (C8, mechanism per [D15])**: locate project root → detect package manager from lockfile → run `pnpm add -D -E …` → validate branded export + contract range → register in config (append or print the exact lines) → `Next: kraken doctor ios`. With oclif's `topicSeparator: " "`, both `kraken plugins install` and `kraken plugins:install` work (colons remain aliases forever). oclif's command-priority rules keep the door open to add `@oclif/plugin-plugins` later under a different topic if genuine CLI-extension plugins are ever wanted.
- **Install-time host gating is advisory only**: installing driver-ios on Linux warns ("installed and lockfile-pinned for your macOS teammates; DISABLED on this host") but exits 0. Critically, driver-ios must **not** set npm's `"os": ["darwin"]` field — that would make `pnpm install` fail (`EBADPLATFORM`) for every non-mac teammate sharing the lockfile. Load/run gating is where the hard block lives (§5.5).

### 5.11 CLI — oclif 4 + Ink 7

Production-proven pairing (Shopify CLI ships exactly `@oclif/core` 4.x + Ink + React 19; oclif's own `@oclif/table` renders Salesforce/Heroku CLI output through Ink). Decisions:

- `topicSeparator: " "` from day one; colon forms remain free aliases.
- **All Ink usage lives in `@kraken/tui`** — zero Ink types anywhere else. Ink majors move fast (6→7 in 11 months, hard React floors); this quarantines the churn.
- **stdout discipline is architectural**: while the live UI is mounted, nothing else may write to the stream. Drivers receive a `Logger` (never a stream); Appium/emulator child-process stdio is always piped and forwarded as `driverLog` events; `patchConsole: true`; a Biome rule bans `console.*` in driver packages.
- Two renderers selected at startup (`stdout.isTTY && !CI && !--plain`): the Ink live view (one lane per actor — platform, current step, signal state; `"bob ⏳ waiting for signal 'message-sent'"` is the product's signature moment, rendered from the `signalWaitStarted` event; completed steps flow into `<Static>`), and a plain **LineReporter** (`[bob/ios] ✓ sees the message…`) for CI/non-TTY. We deliberately do *not* rely on Ink's built-in CI mode — it renders only the final frame on exit, which would make a 10-minute multi-device run silent.
- **SIGINT is the highest-stakes path** for a tool that orchestrates emulators: `exitOnCtrlC: false`; Ctrl-C translates to a cancellation that runs full driver teardown (kill Appium sessions, shut down what we booted) before an oclif `ExitError`; commands await `waitUntilExit()`. Integration-tested early — orphaned emulators are how tools earn a bad reputation.
- Spike before Phase 2: ink-testing-library (stale since May 2024, tested against Ink 5) under Ink 7 + React 19.2 + Vitest; fallback is pinning Ink 6.8 or vendoring a ~100-line render harness.

### 5.12 Events & reporting — the GUI-ready spine (C9)

This section is the **single source of truth for event names**.

- **One `KrakenEvent` discriminated union**, every payload flat and JSON-serializable (artifacts as path refs, never buffers). Envelope: `{type, ts, runId, seq}` — `seq` monotonic per run gives any consumer total ordering without clock trust. Correlation ids: `scenarioId`, `stepId`, `actorId`, `signal`. Event families: `runStarted` / `runFinished`; `scenarioStarted` / `scenarioFinished`; `stepStarted` / `stepFinished` (with actor attribution); `actorSessionStarted` / `actorSessionFinished`; `signalSent` / **`signalWaitStarted`** / `signalReceived` / `signalTimedOut` (the wait-started event is what lets a contracts-only TUI render "waiting on signal" live); `driverRegistered` / `driverDisabled`; `artifactCaptured`; `driverLog`. *(Editorial correction 2026-07-03: `driverProbeCompleted` was removed when ADR-0002 D2 unified `probe()` into doctor checks.)*
- **Evolution rules copy `@cucumber/messages`** (the most battle-tested test-event stream in existence): no per-event version numbers; a single `protocol: 1` literal in `runStarted`; additive-only changes (new optional fields at most; a semantic change is a *new* event type); consumers must ignore unknown types/fields. A snapshot test asserts JSON-Schema backward compatibility on every change. Schemas authored in zod 4 internally; the public surface exports only inferred TS types + generated JSON Schema.
- **`Reporter` is a single-method subscriber** — `onEvent(e: KrakenEvent)` — not a Playwright-style method-per-event class, because one serialized-event method is transport-symmetric: identical whether the subscriber is Allure in-process, a JSONL file sink, or the future GUI over WebSocket (`kraken serve`, Phase 5, is a projection of this stream — no core changes).
- **Reporters as projections of the stream**: (1) raw **JSONL** event log persisted per run — the substrate everything else reads; (2) first-party **Allure 3** reporter via the officially documented `allure-js-commons` custom-integration path (actors modeled as parameters/steps so choreography reads clearly; Allure's generated HTML replaces the first-party HTML reporter — [D12]); (3) **CTRF** emitter (pinned `specVersion`; free GitHub PR summaries when CI arrives); (4) terminal renderers (§5.11). Optional Cucumber-messages compatibility stream considered in Phase 4 (unlocks existing formatters). OTel test semconv is mirrored in vocabulary only (attributes are still "Development" stability — no dependency).
- Timing: the event schema + evolution rules are implemented in **Phase 1** (they are the spine everything subscribes to) and recorded as ADR-0006 part A then; reporter projections beyond JSONL/LineReporter land in Phase 4 (ADR-0006 part B).

### 5.13 `kraken doctor`

**Composition (who owns what):** `@kraken/doctor` is a *pure check-execution engine* (deps: contracts, config — §5.3). It never reads `process.platform`, never resolves drivers, never knows Appium. The **CLI composes it**: it injects `HostInfo` (from core's `HostProbe`), the per-driver gate statuses (from core's registry), and the driver-contributed `DoctorCheck[]` collected through the contract. **Wrapping Appium's own doctor (`appium driver doctor uiautomator2|xcuitest --json`) is implemented inside the drivers' contributed checks** — drivers own the `appium` dependency and know its path; the engine just merges opaque check results. (The deprecated standalone `appium-doctor` package is not used.)

Each check yields `status / detail / fix`, rendered by the CLI and exportable as JSON — `kraken doctor --json` doubles as the reproducible machine-setup snapshot `context.md` asked for (single-machine bus-factor risk).

Checks beyond what Appium's doctor already covers:

| Area | Check | Why / failure it prevents |
|---|---|---|
| Common | Node ≥22.12 + LTS status of the running line | pnpm 11 and WDIO v10 both require Node ≥22 |
| Common | Ports free: 4723 (Appium), 8100+ (WDA), 8200+ (uia2 systemPort), 9100+ (mjpeg), 5037 (adb) | Parallel sessions silently colliding |
| Common | Host OS/arch gate status per driver (injected from core) | "iOS unavailable on this host" shown early, not as an Appium stacktrace |
| Common | Free RAM preflight | Memory pressure produces flaky timeouts that look like signaling bugs |
| Android | `ANDROID_HOME` set & exists (canonical; warn on `ANDROID_SDK_ROOT`-only — deprecated by Google) | Toolchain not found |
| Android | JDK **17+** (`JAVA_HOME`) | sdkmanager is compiled for class-file 61; JDK 8/11 fails cryptically |
| Android | ≥1 **arm64-v8a** system image at API ≥26; AVD inventory; `adb devices` | x86 images cannot boot on Apple Silicon — hard error with explanation; uia2 min API is 26 |
| iOS (macOS only) | `xcode-select -p`; Xcode major inside xcuitest's latest-two-majors window | "Your Xcode 15 is no longer supported by driver 11.x" instead of a WDA build failure |
| iOS (macOS only) | Simulator **runtimes** installed (`xcrun simctl runtime list`) | Runtimes are separate downloads since Xcode 14 — a fresh Xcode passes binary checks yet has zero simulators |
| iOS (macOS only) | Real-device checklist: Developer Mode, signing identity, trust | The steps no tool can automate, surfaced as a checklist |
| Web | Browser binaries present; safaridriver enablement state | First-run friction |
| Web | safaridriver concurrent-session limit surfaced | ⚠ *One-session-per-host limit is reported from Selenium/Apple documentation, not yet re-verified live — re-verify during the Phase 3 driver-web spike* |

### 5.14 Data generation & fuzzing (ratified, scope-bounded)

`@kraken/data-gen`: `@faker-js/faker` + zod-validated typed fixtures shared across actors (replacing v2's stringly `$faker_id`); seeded generation so multi-actor scenarios are reproducible. `@kraken/fuzz`: reimagined as a cross-platform random-event engine driving the same core session contract (so it works on Android/iOS/Web uniformly and can be signal-aware). Both are Phase 4 — deliberately thin until the engine is real.

### 5.15 Distribution **[D14]**

npm-first (public packages under `@kraken/*`), Phase 4, gated on explicit human confirmation. Homebrew/Docker (Android+Web image; iOS not dockerizable — Apple restriction) deferred past 3.0. **Node SEA binaries: exploratory only** — SEA is still officially "Active Development" stability, macOS x64 is unsupported, and single-file bundling structurally conflicts with oclif's dynamic plugin loading; do not architect around it.

### 5.16 Quality infrastructure of Kraken itself (C11)

- Vitest 4 everywhere; coverage thresholds enforced per package (core/signaling/gherkin ≥90% lines, drivers best-effort with contract-level fakes); the FakeDriver and the two conformance suites (driver CTK §5.4, transport suite §5.7) are the institutional memory that survives rotation.
- Biome 2 for lint+format; the `lint` turbo task is deliberately swappable per package — Biome's type-aware analysis catches ~75% of floating promises vs typescript-eslint, and un-awaited promises are *the* bug class in an async orchestrator, so `core` and `signaling` may add targeted typed-eslint rules if gaps bite in practice.
- Changesets from Phase 0 (changelog discipline even before publishing).
- ADR discipline: every phase closes with its ADRs current; planned series in §9.3. A `CONTRIBUTING.md` documents the quarterly dependency-bump ritual (§8.3) and the parity-gate process (§5.4).
- No CI now (C11), but every guard above (API-surface snapshot, conformance suites, coverage, the Linux import smoke test from §5.5) runs locally via `pnpm check` (the Turborepo aggregate task) so adding CI later is wiring, not rework. *(Editorial correction 2026-07-03: was "turbo run check"; the entry point is the root `check` script.)*

### 5.17 Explicitly out of scope for 3.0 initial

GUI (events keep the door open — C9); CI pipelines (D8); device farm / distributed execution (contracts ready: transport conformance + orchestrator-side signal resolution mean farms need no vendor cooperation); desktop/TV drivers (the contract's `platforms` field leaves room); cross-scenario signals; dynamic actor join/leave mid-scenario; v1/v2 syntax compatibility.

---

## 6. Prior art — the differentiator, re-verified for 2026

Kraken 3.0's claim, worded precisely: **the only open-source framework providing concurrent, signal-synchronized, multi-actor choreography across mixed Android + iOS + Web sessions inside one BDD scenario.** Every near-competitor fails at least one clause (all verified 2026-07-02):

| Tool | Status on multi-user/multi-device |
|---|---|
| Maestro (mobile-E2E mindshare leader) | Explicitly declined: "not something staff have planned" (maintainer, discussion #2998, Jan 2026) |
| Playwright | Excellent multi-user **web-only**; `_android` experimental; no iOS-native story (#33895 uncommitted) |
| Detox | No first-class support (#393/#1805/#3774); community pattern = N processes + hand-rolled coordination server |
| Marathon / appium-device-farm | Parallelization & device *allocation*, not intra-test choreography (device-farm's Appium 3 compat also unverified) |
| WDIO Multiremote (raw) | Session mechanics without business-level sync semantics — precisely the gap `@kraken/signaling` fills; validates the layering |
| Commercial (BrowserStack, Sauce, AWS, Firebase) | Parallel independent sessions, manual same-action mirroring, AI test-portability agents — nobody sells choreographed inter-device scenarios |
| AI/agentic wave (mabl "cross-channel", etc.) | Sequential cross-channel journeys, single-device agents — no concurrent signal-synchronized choreography |

Terminological continuity with the papers is kept deliberately: *inter-communication scenarios*, *multi-device interaction-based testing*, *signaling protocol*, actor lineage of `@user1/@user2`. Note for maintainers: this "nobody else does it" claim was verified by absence and **must be re-verified at each major release** — negative claims rot silently: the 2021 version of this claim went five years without re-verification.

---

## 7. Revised roadmap **[D5]**

Restructured so that C3 (mobile parity per milestone) is enforced by milestone *definition*, and so the whole engine is testable before any real device exists. Phase lengths are indicative, not commitments.

- **Phase 0 — Foundations** *(≈ weeks 1–2)*: monorepo scaffold (pnpm 11 + catalogs, turbo, Biome, Vitest, Changesets), `@kraken/contracts` skeleton, ADR process, CONTRIBUTING with the bump/parity rituals.
  **Exit:** `turbo run build test lint typecheck` green; repo buildable on a clean clone.
- **Phase 1 — Engine on fakes** *(≈ weeks 3–7)*: contracts finalized (ADR-0002); host detection + the mandated non-darwin unit test; event bus + schema + JSONL reporter (ADR-0006 part A); `@kraken/signaling` + transport conformance suite + ChaosTransport (ADR-0003); Gherkin compiler + typed step registry + DAG scheduler with screenplay semantics + dry-run analyzer (ADR-0004); programmatic scenario API; LineReporter; FakeDriver; minimal doctor (Node/pnpm/host checks); **v2-corpus review** (findings appendix feeding ADR-0004's lanes decision); VS Code autocomplete spike.
  **Exit:** a multi-actor choreography scenario runs end-to-end with zero real devices, fully unit-tested; the corpus-review findings are written.
- **Phase 2 — Milestone M1: mobile end-to-end at parity** *(≈ weeks 8–14)*: `driver-android` (Appium 3 embedded, uiautomator2 ^8) first as internal validation, `driver-ios` (xcuitest ^11, WDA prebuilt for simulators via `appium driver run xcuitest download-wda`) in the same milestone; CTK + fixture apps for both; doctor android/ios checks; Ink live UI (+ ink-testing-library spike resolved); `kraken plugins install`.
  **Exit (gate, per §5.4):** zero `failing` CTK entries on both platforms **and** an empty diff between Android and iOS supported-op sets (symmetric `unsupported(reason)` allowed and enumerated; asymmetric requires recorded human sign-off) — **M1 does not close on Android alone**; the §5.5 host-gating test parameterized over the *real* driver manifests passes; an Android↔iOS messaging choreography runs on the M1 Pro.
- **Phase 3 — Web + mixed choreography** *(≈ weeks 15–18)*: `driver-web` (BiDi progressive enhancement; Safari classic; safaridriver session-limit re-verified and surfaced in doctor), the flagship `examples/multi-user-android-ios-web` scenario, matrix runs.
  **Exit:** flagship 3-platform example green on the dev machine; driver-web CTK report published; at least one matrix permutation demo runs green.
- **Phase 4 — Institutional robustness** *(≈ weeks 19–24)*: Allure 3 + CTRF reporters (ADR-0006 part B), `@kraken/data-gen`, `@kraken/fuzz`, distributed signal transport (node-redis Streams) validated against the conformance suite, docs site, npm publication via Changesets (human-gated).
  **Exit:** transport conformance suite green against the Redis transport including Chaos cases; Allure/CTRF reports generated for the flagship example; docs site builds; first npm publish completed (with explicit human approval).
- **Phase 5 — GUI-ready serve** *(later)*: `kraken serve` — WebSocket projection of the event stream + artifact serving. No core changes by construction (§5.12).

---

## 8. Consequences

### 8.1 Positive

- The differentiator is engineered, not asserted: concurrency lives in Kraken's scheduler + signaling with deterministic defaults, and the 2026 landscape scan confirms nobody else occupies the niche.
- Rotation survival is mechanized: contracts package + version-skew checks, two conformance suites, FakeDriver, parity gate, API-surface snapshot, error-code registry, additive-only event rules, ADR series — each converts "discipline" into tooling.
- Parity (C3) is a generated artifact with a defined pass criterion (§5.4), not a promise.
- The engine is fully testable on fakes (Phase 1 exit), so device flakiness never blocks core development.
- Every heavy dependency with churn risk is quarantined to one package (WDIO/Appium → drivers; Ink → tui; zod → internal; allure → one reporter).

### 8.2 Negative / accepted costs

- Kraken owns runner-layer code (step registry, DAG scheduler, dry-run analyzer, messages emission) — the playwright-bdd-verified pattern is modest but real, and it is exactly what students inherit. Mitigated by scope discipline (§5.8) and the reference precedents.
- Two-level session API (core surface + native escape hatch) needs teaching; escape-hatch abuse would rot cross-platform step libraries. Mitigated by lint rules + the parity gate.
- Screenplay default trades away sustained simultaneity in v1 (deferred lanes). If the corpus review falsifies the hypothesis, lanes get pulled forward (additive on the DAG — by design).
- CTK fixture apps (Android/iOS/web with matching testIds) are an ongoing maintenance liability for a thesis lab.
- Owning the `plugins` topic means owning install edge cases (package-manager detection, workspaces). Mitigated by delegating to the detected package manager — never vendoring npm.

### 8.3 Risks under watch (with mitigations)

- **Dependency churn windows are open across the stack** (WDIO v10 ~July 2026, TS 7 GA, Vitest 5, Changesets 3, Xcode 27 ~Sept 2026 starting the clock on the driver support window). Mitigation: exact pins + a **documented quarterly bump ritual** in CONTRIBUTING (the inverse failure mode — drifting so far behind that upgrades become rewrites — is how v1/v2 died).
- **Single dev machine** (no CI, no backups): `kraken doctor --json` is the reproducible setup snapshot; hold the machine on macOS Tahoe 26.x until Appium trackers clear macOS 27.
- **iOS 26 has open automation regressions** (navigation-bar accessibility IDs broken — appium#21449; camera-roll alert flakiness): element strategies in the step vocabulary must not rely on navbar a11y ids; re-check at Phase 2 start.
- **Maestro/agentic convergence**: multi-device demand is tracked internally at mobile.dev (referenced in discussion #2998); mabl markets sequential "cross-channel". Kraken's moat is OSS + deterministic signal semantics + BDD; re-run the landscape scan at each release.
- **Bus-factor concentrations we accept knowingly**: Ink (one primary maintainer; quarantined), cucumber-js (not load-bearing — parser stack only), Biome typed-lint gaps (swappable lint task).
- **ink-testing-library staleness** — spike scheduled before Phase 2; fallbacks identified.

---

## 9. Open questions

### 9.1 Requiring human ratification before Phase 0 proceeds

1. **[D3]** Custom BDD runner on the official Gherkin parser stack instead of the `@cucumber/cucumber` runtime (§5.8 — including the D3↔D6 coupling note).
2. **[D4]** N independent WDIO `remote()` sessions instead of `multiremote()`, and the Kraken-owned signal store that C5's premise turns out to require (§5.6, §5.7).
3. **[D6]** DSL default semantics: single choreography file + screenplay total order + escape hatches, with concurrent lanes deferred behind the Phase-1 corpus review (§5.9).

Factual refreshes D1/D2/D7/D10/D11 take effect unless vetoed at the same review (D1 explicitly offers the veto on the Node-24 dev line).

**Recording the outcome:** upon ratification, this ADR's Status flips to *Accepted* with the date, and each of D3/D4/D6 gets its outcome (ratified / amended-how) recorded in a short ratification log appended to this file. A future reader finding Status still "Proposed" atop a built repo should treat that as a process failure and escalate.

**Ratification log (2026-07-02):**
- **[D3]** Custom BDD runner on the official Gherkin parser stack — **ratified as proposed**.
- **[D4]** N independent WDIO `remote()` sessions + Kraken-owned signal store — **ratified as proposed**.
- **[D6]** Screenplay total order as DSL default, lanes deferred behind the Phase-1 v2-corpus review — **ratified as proposed**.
- D1/D2/D7/D10/D11 — no veto raised; in effect (development proceeds on Node 24 LTS with the ≥22.12 floor).

### 9.2 Deferred to phase ADRs (recommendations noted, decided with implementation evidence)

- Core surface exact boundary: gestures / app-lifecycle / permission dialogs as optional capabilities (ADR-0002; recommendation: optional capability interfaces, not the common surface).
- Failure policy default when one actor fails mid-scenario: `failFast` (recommended) vs `drainOthers`; artifacts captured from **all** actors either way (ADR-0002).
- Concurrent same-subscriber waits and non-consuming `peek` semantics; predicate-filtered `waitFor` consumption; signal-payload redaction in reports (ADR-0003).
- Signal-wait timeouts: explicit duration in step text (recommended) vs project-level default with overrides (ADR-0003/0004).
- Language policy for the step library: English-only (recommended; `# language: es` gives Spanish Gherkin keywords for free) vs dual EN/ES step expressions (ADR-0004). ⚠ *Choosing dual EN/ES step expressions shipped in Kraken's own packages would touch C12 and therefore requires explicit human confirmation, not just an ADR-0004 decision.*
- Secrets/credentials handling for actor sign-in data (ADR-0004; working recommendation: `.env`-based loading, optional keychain integration later) — see [D13].
- `driver-web` platform granularity: one `web` platform with per-actor browser choice vs distinct `chrome`/`safari` ids (ADR-0005, co-decided with the vocabulary).
- No-project quickstart mode (global resolution root): deferred; registry API accepts multiple roots so it can be added without contract change.

### 9.3 Planned ADR series

`0002` core contracts & session surface · `0003` signaling semantics & transports · `0004` DSL vocabulary & step API (+ corpus-review appendix) · `0005` driver plugin/CLI architecture · `0006` reporting & event schema (part A in Phase 1, part B in Phase 4) · `0007` android driver internals · `0008` ios driver internals · `0009` web driver internals. Each written in the phase that implements it.

---

## 10. Key references

- Appium 3: appium.io blog (3.0 announcement 2025-08-07); migration guide; `appium driver doctor` CLI docs; npm registry (`appium`, `appium-uiautomator2-driver`, `appium-xcuitest-driver` — versions/engines verified 2026-07-02). XCUITest system requirements (latest-two-Xcode-majors policy); iOS 26 tracking issues appium#21347, #21449.
- WebdriverIO: `packages/webdriverio/src/multiremote.ts` + `index.ts` (source-verified broadcast/barrier semantics); multiremote docs ("not meant to execute all your tests in parallel"); PR #15141 (Appium 3 compat, v9.27.0); PR #15218 (window-close teardown bug); v10 milestone (Node ≥22).
- Cucumber ecosystem: "Cucumber is back in Community Ownership" (Dec 2024); "Cucumber in 2025, year in review" (funding/maintainer data); cucumber-js docs (`world.md`, `parallel.md`, `javascript_api.md`); npm download/version data for `@cucumber/gherkin` 41 vs `@cucumber/cucumber` 13; `@wdio/cucumber-framework` pinned at cucumber ^10 (embedding-treadmill evidence); playwright-bdd CHANGELOG v7 ("remove dependency on Cucumber runner").
- oclif/Ink: oclif topic-separator & plugins docs; `determine-priority.ts` source; Shopify cli-kit dependency graph (`@oclif/core` 4.x + ink + react 19.2); ink 7 readme (Node ≥22, CI behavior); ink-testing-library npm timestamps.
- Reporting: allure npm (3.0.0 GA 2025-12-22; 3.14.0); `allure-js-commons` README "Creating your own integration" + discussion #2610; CTRF spec repo + roadmap (v1.0.0 Q3 2026); `@cucumber/messages` (evolution model); Vitest reporter API (design reference only).
- Node/TS/toolchain: endoflife.date/nodejs; Node release WG (annual-major change from 27); TypeScript 6.0 / 7.0-RC announcements; pnpm 11 release blog; Biome v2 "Biotype" + 2026 roadmap; Node SEA stability docs; `require(esm)` stability notes (top-level-await caveat).
- Apple Silicon matrix: Apple developer releases (Xcode 26.6); Google `sys-img2-3.xml` repository XMLs (arm64-v8a image coverage read directly); Android env-vars doc (`ANDROID_SDK_ROOT` deprecated); XCUITest device-setup docs (simulator vs real-device signing).
- Prior art: Maestro discussion #2998; microsoft/playwright#33895; wix/Detox#393; BrowserStack Interaction Sync docs; `github.com/TheSoftwareDesignLab/KrakenMobile` (v1) and `github.com/TheSoftwareDesignLab/Kraken` (v2 — DSL/corpus source); dblp/ScienceDirect/IEEE records for the three canonical Kraken papers (DOIs 10.1016/j.scico.2021.102627, 10.1016/j.scico.2022.102897; IEEE 8918941, 9825889).
