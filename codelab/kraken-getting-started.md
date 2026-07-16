summary: Learn Kraken 3.0, a tool for multi-user, multi-device end-to-end testing. Install it, understand how it choreographs several users across Android, iOS and Web inside one BDD scenario, and run a complete cross-platform example on your own machine — no devices required.
id: kraken-getting-started
categories: Testing, Mobile, Web, Automation
tags: kraken, e2e, appium, webdriverio, bdd, cucumber, typescript
status: Published
authors: The Software Design Lab (Universidad de los Andes)
feedback link: https://github.com/wareval0/kraken-e2e/issues

# Kraken 3.0: multi-user, multi-device end-to-end testing

## Overview
Duration: 3:00

**Kraken** tests things that ordinary end-to-end tools cannot: flows that involve **more than one user, each on a different device or platform, at the same time**. A message sent from an Android app arriving in someone else's iOS app; a web dashboard reacting live to a mobile action; two players in a turn-based game — Kraken drives all of those actors **inside a single BDD scenario**, keeping them synchronized with a signal bus.

This codelab is a complete, hands-on introduction. You will install Kraken, understand its architecture, and run a real three-actor cross-platform scenario on your own machine using **fake devices** — so you can see the whole thing work end to end without an emulator, a simulator, or a browser. Then you will learn exactly what changes to make it drive **real** Android, iOS and Web.

### What you'll learn

* What Kraken is, the problem it solves, and how its pieces fit together
* The core concepts: **actors**, the **screenplay** execution model, **signals**, portable **locators**, and **drivers**
* How to install the CLI and scaffold a project
* How to write and run a multi-actor scenario, and how to read its output
* How **signals** keep actors on different devices in lockstep (and how Kraken prevents deadlocks)
* How to produce reports (JSONL, Allure, CTRF) and watch a run live with `kraken serve`
* How to graduate from fakes to real Android, iOS and Web drivers — changing **only the configuration**
* Advanced building blocks: seeded data generation, cross-platform fuzzing, and distributed signaling over Redis

### What you'll build

A `messaging` scenario in which **Alice** (Android) composes a message, **Bob** (iOS) receives it after a network hop and confirms it, and **Carol** (Web) sees it appear in a dashboard — all in one Gherkin scenario, synchronized by a signal, and verified automatically.

### Prerequisites

* **Node.js ≥ 22.13** — check with `node --version`
* Comfort with a terminal and basic JavaScript/TypeScript
* No devices needed for the core of this codelab (we use fake drivers). For the optional "go real" step you'll want an Android emulator, and — for iOS — a Mac with Xcode.

> aside positive
>
> Kraken is written in TypeScript and ships as ESM-only npm packages under the `@kraken-e2e/*` scope. You do **not** need to clone any repository to follow this codelab — everything installs from npm.

## What is Kraken, and how does it work?
Duration: 6:00

Before writing any code, it helps to hold the mental model. Kraken is built around five ideas.

### 1. Actors (a closed cast)

A Kraken scenario has a fixed, named set of **actors** — the people in your story. You declare them once in `kraken.config.ts`:

```typescript
actors: {
  alice: { platform: 'android' },
  bob:   { platform: 'ios' },
  carol: { platform: 'web' },
}
```

Each actor gets its **own independent device session**. The cast is *closed*: a step that names an actor who isn't declared is a **compile-time error**, not a runtime surprise. Every step you write receives the actor it acts as, so the same step text can run as Alice on Android or Bob on iOS.

### 2. The screenplay (steps run in text order)

Kraken uses Gherkin (`Given`/`When`/`Then`), but its default execution model is the **screenplay**: steps run **in the order they are written**, top to bottom. This is deliberate — a multi-device story is easiest to reason about when it reads like a script. When you genuinely need concurrency, you reach for the two escape hatches (background tasks and signals), which we'll meet shortly.

### 3. Signals (how actors synchronize across devices)

The heart of Kraken. Actors on different devices coordinate through an **append-only signal log**, scoped to the scenario. The two operations:

* `actor.signals.publish(name, payload?)` — append a named record (optionally carrying JSON data).
* `actor.signals.waitFor(name, { timeoutMs })` — block until a matching signal appears.

Two properties make this reliable:

