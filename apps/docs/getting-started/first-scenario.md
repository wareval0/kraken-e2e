# Your first scenario

This page builds and runs a complete three-actor scenario — a message composed on "Android" arrives on "iOS" and on "the web" — using the **fake driver**, so it runs on any machine with zero devices, emulators or browsers. The fake driver is not a mock of Kraken: it is a first-class in-memory driver implementing the full session contract, with one screen per actor and a shared world through which one actor's action can change another actor's screen after simulated latency. The whole engine — orchestrator, scheduler, signaling, reporting — runs exactly as it does against real devices.

The finished project ships in the repository as `examples/fake-messaging`.

## Project setup

Starting from a directory scaffolded with [`kraken init`](/getting-started/first-project), install the packages the example imports:

```bash
npm install --save-dev @kraken-e2e/cli @kraken-e2e/config @kraken-e2e/contracts @kraken-e2e/core @kraken-e2e/gherkin
```

Four files make up the scenario: `world.ts`, `kraken.config.ts`, `features/messaging.feature` and `steps/index.ts`.

## The world: a fake app with a fake backend

`world.ts` defines the application under test — the "app plus backend" the three actors share:

```ts
/**
 * The fake "app + backend" this example choreographs: alice composes on the
 * (fake) Android app; the backend delivers to bob's (fake) iOS app and carol's
 * (fake) web dashboard after simulated network latency.
 */
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
      // Simulated backend fan-out: 80ms to bob's device, 120ms to carol's web feed.
      w.after(80, () => w.setElement('bob', 'message-cell', { text: message, visible: true }));
      w.after(120, () => w.setElement('carol', 'feed-cell', { text: message, visible: true }));
    }
  };

  return world;
}
```

`FakeAppWorld` maintains one screen per actor — a map from test id to `{ text, visible }` elements — and a hook for app behavior:

| Member | Purpose |
|---|---|
| `setElement(actorId, testId, element)` | Place or replace an element on an actor's screen. |
| `getElement(actorId, testId)` | Read an element from an actor's screen. |
| `screen(actorId)` | The actor's whole screen as a `Map<string, FakeElement>`. |
| `onAction` | The "backend logic": called with every recorded session action (`tap`, `typeText`, `pressKey`, `navigate`, `scrollIntoView`) and the world itself. |
| `after(ms, effect)` | Apply an effect after a simulated latency — e.g. message delivery. |
| `actions` | The chronological record of every action performed against the world. |
| `pendingEffects` | The number of `after` effects not yet applied. |

Here, alice tapping `send-button` makes the backend read her composer and deliver its text to bob's `message-cell` after 80 ms and to carol's `feed-cell` after 120 ms — a genuine cross-actor effect that the assertions later observe.

## The configuration

```ts
import { defineConfig } from '@kraken-e2e/config';
import { createFakeDriver } from '@kraken-e2e/core/testing';

import { createMessagingWorld } from './world.js';

// One shared world = the fake "backend" all three actors talk through.
const world = createMessagingWorld();

export default defineConfig({
  actors: {
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

The driver is registered as a *value* — the typed factory form of driver registration — rather than as a package-name string. One `createFakeDriver` serves all three platform ids, and because every actor's session shares the same `world`, actions and effects cross actor boundaries exactly like a real backend. `createFakeDriver` accepts:

| Option | Default | Purpose |
|---|---|---|
| `world` | — (required) | The shared `FakeAppWorld`. |
| `id` | `'fake'` | The driver id. |
| `platforms` | `['fake']` | The platform ids this driver provides. |
| `hostRequirements` | none | Simulate a host-gated driver (e.g. `{ platforms: ['darwin'] }`). |
| `unsupported` | `[]` | Session operations to declare unsupported (they throw `KRK-SESSION-OP-UNSUPPORTED`). |
| `failOn` | none | Make one operation fail, optionally for one actor — for exercising failure paths. |
| `opLatencyMs` | `0` | Artificial per-operation latency. |

## The feature

```gherkin
Feature: Cross-platform direct messaging (on fakes)
  One logical scenario choreographs three actors on three (fake) platforms.
  Steps execute in text order — the screenplay; the explicit
  signal wait and the background task show the two escape hatches.

  Scenario: A message composed on Android arrives on iOS and on the web
    When bob starts recording the conversation as "recording"
    And alice writes "hola desde los Andes"
    And alice taps send
    Then bob waits for the signal "message-sent" within 5s
    And bob sees the message "hola desde los Andes" on "message-cell" within 3s
    And carol sees the message "hola desde los Andes" on "feed-cell" within 3s
    Then bob's background task "recording" completes within 10s
```

Steps run in the order written, one at a time, regardless of which actor they address — the screenplay model described in [How Kraken works](/introduction/how-kraken-works). Two of these steps are Kraken built-ins from the choreography vocabulary:

- `{actor} waits for the signal {string} within {duration}` — parks the actor until the named signal arrives (a `from {actor}` variant also exists).
- `{actor}'s background task {string} completes within {duration}` — joins a background task started earlier by a detached step.

Everything else is project vocabulary, defined next.

## The steps

```ts
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
    // A long-running background action (screen recording, upload, stream…):
    // here simulated as watching the message cell for a while.
    await actor.session.waitFor(byTestId('message-cell'), 'visible', { timeoutMs: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
  },
);
```

