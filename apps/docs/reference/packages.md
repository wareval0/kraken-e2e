# Packages

Kraken ships as **14 packages** under the `@kraken-e2e/*` scope. All are ESM, require Node >= 22.13, and are published individually so a project installs only what it uses. The driver/reporter SPI they share is versioned as the **contract** (currently 2.1); `defineDriver()` bakes the contract version into every driver, and the registry checks it at load time.

| Package | Role |
|---|---|
| `@kraken-e2e/contracts` | The SPI: driver/reporter interfaces, session contract, event types, error codes. |
| `@kraken-e2e/signaling` | The multi-actor signal log, its transports, and the transport conformance suite. |
| `@kraken-e2e/core` | The orchestrator: runner, scheduler, driver registry, event bus, host probe, CTK. |
| `@kraken-e2e/config` | `defineConfig`, `kraken.config.ts` loading and validation. |
| `@kraken-e2e/gherkin` | The BDD front end: feature parsing, step registry, scenario compiler. |
| `@kraken-e2e/doctor` | The pure check-execution engine behind `kraken doctor`. |
| `@kraken-e2e/driver-android` | Android driver: Appium 3 + UiAutomator2. |
| `@kraken-e2e/driver-ios` | iOS driver: Appium 3 + XCUITest (macOS only). |
| `@kraken-e2e/driver-web` | Web driver: WebdriverIO native, no Appium. |
| `@kraken-e2e/reporters` | Reporter projections of the event stream: JSONL, line, Allure 3, CTRF. |
| `@kraken-e2e/tui` | The Ink live terminal UI. |
| `@kraken-e2e/cli` | The `kraken` command — the composition layer. |
| `@kraken-e2e/data-gen` | Typed, seeded test-data fixtures. |
| `@kraken-e2e/fuzz` | Random-event (monkey testing) engine over the session contract. |

## Foundation

**`@kraken-e2e/contracts`** is the service-provider interface everything else agrees on: the `KrakenDriver` and `Reporter` interfaces, `defineDriver()` / `defineReporter()`, the `UserSession` contract with its 11 core operations and portable locator types, the typed event vocabulary, `KrakenError` with its stable error codes, host-requirement checking, and `CONTRACT_VERSION`. Its only runtime dependency is `@kraken-e2e/signaling`, whose types appear on the contract surface. Anyone writing a custom driver or reporter builds against this package alone.

**`@kraken-e2e/signaling`** is the standalone signal primitive: a scoped, append-only signal log with per-subscriber cursors (replay-first delivery, per-subscriber FIFO), the in-memory transport, the Redis Streams transport, and a conformance suite that any transport must pass. It has **zero runtime dependencies**; `redis` (for the Redis transport) and `vitest` (for running the conformance suite against a custom transport) are optional peer dependencies. It is usable outside Kraken.

## Engine and authoring

**`@kraken-e2e/core`** is the orchestrator: the run coordinator (drivers started once per run, scenarios executed, artifacts captured on failure), the step scheduler, the `DriverRegistry` that loads/validates/host-gates drivers, the event bus that totally orders every `KrakenEvent`, the single host probe that reads `process.platform`, and — under the `@kraken-e2e/core/ctk` subpath — the driver Conformance Test Kit that proves a driver implements the session contract (its `vitest` peer dependency exists for this subpath). Core knows drivers only through the contracts SPI.

**`@kraken-e2e/config`** provides `defineConfig()`, discovery and loading of `kraken.config.ts` (through `jiti`, so TypeScript configs need no build step), and schema validation of the actor map and driver registrations. Validation errors carry the exact offending fields.

**`@kraken-e2e/gherkin`** is the BDD front end: `.feature` parsing on the official Cucumber Gherkin stack, `createStepRegistry()` with the `{actor}` and `{duration}` parameter types, the scenario compiler that performs dry-run analysis (unknown steps, undeclared actors, waits no step can satisfy) before anything boots, and the built-in choreography step vocabulary.

**`@kraken-e2e/doctor`** is the pure check-execution engine behind [`kraken doctor`](/guide/doctor). Every input — host context, built-in checks, driver gate statuses, driver-contributed checks — is injected by the CLI; the package never reads `process.platform`, never resolves drivers, and never knows Appium exists.

## Drivers

**`@kraken-e2e/driver-android`** drives Android through an embedded Appium 3 server and the UiAutomator2 driver, both exact-pinned in its dependencies (`appium@3.5.2`, `appium-uiautomator2-driver@8.0.1`). **`@kraken-e2e/driver-ios`** does the same for iOS with the XCUITest driver (`appium-xcuitest-driver@11.17.1`) and is host-gated to macOS through its manifest. **`@kraken-e2e/driver-web`** drives browsers through WebdriverIO natively, with no Appium at all. All three depend on `@kraken-e2e/contracts` **as a peer dependency** and ship a dependency-light `/manifest` subpath so hosts can gate them before importing the implementation. See [Drivers](/guide/drivers) for their options and behavior.