* **Replay-first.** `waitFor` looks at history *before* it waits live, so a signal published **before** the wait began is never missed. This "defines away" the classic lost-wakeup race.
* **FIFO per subscriber.** Each waiting actor consumes records in order through its own cursor, so a signal published once is delivered to every subscriber that's interested, each exactly once, in order.

Kraken's compiler also performs **static deadlock detection**: if everyone ends up waiting and nobody publishes, it tells you *before* the run starts, and suggests the closest signal name if you made a typo.

### 4. Portable locators & a portable session

Every actor exposes the **same** session interface regardless of platform — 11 operations: `tap`, `typeText`, `readText`, `waitFor`, `isDisplayed`, `scrollIntoView`, `pressKey`, `navigate`, `screenshot`, `source`, `dispose`. You address elements with **portable locators**:

| Strategy | Meaning | Android | iOS | Web |
|---|---|---|---|---|
| `{ by: 'testId' }` | a stable test id | resource-id | accessibility id | `[data-testid]` |
| `{ by: 'a11y' }` | accessibility label | content-desc | accessibility id | `[aria-label]` |
| `{ by: 'text' }` | visible text | UiSelector text | predicate | text match |
| `{ by: 'native' }` | raw, non-portable | (escape hatch) | (escape hatch) | CSS/XPath |

The payoff: one step written against `{ by: 'a11y', value: 'text-input' }` runs **unchanged** on all three platforms.

> aside positive
>
> Keys are portable too. `pressKey` accepts the cross-platform `SemanticKey` set — `'enter' | 'escape' | 'tab'` — which Kraken maps to real system keys on every platform (on iOS via HID keyboard events, verified on real simulators). Android's hardware "back" is deliberately **not** in this set, because it isn't a key concept on iOS or the web — it lives behind the `native` escape hatch on Android.

### 5. Drivers behind a hexagonal core

Kraken's engine (`@kraken-e2e/core`) never imports Appium, WebdriverIO, ADB or a browser. Those live in **driver plugins** you install per project:

* `@kraken-e2e/driver-android` — Appium 3 + UiAutomator2 (runs on macOS, Linux, Windows)
* `@kraken-e2e/driver-ios` — Appium 3 + XCUITest (**macOS only** — an Apple restriction Kraken detects and enforces)
* `@kraken-e2e/driver-web` — WebdriverIO native, no Appium (macOS, Linux, Windows)

Because everything talks to the same **contract**, you can swap a fake driver for a real one — or Android for Web — by editing configuration alone. That's the property we'll exploit to run the whole example on your laptop with zero devices, then "go real" by changing only the config.

> aside negative
>
> Kraken is **not** a single-user Appium/WebdriverIO wrapper, and it is not a load-testing tool. Its reason to exist is *interaction between multiple users across devices in one scenario*. If you only ever drive one device at a time, a plain Appium/WDIO setup is simpler.

## Set up your environment
Duration: 5:00

First, confirm your Node.js version:

```bash
node --version
# must be v22.13.0 or newer
```

Create a fresh project folder and initialize it as an **ESM** package:

```bash
mkdir kraken-tutorial && cd kraken-tutorial
npm init -y
npm pkg set type=module
```

Install the Kraken CLI and the packages our first (fake-driver) example needs, as dev dependencies:

```bash
npm install --save-dev \
  @kraken-e2e/cli \
  @kraken-e2e/config \
  @kraken-e2e/core \
  @kraken-e2e/gherkin
```

You now have the `kraken` command available through `npx`. Confirm it:

```bash
npx kraken --version
# @kraken-e2e/cli/0.1.1 <your-platform> node-v22.x
```

### Meet `kraken doctor`

Kraken ships an environment diagnostic. It checks your host and, once you install real drivers, each driver's toolchain (Android SDK, JDK, Xcode, browsers…), reporting each check as **ok / warning / failure** with an actionable fix.

```bash
npx kraken doctor
```

At this point you'll see host checks pass (and a note that no drivers are installed yet — that's expected; we're about to run on fakes). `kraken doctor --json` prints the same information as machine-readable JSON, which doubles as a reproducible "what my machine looked like" snapshot.

> aside positive
>
> **The 14 packages.** Kraken is a monorepo of small, single-purpose packages: `contracts` (the SPI everything compiles against), `core` (orchestrator, scheduler, registry, host detection, conformance kit), `signaling` (the signal log + transports), `gherkin` (BDD front-end), `config`, `cli`, `tui` (the live terminal UI), the three drivers, `doctor`, `reporters`, `data-gen`, and `fuzz`. You only ever install the ones your project imports.