Points worth noting:

- **`{actor}`** resolves to the addressed actor's context: `actor.session` is the platform session (identical interface on every platform), `actor.signals` publishes and waits for signals. `{duration}` arrives in the handler already converted to milliseconds.
- **`publishes: ['message-sent']`** declares the signal this handler publishes. The declaration feeds the static analyzer: before any session boots, Kraken verifies that every signal wait in the scenario can be satisfied by some earlier-or-detached publisher.
- **`polls: true`** is a documentation marker identifying a `Then` step as a polling assertion.
- **`detached: true`** turns the step into a background task that runs alongside the rest of the screenplay. Its handle is the step's **last string argument** — here `"recording"` — the documented convention; a handle must be unique within a scenario, and every detached task must be joined by the built-in completion step before the scenario ends. Bob therefore starts observing *before* alice sends, and the join at the end propagates any failure from the background work.

## Compile without running

Every run begins with a compile-and-analyze pass, and `--dry-run` stops there:

```bash
npx kraken run --dry-run
```

```text
Dry run OK: 1 scenario(s), 7 step(s), actors: bob, alice, carol.
```

The analyzer rejects — with `✗ [CODE] file › scenario: message` diagnostics and exit code 1, before any session boots — steps that match no definition, steps naming actors outside the closed cast, signal waits that no step can satisfy (suggesting the closest published name when the cause is a typo), reused background-task handles, joins with no matching start, and started tasks that are never joined.

## Run it

```bash
npx kraken run --plain
```

```text
Kraken run started (1 scenario)

Scenario: A message composed on Android arrives on iOS and on the web  [bob/ios-fake, alice/android-fake, carol/web-fake]
  ✓ [bob] bob starts recording the conversation as "recording" (1ms)
  ✓ [alice] alice writes "hola desde los Andes" (0ms)
  ✓ [alice] alice taps send (2ms)
    [bob] ⏳ waiting for signal "message-sent" (≤5000ms)
    [bob] ⚡ received "message-sent" from alice after 0ms
  ✓ [bob] bob waits for the signal "message-sent" within 5s (1ms)
  ✓ [bob] bob sees the message "hola desde los Andes" on "message-cell" within 3s (79ms)
  ✓ [carol] carol sees the message "hola desde los Andes" on "feed-cell" within 3s (48ms)
  ✓ [bob] bob's background task "recording" completes within 10s (1ms)
  ✓ scenario passed in 134ms

Run passed in 137ms

Event log: /Users/dev/messaging-e2e/.kraken/runs/21b9ae91-1d2a-4e10-a5f8-1a5293f12ca4/events.jsonl
Allure results: /Users/dev/messaging-e2e/.kraken/runs/21b9ae91-1d2a-4e10-a5f8-1a5293f12ca4/allure-results — html: npx allure generate <dir> -o <out>
CTRF report: /Users/dev/messaging-e2e/.kraken/runs/21b9ae91-1d2a-4e10-a5f8-1a5293f12ca4/ctrf-report.json
```

Reading the output:

- The **run header** states how many scenarios execute. Each **scenario header** names the scenario and its cast — every participating actor with its platform.
- Each **step line** carries a status mark (`✓` passed, `✗` failed, `–` skipped), the addressed actor in brackets, the step text and its duration. A failed step adds an indented line with the error code and message.
- The indented **signal lines** trace synchronization: `⏳` marks a wait beginning (with its timeout budget), `⚡` marks delivery — naming the publisher and the latency between publication and delivery. A wait that expires prints `✗ signal "…" never arrived (Nms)`. Note the delivery latency of `0ms`: alice's publish happened *before* bob's wait step began, and the signal log's replay-first delivery hands it over immediately — publish/wait ordering is irrelevant to correctness.
- Captured artifacts (screenshots, for example) appear as indented `↳ kind [actor]: path` lines.
- The **scenario and run summaries** report status and duration; the process exits 0 when the run passed and 1 otherwise.
- The final lines locate the run's artifacts under `.kraken/runs/<run-id>/`: `events.jsonl` is the canonical, totally ordered event log from which every other output is a projection; the Allure results directory renders to HTML with the printed `allure` command; `ctrf-report.json` is the CTRF summary.

Without `--plain`, on an interactive terminal (and with no `CI` environment variable), `kraken run` renders a live terminal UI instead; the plain line renderer shown above is selected automatically in CI and in non-TTY contexts.

## Going real

Nothing in the feature file or the step definitions is fake-specific. Replacing the fake driver with real ones is purely a configuration change:

```ts
actors: {
  alice: { platform: 'android', avd: 'Pixel_9_API_35', app: './apps/app.apk' },
  bob:   { platform: 'ios', deviceName: 'iPhone 16', platformVersion: '18.6', app: './apps/App.app' },
  carol: { platform: 'web', browser: 'chrome' },
},
drivers: [
  '@kraken-e2e/driver-android',
  '@kraken-e2e/driver-ios',
  '@kraken-e2e/driver-web',
],
```

Install the drivers with [`kraken plugins install`](/getting-started/first-project#installing-a-driver-kraken-plugins-install), verify the toolchains with [`kraken doctor`](/getting-started/installation#first-validation-kraken-doctor), and continue with [Configuration](/guide/configuration) for the full set of per-platform actor options.
