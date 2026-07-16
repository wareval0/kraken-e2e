# Kraken

**Multi-user, multi-device end-to-end testing.** Kraken choreographs two or more
users on different devices and platforms inside **one BDD scenario** — one user
sends a chat message from an Android app, another verifies it arrives on iOS, a
third checks a web dashboard — with deterministic, signal-synchronized
execution.

**[Documentation](https://wareval0.github.io/kraken-e2e/)** ·
published on npm as [`@kraken-e2e/*`](https://www.npmjs.com/org/kraken-e2e)

```gherkin
Scenario: a mobile player joins the browser host's live game and answers
  Given host has signed in to Kahoot
  When host launches it live in classic mode
  And host shares the game PIN with the players
  And player joins the shared game with their configured nickname
  And host starts the round once the player is in the lobby
  And player answers "Diamond" as soon as the question appears
  Then host advances to the results once the answer is in
```

One scenario, two devices: the host runs in a real browser, the player on the
native Android app, and the two stay in lockstep through signals. See it end to
end in [Live Kahoot, across two devices](https://wareval0.github.io/kraken-e2e/examples/kahoot).

## How it works

- **One contract, three platforms.** A single session interface and portable
  locator strategies drive Android, iOS and Web. Platform parity is verified by
  a conformance kit against real devices, not assumed.
- **Signal-synchronized choreography.** Actors coordinate through an append-only
  signal log with replay-first delivery and per-subscriber FIFO ordering. Signal
  misuse is caught statically, before any device boots.
- **Reproducible by construction.** Seeded data generation, seed-derived random
  testing and lockfile-pinned drivers make every run repeatable across machines.
- **Engineering-grade tooling.** Environment diagnosis, device discovery, a
  click-to-identify element inspector, a live terminal UI, Allure and CTRF
  reporting, and an HTTP/WebSocket projection of every run.

Kraken is the third generation of the Software Design Lab's cross-device testing
tooling, succeeding [Kraken v1](https://github.com/TheSoftwareDesignLab/KrakenMobile)
(Ruby/Calabash) and [Kraken v2](https://github.com/TheSoftwareDesignLab/Kraken)
(Node/Cucumber) with a ground-up TypeScript implementation. It is not backward
compatible with v1/v2 scenarios or APIs.

## Requirements

- **Node.js ≥ 22.13** (Node 24 LTS is the reference line — see `.nvmrc`).
- **pnpm 11** via corepack: `corepack enable pnpm`.
- **macOS is required only for the iOS driver** (an Xcode/XCUITest platform
  restriction). Android and Web run on macOS, Linux and Windows. Kraken detects
  the host at startup and disables unavailable drivers with an explicit message.

## Quick start

```sh
npm install -D @kraken-e2e/cli @kraken-e2e/driver-web   # plus the drivers you need
npx kraken run                                          # runs kraken.config.ts
```

The [Getting started guide](https://wareval0.github.io/kraken-e2e/getting-started/installation)
walks through a first project; the [examples](https://wareval0.github.io/kraken-e2e/examples/overview)
are complete, runnable suites from a one-second laptop run to a live cross-device
game.

To work on Kraken itself:

```sh
corepack enable pnpm
pnpm install
pnpm check        # build + typecheck + test + lint, orchestrated by Turborepo
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the working agreements.

## Repository layout

| Path | Package | Role |
|---|---|---|
| `packages/contracts` | `@kraken-e2e/contracts` | Zero-runtime-dep SPI every plugin compiles against (`CONTRACT_VERSION`) |
| `packages/core` | `@kraken-e2e/core` | Orchestrator, session manager, scheduler, plugin registry, host detection, event bus, conformance test kit |
| `packages/signaling` | `@kraken-e2e/signaling` | Standalone signal log (the multi-actor synchronization primitive) + transports |
| `packages/gherkin` | `@kraken-e2e/gherkin` | BDD front-end: feature parsing, typed step registry, scenario compiler |
| `packages/config` | `@kraken-e2e/config` | Typed `kraken.config.ts` loading and validation |
| `packages/cli` | `@kraken-e2e/cli` | The `kraken` CLI (oclif) — composition layer |
| `packages/tui` | `@kraken-e2e/tui` | Ink live terminal UI (the only package importing ink) |
| `packages/driver-android` | `@kraken-e2e/driver-android` | Appium 3 + uiautomator2 |
| `packages/driver-ios` | `@kraken-e2e/driver-ios` | Appium 3 + xcuitest (**macOS-only host**) |
| `packages/driver-web` | `@kraken-e2e/driver-web` | WebdriverIO native |
| `packages/doctor` | `@kraken-e2e/doctor` | Environment-diagnosis engine behind `kraken doctor` |
| `packages/reporters` | `@kraken-e2e/reporters` | JSONL / terminal / Allure 3 / CTRF reporters |
| `packages/data-gen` | `@kraken-e2e/data-gen` | Typed, seeded test-data fixtures |
| `packages/fuzz` | `@kraken-e2e/fuzz` | Cross-platform random-event engine |
| `adrs/` | — | Architecture Decision Records (start at [ADR-0001](adrs/0001-general-architecture.md)) |

## Academic record

- Ravelo-Méndez, Escobar-Velásquez, Linares-Vásquez. *Kraken-Mobile: Cross-Device Interaction-based Testing of Android Apps.* ICSME 2019 (IEEE 8918941).
- *Kraken: A framework for enabling multi-device interaction-based testing of Android apps.* Science of Computer Programming 206:102627, 2021. DOI 10.1016/j.scico.2021.102627.
- *Kraken 2.0: A platform-agnostic and cross-device interaction testing tool.* Science of Computer Programming 225:102897, 2023. DOI 10.1016/j.scico.2022.102897.

## Credits

Developed at the [Software Design Lab](https://thesoftwaredesignlab.github.io/),
School of Engineering, Universidad de los Andes.

**Author:** Wilmer Arévalo-González — Research Projects Professional, School of
Engineering, Universidad de los Andes · w.arevalo@uniandes.edu.co

## License

[GNU General Public License v3.0](LICENSE).