## Create your first project
Duration: 6:00

We'll build the messaging scenario piece by piece. Create this structure inside `kraken-tutorial/`:

```text
kraken-tutorial/
├── kraken.config.ts        # the cast, the drivers, where features/steps live
├── world.ts                # the fake "app + backend" for this codelab
├── features/
│   └── messaging.feature   # the scenario, in Gherkin
└── steps/
    └── index.ts            # your app-domain step definitions
```

> aside positive
>
> A real project would run `npx kraken init` to scaffold `kraken.config.ts`, a `steps/` folder, an example feature, and the VS Code Cucumber settings automatically. We're creating the files by hand so you see exactly what each one does.

### `kraken.config.ts` — the cast and the drivers

This is the only file that knows *what platform each actor is on*. For this codelab we bind all three actors to **fake** platforms served by a single in-memory fake driver:

```typescript
import { defineConfig } from '@kraken-e2e/config';
import { createFakeDriver } from '@kraken-e2e/core/testing';

import { createMessagingWorld } from './world.js';

// One shared world = the fake "backend" all three actors talk through.
const world = createMessagingWorld();

export default defineConfig({
  actors: {
    // In a real project these become { platform: 'android' | 'ios' | 'web' }
    // with real driver options — the feature file and steps stay unchanged.
    alice: { platform: 'android-fake' },
    bob: { platform: 'ios-fake' },
    carol: { platform: 'web-fake' },
  },
  drivers: [
    createFakeDriver({
      world,
      id: 'fake',
      platforms: ['android-fake', 'ios-fake', 'web-fake'],
    }),
  ],
  features: 'features/**/*.feature',
  steps: './steps/index.ts',
});
```

> aside negative
>
> Notice the import of `./world.js` from a `.ts` file. That's not a mistake — it's Node's `NodeNext` ESM module resolution, where you reference the **compiled** specifier even in source. Kraken loads your TypeScript config and steps directly (via `jiti`), so you never run a separate build step for them.

### `world.ts` — a fake app + backend

The fake driver needs something to drive. `FakeAppWorld` is an in-memory stand-in for your app **and** its backend: it holds UI elements per actor and lets you script what happens when an actor acts. Here, tapping Alice's send button fans the message out to Bob and Carol after simulated network latency:

```typescript
import { FakeAppWorld } from '@kraken-e2e/core/testing';

export function createMessagingWorld(): FakeAppWorld {
  const world = new FakeAppWorld();

  world.setElement('alice', 'composer', { text: '', visible: true });
  world.setElement('alice', 'send-button', { text: 'Send', visible: true });
  world.setElement('bob', 'message-cell', { text: '', visible: false });
  world.setElement('carol', 'feed-cell', { text: '', visible: false });

  world.onAction = (action, w) => {
    if (
      action.op === 'tap' &&
      action.target?.by === 'testId' &&
      action.target.value === 'send-button'
    ) {
      const message = w.getElement('alice', 'composer')?.text ?? '';
      // Simulated backend fan-out: 80ms to bob's device, 120ms to carol's feed.
      w.after(80, () => w.setElement('bob', 'message-cell', { text: message, visible: true }));
      w.after(120, () => w.setElement('carol', 'feed-cell', { text: message, visible: true }));
    }
  };

  return world;
}
```

This world is what makes the codelab **self-contained**: it plays the role that a real chat backend would play against real apps. When you go real, this file disappears and the actual app + server do the work.

## Write the scenario and its steps
Duration: 6:00

### The feature file

Create `features/messaging.feature`. Read it top to bottom — that's the exact order it executes:

```gherkin
Feature: Cross-platform direct messaging (on fakes)
  One logical scenario choreographs three actors on three (fake) platforms.
  Steps execute in text order — the screenplay; the explicit signal wait and
  the background task show the two escape hatches.

  Scenario: A message composed on Android arrives on iOS and on the web
    When bob starts recording the conversation as "recording"
    And alice writes "hola desde los Andes"
    And alice taps send
    Then bob waits for the signal "message-sent" within 5s
    And bob sees the message "hola desde los Andes" on "message-cell" within 3s
    And carol sees the message "hola desde los Andes" on "feed-cell" within 3s
    Then bob's background task "recording" completes within 10s
```