## Output

**`@kraken-e2e/reporters`** contains the reporter projections of the event stream: the JSONL event log (the run's source of truth), the plain line renderer, Allure 3 results, and the CTRF report. Reporters peer-depend on contracts and never influence execution — a crashing reporter is isolated and reported, not fatal.

**`@kraken-e2e/tui`** is the Ink live terminal UI shown during `kraken run` on an interactive terminal. It is deliberately the **only** package in the ecosystem that imports `ink` (and `react`); every other package stays renderer-free.

## Composition

**`@kraken-e2e/cli`** is the `kraken` binary (oclif): `run`, `doctor`, `devices`, `init`, `serve`, and the Kraken-owned `plugins` topic. It is the one place where everything is wired together — config loading → driver registry → feature compilation → the core runner → reporters and the TUI — which is why it is the only package that depends on nearly all the others.

## Test-design utilities

**`@kraken-e2e/data-gen`** provides typed, seeded test-data fixtures (`@faker-js/faker` under a seed, validated with zod) so every actor in a scenario — and every re-run — sees the same generated users, messages and payloads. It has no dependency on the rest of Kraken and is usable in any test suite.

**`@kraken-e2e/fuzz`** is the cross-platform random-event engine for monkey testing: it drives the core session contract with randomized operations, and being written against the contract alone (contracts as a peer dependency, zero runtime dependencies), the same fuzzing session works on Android, iOS and web.

## Dependency directions

The dependency graph is enforced in one direction only:

- **The engine never imports drivers.** `@kraken-e2e/core` depends on contracts and signaling — nothing else from the ecosystem. Drivers reach the engine only as values passed through the registry at run time.
- **Contracts has no runtime dependencies except signaling types.** Nothing heavier may ever creep into the SPI package; a custom driver author pulls in contracts and gets essentially nothing else.
- **Drivers depend only on contracts (as a peer) plus their automation stacks.** A driver never imports core, config, or another driver.
- **The CLI composes everything.** It is the only package allowed to depend on the whole set; composition logic lives there and nowhere else.
- Supporting rules with the same spirit: `doctor` depends only on contracts and config and never probes the host itself; `reporters` and `fuzz` peer-depend on contracts only; `tui` is the only importer of `ink`.

The full runtime/peer dependency matrix:

| Package | Runtime dependencies (`@kraken-e2e/*` and external) | Peer dependencies |
|---|---|---|
| `contracts` | `signaling` | — |
| `signaling` | — | `vitest` ^4 (conformance suite), `redis` ^6.1 (Redis transport) |
| `core` | `contracts`, `signaling`, `zod` | `vitest` ^4 (CTK subpath) |
| `config` | `contracts`, `jiti`, `zod` | — |
| `gherkin` | `contracts`, `core`, `@cucumber/gherkin`, `@cucumber/messages`, `@cucumber/cucumber-expressions`, `@cucumber/tag-expressions` | — |
| `doctor` | `contracts`, `config` | — |
| `reporters` | `allure-js-commons` | `contracts` |
| `tui` | `contracts`, `ink`, `react` | — |
| `cli` | `contracts`, `core`, `signaling`, `gherkin`, `config`, `doctor`, `reporters`, `tui`, `@oclif/core`, `jiti`, `tinyglobby`, `ws` | — |
| `driver-android` | `appium` 3.5.2, `appium-uiautomator2-driver` 8.0.1, `webdriverio` 9.29.1 | `contracts` |
| `driver-ios` | `appium` 3.5.2, `appium-xcuitest-driver` 11.17.1, `webdriverio` 9.29.1 | `contracts` |
| `driver-web` | `webdriverio` 9.29.1 | `contracts` |
| `data-gen` | `@faker-js/faker`, `zod` | — |
| `fuzz` | — | `contracts` |

## What a project installs

A typical test project installs five kinds of packages directly; everything else arrives transitively:

| Package | Why it is a direct dependency |
|---|---|
| `@kraken-e2e/cli` | Provides the `kraken` binary the project's scripts invoke. |
| `@kraken-e2e/config` | `kraken.config.ts` imports `defineConfig` from it. |
| `@kraken-e2e/gherkin` | `steps/index.ts` imports `createStepRegistry` from it. |
| `@kraken-e2e/driver-*` | One per platform the suite drives. `kraken plugins install @kraken-e2e/driver-android` installs it as an exact-pinned devDependency through the project's own package manager and registers it in the config. |
| `@kraken-e2e/contracts` | Peer dependency of every driver; also the import source for SPI types (locators, sessions, errors) in step code and custom drivers or reporters. |

`@kraken-e2e/data-gen` and `@kraken-e2e/fuzz` are added directly when a project uses [seeded test data](/best-practices/test-data) or [monkey testing](/best-practices/monkey-testing). `core`, `signaling`, `doctor`, `reporters` and `tui` normally never appear in a project's `package.json` — they come with the CLI.
