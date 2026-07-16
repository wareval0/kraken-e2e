# The Kraken Showcase

Five realistic suites that demonstrate what makes Kraken different: **several real users, on several real platforms, coordinated inside one BDD scenario** — written with the patterns you'd use in production (Given/When/Then discipline, Page Objects, seeded data) and validated end to end on real devices.

Every suite below has been run green on a real Android emulator, a real iOS simulator and real Chrome. Timings are from those runs, warm devices.

## The five suites

| Suite | Platforms | Run | What it proves |
|---|---|---|---|
| **Release sign-off** | Android + iOS + Web + a real local backend | `kraken run --config kraken.trio.config.ts` | The full vision (~40s): mobile engineers sign off a build, the sign-offs travel as **payload-carrying signals**, arrive in **verified FIFO order**, the release manager records them on a server-rendered web dashboard, and the publication notice **fans out** to every subscriber at once |
| **Account parity** | Android + iOS | `kraken run --config kraken.duo.config.ts` | One **seeded fixture** = one account: created on Android, logs in on iOS — no data passed between actors, no hardcoded credentials (~52s) |
| **Web checkout** | Web only (public **saucedemo.com**) | `kraken run --config kraken.web.config.ts` | Kraken as a first-class single-user E2E tool: a complete purchase on a real public site, textbook Page Objects (~9s) |
| **Android account lifecycle** | Android only | `kraken run --config kraken.android.config.ts` | Sign-up → login E2E with generated, schema-validated data (~23s) |
| **Seeded monkey** | Android | `kraken run --config kraken.monkey.config.ts` | Monkey testing as a BDD scenario: a seed-reproducible random walk that tolerates real-UI flakiness (keyboards, native alerts), survives, and proves its own replayability (~14s) |

## Prerequisites

```sh
# fixture app (both mobile platforms) — from the monorepo root:
node scripts/fetch-fixture-apps.mjs
# devices: see what you already have
kraken devices
```

Android needs an AVD (default `Medium_Phone_API_36.0`, override `KRAKEN_ANDROID_AVD`); iOS needs a simulator (defaults `iPhone 16` / `18.6`, override `KRAKEN_IOS_SIM` / `KRAKEN_IOS_VERSION`); web needs Chrome. The trio's release board starts itself (port `4173`, override `KRAKEN_BOARD_PORT`).

## The patterns on display

**Given/When/Then as specification, not script.** Features read as business language — `When alice signs off the "android" build for "2.0.0"` — never as UI mechanics. Given = context, When = action, Then = observable outcome.

**Page Objects / Screen Objects** (`screens/`). Every locator and UI mechanic lives in an intention-revealing class; steps are one line of delegation. Two flavors on display:

- `screens/mobile/*` — **one class drives Android AND iOS**, because every locator is a portable accessibility id (`{ by: 'a11y' }`).
- `screens/web/saucedemo/*` vs `screens/web/release-board-page.ts` — a third-party site needs the raw-CSS `native` escape hatch; the app **we** own uses the portable `testId` strategy. That contrast is the argument for building apps with test ids.

**Seeded, typed data** (`fixtures/users.ts`). `defineFixture(zodSchema, generator)` + a fixed seed: every actor on every machine derives the *same* QA account — which is how the duo suite creates an account on one platform and logs into it from another without passing any data.

**Signals doing real work** (`features/trio/`). Not a toy ping: chained payload-carrying publications, per-subscriber FIFO consumption asserted in order, and a one-to-many fan-out — the primitives that make multi-device choreography deterministic instead of sleep-and-hope.

**Monkey testing with engineering discipline** (`features/monkey/`). The fuzz engine drives the same session contract as scripted steps, the walk is derived from a seed (same walk, every machine), action failures are tolerated and *recorded* (real UIs flake under a monkey — keyboards occlude, re-renders staleify handles, alerts pop), and recovery + reproducibility are asserted as part of the scenario.

## Field notes (found while building this)

The monkey surfaced three real mobile-testing hazards, now encoded in the suite:

1. Toggling a React Native switch re-renders the tree and staleifies in-flight element handles.
2. The soft keyboard occludes lower elements after any `typeText` — taps on them fail until it's gone.
3. `button-Active` pops a native alert that blocks navigation — a monkey harness needs a dismissal/recovery pass before asserting survival.