Three things to notice:

* Every step begins with an **actor name** (`bob`, `alice`, `carol`). Kraken runs that step *as* that actor, against that actor's own device session.
* `bob waits for the signal "message-sent"` is the **synchronization point** — Bob's device blocks until Alice's device announces the send.
* `bob starts recording … as "recording"` launches a **background task** that runs concurrently with the rest of the screenplay; the final step joins it.

### The step definitions

Kraken ships the *choreography* vocabulary (waiting for signals, joining background tasks, durations). The steps that touch **your app** live in your project. Create `steps/index.ts`:

```typescript
import { createStepRegistry } from '@kraken-e2e/gherkin';

export const { Given, When, Then, registry } = createStepRegistry();

const byTestId = (value: string) => ({ by: 'testId', value }) as const;

When('{actor} writes {string}', async ({ actor }, ...args) => {
  const [message] = args as unknown as [string];
  await actor.session.typeText(byTestId('composer'), message);
});

When('{actor} taps send', { publishes: ['message-sent'] }, async ({ actor }) => {
  await actor.session.tap(byTestId('send-button'));
  const text = await actor.session.readText(byTestId('composer'));
  await actor.signals.publish('message-sent', { text });
});

Then(
  '{actor} sees the message {string} on {string} within {duration}',
  { polls: true },
  async ({ actor }, ...args) => {
    const [expected, testId, timeoutMs] = args as unknown as [string, string, number];
    await actor.session.waitFor(byTestId(testId), 'visible', { timeoutMs });
    const text = await actor.session.readText(byTestId(testId));
    if (text !== expected) {
      throw new Error(`Expected "${expected}" on ${testId}, found "${text}".`);
    }
  },
);

When(
  '{actor} starts recording the conversation as {string}',
  { detached: true },
  async ({ actor }) => {
    // A long-running background action (screen recording, upload, stream…).
    await actor.session.waitFor(byTestId('message-cell'), 'visible', { timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
);
```

The `{actor}`, `{string}` and `{duration}` are **parameter types**. `{actor}` resolves to the acting actor (with `.session` and `.signals`); `{duration}` parses human strings like `5s` / `3s` / `10s` into milliseconds. The step's second argument is an **options object** carrying the escape-hatch flags:

* `{ publishes: ['message-sent'] }` — declares that this step emits a signal (feeds deadlock analysis and the reports).
* `{ polls: true }` — the assertion retries until it passes or the deadline hits.
* `{ detached: true }` — the step runs as a **background task**; the screenplay continues without awaiting it, and a later "completes within" step joins it.

> aside positive
>
> You did not have to write the steps `bob waits for the signal … within …` or `… background task … completes within …`. Those are **built-in choreography steps** Kraken provides. You only wrote the four app-specific ones.

## Run it
Duration: 5:00

From `kraken-tutorial/`, run the scenario with the plain (greppable) renderer:

```bash
npx kraken run --plain
```

You'll see something very close to this (timings will differ on your machine):

```text
Kraken run started (1 scenario)

Scenario: A message composed on Android arrives on iOS and on the web  [bob/ios-fake, alice/android-fake, carol/web-fake]
  ✓ [bob] bob starts recording the conversation as "recording" (0ms)
  ✓ [alice] alice writes "hola desde los Andes" (1ms)
  ✓ [alice] alice taps send (1ms)
    [bob] ⏳ waiting for signal "message-sent" (≤5000ms)
    [bob] ⚡ received "message-sent" from alice after 1ms
  ✓ [bob] bob waits for the signal "message-sent" within 5s (1ms)
  ✓ [bob] bob sees the message "hola desde los Andes" on "message-cell" within 3s (91ms)
  ✓ [carol] carol sees the message "hola desde los Andes" on "feed-cell" within 3s (31ms)
  ✓ [bob] bob's background task "recording" completes within 10s (…)
  ✓ scenario passed

Run passed in 149ms

Event log: .kraken/runs/<uuid>/events.jsonl
Allure results: .kraken/runs/<uuid>/allure-results — html: npx allure generate <dir> -o <out>
CTRF report: .kraken/runs/<uuid>/ctrf-report.json
```

**What just happened**, in order: three independent fake sessions started (Bob, Alice, Carol); Bob launched his background recording task; Alice typed and tapped send, which **published** the `message-sent` signal; Bob's device, already waiting, **received** it in ~1ms; then Bob and Carol each polled their own UI until the fanned-out message appeared (after the world's simulated 80ms / 120ms latencies); finally Bob's background task was joined. One scenario, three synchronized actors, green.

> aside negative
>
> The millisecond numbers and the run's UUID are wall-clock/random and **will** differ every run — don't treat them as fixed expected output. What's stable: the ✓ marks, the step text, the signal wait/receive lines, the ordering, and `scenario passed`.

Try the live UI too — drop `--plain` and Kraken renders **one lane per actor**, updating in place, with the signal-wait moment shown explicitly:

```bash
npx kraken run
```

## Signals & choreography, in depth
Duration: 5:00

The single most important thing to understand about Kraken is how `publish` and `waitFor` cooperate. Look again at the two ends of the handoff:

```typescript
// Alice's device announces the event, carrying a payload:
await actor.signals.publish('message-sent', { text });

// Bob's device blocks until it appears — built into the "waits for the signal" step:
const record = await actor.signals.waitFor('message-sent', { timeoutMs });
// record.payload.text === "hola desde los Andes"
```

### Why it doesn't race

In a naive implementation, if Alice publishes *before* Bob starts waiting, Bob waits forever. Kraken's log is **replay-first**: `waitFor` scans everything already published in this scenario before parking for new records. So the order of "publish" vs "wait" doesn't matter — the signal is delivered either way. Combined with per-subscriber **FIFO cursors**, every interested actor receives every matching signal exactly once, in order.

### Payloads carry data across devices

Signals aren't just flags. The `{ text }` payload traveled from Alice's device to Bob's — that's how you move a confirmation code, a generated username, or (as in the flagship example later) the very message text from one platform to another.

### The two escape hatches to the screenplay

The screenplay is sequential by default. When you need concurrency, you have exactly two tools, both visible in our example:

* **Signals** — for *coordination* between actors (wait until something happened elsewhere).
* **Background tasks** (`{ detached: true }` + a "completes within" join) — for *fire-and-continue* work that overlaps the rest of the story.

### Deadlock detection

Because signals are declared (`{ publishes: [...] }`) and waits are explicit, Kraken analyzes the scenario **statically**. If Bob waits for `message-snet` (a typo) and nobody ever publishes that name, Kraken fails the compile with a clear message and suggests `message-sent`. You find the mistake in milliseconds, not after a 30-second timeout on real devices.

```bash
npx kraken run --dry-run
# compiles & statically analyzes the scenario without booting any session
```

## Reports & watching runs live
Duration: 5:00

Every run writes a folder under `.kraken/runs/<runId>/`. Kraken's philosophy: **reporters are pure projections of one event stream**, so nothing special is needed to add a new one.

* **`events.jsonl`** — the substrate. One JSON event per line: `runStarted`, `scenarioStarted`, `actorSessionStarted`, `stepStarted`/`stepFinished`, `signalSent`/`signalReceived`, `scenarioFinished`, `runFinished`, and more. Inspect it with `jq`:

```bash
cat .kraken/runs/*/events.jsonl | jq -c 'select(.type | startswith("signal"))'
```

* **`allure-results/`** — feed Allure 3. Its HTML is generated by a pure-Node CLI (no Java needed):

```bash
npx allure generate .kraken/runs/<runId>/allure-results -o allure-report
npx allure open allure-report
```

In the Allure report, each scenario is one test, the actor↔platform cast shows as parameters, every step is prefixed with its actor, and **signal waits/receipts appear as first-class steps** — so the cross-device handoff is legible.

* **`ctrf-report.json`** — a CTRF (Common Test Report Format) file, ideal for CI summaries and PR comments once you wire up a pipeline.

### `kraken serve` — the live viewer

Kraken can serve the runs directory over HTTP + WebSocket, including a built-in dependency-free viewer:

```bash
npx kraken serve
# kraken serve listening on http://127.0.0.1:<port> (runs: .kraken/runs)
```

Open the printed URL. You'll see every run and its status; click one to tail its events. For an in-progress run, the WebSocket endpoint streams events **live** as they're appended. Because `serve` reads only the on-disk event log and artifacts — never the runner — a full graphical UI can be built entirely against its `/api/*` endpoints without touching Kraken's core.

| Endpoint | Purpose |
|---|---|
| `GET /` | built-in viewer (run list + live feed) |
| `GET /api/runs` | run index with derived status |
| `GET /api/runs/:id/events` | full event log as JSON |
| `GET /api/runs/:id/artifacts/<path>` | artifact files (screenshots, page source) |
| `WS /api/runs/:id/live` | replay + live tail of the event stream |

## Going real: Android, iOS and Web
Duration: 15:00

Here's the payoff of the hexagonal design: to drive real devices you change **configuration**, not steps. This section is fully runnable — it uses a real, freely downloadable demo app, and every failure mode we know of has a fix box.

### 1. Install the real drivers

```bash
npx kraken plugins install @kraken-e2e/driver-android
npx kraken plugins install @kraken-e2e/driver-web
# on macOS only:
npx kraken plugins install @kraken-e2e/driver-ios
```

Then confirm the toolchains:

```bash
npx kraken doctor
```

| Driver | Stack | Hosts | Doctor checks (examples) |
|---|---|---|---|
| `driver-android` | Appium 3 + UiAutomator2 (embedded server) | macOS · Linux · Windows | `ANDROID_HOME`, JDK 17+, `adb`, an AVD or device |
| `driver-ios` | Appium 3 + XCUITest (embedded server) | **macOS only** | Xcode, `simctl`, iOS runtimes, a simulator |
| `driver-web` | WebdriverIO native (no Appium) | macOS · Linux · Windows | a browser present; Safari's one-session limit |

### 2. See what devices you already have

Before configuring anything, ask Kraken what it can already drive:

```bash
npx kraken devices
```

```text
android — Android (UiAutomator2 via Appium 3)
  ○ Medium_Phone_API_36.0  [available] — boots on demand
      actor config: {"platform":"android","avd":"Medium_Phone_API_36.0"}

ios — iOS (XCUITest via Appium 3)
  ● iPhone 17 (iOS 26.5)  [running] — booted
      actor config: {"platform":"ios","udid":"44CC1455-CCD5-490E-8898-158527EE6445"}
  ○ iPhone 16 (iOS 18.6)  [available]
      actor config: {"platform":"ios","deviceName":"iPhone 16","platformVersion":"18.6"}
  …

web — Web (WebdriverIO native — no Appium)
  ○ Chrome  [available]
      actor config: {"platform":"web","browser":"chrome"}
```

Read the marks: **● running** targets (a booted simulator, a connected device or emulator) can be **reused as-is** — paste their `actor config` and Kraken boots nothing. **○ available** targets are provisioned on demand (an AVD is booted for you; a browser is spawned per session). If you have something running already, prefer it: session startup drops from minutes to seconds.

> aside positive
>
> Each line's `actor config` is copy-paste-ready for `kraken.config.ts`. For iOS, always take the pair **exactly** as printed — `deviceName` **and** `platformVersion` together. If you hand-write a name that doesn't exist for that iOS version, XCUITest silently *creates a brand-new simulator* per session (a "ghost-sim boot storm"). `kraken devices` shows only combinations that really exist, so you can't fall into that trap.

### 3. Get a demo app

Real mobile drivers need a real app binary — a placeholder path will not do. The WebdriverIO **native-demo-app** works with Kraken out of the box (its element ids are accessibility ids on both platforms). Download the official release into `apps/`:

```bash
mkdir -p apps
# Android APK
curl -L -o apps/native-demo-app.apk \
  https://github.com/webdriverio/native-demo-app/releases/download/v2.2.0/android.wdio.native.app.v2.2.0.apk
# iOS simulator build (macOS only)
curl -L -o apps/ios-demo.zip \
  https://github.com/webdriverio/native-demo-app/releases/download/v2.2.0/ios.simulator.wdio.native.app.v2.2.0.zip
unzip -q apps/ios-demo.zip -d apps/ && rm apps/ios-demo.zip
ls apps/
# native-demo-app.apk   wdiodemoapp.app
```

> aside negative
>
> If an actor's `app` file doesn't exist, Kraken now fails in **milliseconds** with `KRK-DRIVER-APP-NOT-FOUND` and the resolved path — instead of booting an emulator for three minutes first. Relative `app` paths resolve against your project root.

### 4. The real config

Create `kraken.real.config.ts` — take the device entries from **your** `kraken devices` output:

```typescript
import { defineConfig } from '@kraken-e2e/config';
import android from '@kraken-e2e/driver-android';
import ios from '@kraken-e2e/driver-ios';
import web from '@kraken-e2e/driver-web';

export default defineConfig({
  actors: {
    alice: {
      platform: 'android',
      avd: 'Medium_Phone_API_36.0',            // ← from `kraken devices`
      app: './apps/native-demo-app.apk',
      appPackage: 'com.wdiodemoapp',
    },
    bob: {
      platform: 'ios',
      deviceName: 'iPhone 16',                  // ← from `kraken devices`,
      platformVersion: '18.6',                  //   BOTH fields, exactly as printed
      app: './apps/wdiodemoapp.app',
      bundleId: 'org.wdiodemoapp',
    },
    carol: { platform: 'web', browser: 'chrome' },
  },
  drivers: [android(), ios(), web()],
  features: 'features/real/**/*.feature',
  steps: './steps/real.ts',
});
```

If `kraken devices` showed you a **booted** simulator or a **running** emulator, use its `udid` form instead — Kraken will attach to it directly.

### 5. A feature that works on the demo app

The demo app's *Forms* screen has a text input that mirrors what you type into a label — perfect for a cross-device relay. Because both platforms expose the same **accessibility ids**, one set of steps drives both. Create `features/real/relay.feature`:

```gherkin
Feature: Cross-device text relay (real devices)

  Scenario: text typed on Android is relayed to iOS through the signal bus
    When alice opens the forms screen
    And bob opens the forms screen
    And alice writes "un mensaje real"
    And alice transmits the composed text
    Then bob receives the transmitted text within 2m
    And bob types the received text
    Then bob sees the received text mirrored
```

And `steps/real.ts`:

```typescript
import { createStepRegistry } from '@kraken-e2e/gherkin';

export const { Given, When, Then, registry } = createStepRegistry();

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

When('{actor} opens the forms screen', async ({ actor }) => {
  await actor.session.navigate('wdio://forms');     // the demo app's deep link
  await actor.session.waitFor(a11y('Forms-screen'), 'visible', { timeoutMs: 20_000 });
});

When('{actor} writes {string}', async ({ actor }, ...args) => {
  const [text] = args as unknown as [string];
  await actor.session.typeText(a11y('text-input'), text);
});

When('{actor} transmits the composed text', { publishes: ['text-sent'] }, async ({ actor }) => {
  const text = await actor.session.readText(a11y('input-text-result'));
  await actor.signals.publish('text-sent', { text });
});

Then('{actor} receives the transmitted text within {duration}', async ({ actor, world }, ...args) => {
  const [timeoutMs] = args as unknown as [number];
  const record = await actor.signals.waitFor<{ text: string }>('text-sent', { timeoutMs });
  world['received'] = record.payload.text;
});

When('{actor} types the received text', async ({ actor, world }) => {
  await actor.session.typeText(a11y('text-input'), String(world['received'] ?? ''));
});

Then('{actor} sees the received text mirrored', async ({ actor, world }) => {
  const mirrored = await actor.session.readText(a11y('input-text-result'));
  if (mirrored !== String(world['received'])) {
    throw new Error(`Expected "${String(world['received'])}", found "${mirrored}".`);
  }
});
```

### 6. Run it

```bash
npx kraken run --config kraken.real.config.ts
```

Expect the **first** run to be slow: a cold AVD boot takes one to three minutes, and on macOS the first iOS session compiles WebDriverAgent (also minutes — cached afterwards). Subsequent runs on warm devices take well under a minute. The live lane view shows exactly which actor is booting, acting, or waiting on a signal at any moment.

### Troubleshooting

> aside negative
>
> **`KRK-DRIVER-APP-NOT-FOUND`** — the `app` path in your config doesn't point at a real file. Re-check step 3; relative paths resolve against the project root.

> aside negative
>
> **`Failed downloading chromedriver … executable is missing, retrying`** — a previously interrupted download left a corrupted driver cache. Kraken keeps its browser-driver cache **inside your project** at `.kraken/browser-cache`; delete it and re-run: `rm -rf .kraken/browser-cache`. (Older versions cached in the OS temp dir; clear `$TMPDIR/chromedriver*` if you hit this there.)

> aside negative
>
> **iOS session hangs or a strange new simulator appears** — your `deviceName`/`platformVersion` pair doesn't exist, so XCUITest is creating ghost simulators. Run `npx kraken devices` and copy a printed pair (or a booted sim's `udid`) verbatim. Stray `appiumTest-…` simulators are safe to delete.

> aside negative
>
> **First run takes minutes and seems stuck** — watch what's actually happening: `npx kraken serve` in a second terminal tails the run's events live, and `.kraken/runs/<id>/appium-*.log` has the full Appium debug log per platform.

> aside negative
>
> **Session boot times out (~5 min) against an emulator that's been up for hours** — a long-lived emulator's adb daemon can go zombie (even `adb uninstall` hangs). Reset it: `adb kill-server && adb start-server`, and if that's not enough, kill the emulator process and let Kraken cold-boot it fresh on the next run. An instrumentation crash mid-run (`instrumentation process is not running`) usually has the same root cause: an overloaded or stale emulator.

## Advanced building blocks
Duration: 5:00

Three more packages extend Kraken once your suites grow.

### Seeded, typed test data — `@kraken-e2e/data-gen`

Reproducible fixtures backed by Faker and validated by Zod. The same **seed** produces the same data on every machine and across actors, so multi-actor scenarios stay deterministic:

```typescript
import { defineFixture } from '@kraken-e2e/data-gen';
import { z } from 'zod';

const userFixture = defineFixture(
  z.object({ email: z.email(), name: z.string() }),
  (faker) => ({ email: faker.internet.email(), name: faker.person.fullName() }),
);

const alice = userFixture.build({ seed: 42 });        // identical for seed 42, always
const many = userFixture.buildMany(5, { seed: 42 });  // prefix-stable batches
```

### Cross-platform fuzzing — `@kraken-e2e/fuzz`

A seeded random-event engine that drives the **same** session contract, so one fuzz definition runs on Android, iOS or Web. Same seed → same walk, so any failure is replayable:

```typescript
import { runFuzz } from '@kraken-e2e/fuzz';

const result = await runFuzz({
  session: actor.session,
  surface: { tappable: [/* locators */], typable: [/* locators */] },
  steps: 100,
  seed: 7,               // reproducible; a failure captures the exact trace + a screenshot
});
```

### Distributed signaling — `@kraken-e2e/signaling/redis`

The default signal transport is in-memory. For runs spread across processes or machines, swap in the Redis Streams transport — it passes the **identical** conformance suite (chaos cases included), so the semantics you learned above hold exactly:

```typescript
import { RedisStreamTransport } from '@kraken-e2e/signaling/redis';
// node-redis is an optional peer dependency; installing Kraken never pulls it in.
```

## Congratulations!
Duration: 2:00

You've gone from zero to a working multi-actor, cross-platform Kraken scenario — and you understand *why* it works, not just *that* it works.

### What you covered

* Kraken's model: **actors**, the **screenplay**, **signals** (replay-first, FIFO, deadlock-checked), portable **locators/keys**, and **drivers** behind a hexagonal core
* Installing the CLI, `kraken doctor`, and scaffolding a project
* Writing and running a three-actor scenario **on fakes** — no devices — and reading its output
* Signals and background tasks as the two escape hatches to sequential execution
* Reports (JSONL / Allure / CTRF) and the live `kraken serve` viewer
* Graduating to real Android, iOS and Web by changing **only configuration**
* Seeded data generation, cross-platform fuzzing, and distributed signaling

### Where to go next

* **Make it real.** Install `@kraken-e2e/driver-web` and point Carol at a local web app you're building — you already have a passing scenario to grow from.
* **Add a second scenario** that uses a signal **payload** to carry data (a one-time code, a generated username) from one actor to another.
* **Wire CI.** Emit the CTRF report in a pipeline and surface it as a PR comment.
* **Explore the source.** Everything is on npm under `@kraken-e2e/*` and the architecture decisions are recorded as ADRs in the repository.

> aside positive
>
> Kraken 3.0 is a ground-up TypeScript rewrite from the Software Design Lab at Universidad de los Andes, succeeding the Ruby (v1) and Node/Cucumber (v2) generations. It is released under the GNU GPL v3.0.
