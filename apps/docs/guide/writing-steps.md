# Writing steps

Step definitions bind Gherkin step text to code. In Kraken they live in the project — the framework ships only the choreography built-ins described in [Writing features](/guide/writing-features#built-in-steps) — and are registered on a **step registry** that the CLI loads before compiling the feature files.

## The step registry

A project creates its registry once with `createStepRegistry` from `@kraken-e2e/gherkin` and destructures the result:

```ts
// steps/index.ts
import { createStepRegistry } from '@kraken-e2e/gherkin';

export const { Given, When, Then, defineParameterType, registry } = createStepRegistry();
```

`createStepRegistry()` returns:

| Member | Purpose |
|---|---|
| `Given`, `When`, `Then` | Register a step definition (the three are equivalent — the keyword is not recorded) |
| `defineParameterType` | Register a custom parameter type (see [below](#custom-parameter-types)) |
| `registry` | The `StepRegistry` instance the CLI consumes |

Two aspects of this shape are deliberate:

- **Instance-based, no import-order magic.** Definitions attach to the registry instance the call was destructured from, not to hidden global state.
- **Destructure, do not namespace.** The Cucumber VS Code extension indexes *bare* `Given(...)`/`When(...)`/`Then(...)` call sites with tree-sitter queries. Namespaced calls such as `api.Given(...)` are invisible to it, losing autocomplete and feature-to-definition navigation.

### How the CLI finds the registry

The `steps` entry of `kraken.config.ts` (default `./steps/index.ts`) names a module that **must export `registry`** as created by `createStepRegistry()`. The CLI loads it with an embedded TypeScript loader (jiti), so no build step is required. Projects with many step files import them from that module so every definition registers on the same instance:

```ts
// steps/index.ts
import { createStepRegistry } from '@kraken-e2e/gherkin';
export const { Given, When, Then, defineParameterType, registry } = createStepRegistry();

import './messaging.steps.js';
import './rooms.steps.js';
```

```ts
// steps/messaging.steps.ts
import { When, Then } from './index.js';
```

A steps module that does not export a valid registry fails fast with `KRK-CONFIG-INVALID` before compilation.

## Defining a step

A definition takes an expression, an optional options object, and an async handler:

```ts
When('{actor} sends the message {string}', async ({ actor }, ...args) => {
  const [message] = args as unknown as [string];
  await actor.session.typeText({ by: 'testId', value: 'composer' }, message);
  await actor.session.tap({ by: 'testId', value: 'send' });
});

When(
  '{actor} announces {string}',
  { publishes: ['$1'] },
  async ({ actor }, ...args) => {
    const [name] = args as unknown as [string];
    await actor.signals.publish(name);
  },
);
```

Rules:

- **Every expression must contain `{actor}`.** Registration throws `KRK-STEP-UNKNOWN-ACTOR` otherwise — every Kraken step is addressed to exactly one actor, and the fix is to start the expression with `{actor} …`. When an expression contains several `{actor}` parameters, the first is the addressee.
- **The handler is async**: `(ctx, ...args) => Promise<void>`. Omitting the handler is a registration error.
- **Arguments arrive transformed and actor-free.** `args` contains the values of the expression's parameters in order, already converted by their parameter types (`{int}` → `number`, `{duration}` → milliseconds as `number`, `{string}` → unquoted `string`), with the addressee excluded. The rest parameter is typed `never[]`, so handlers narrow it explicitly: `const [a, b] = args as unknown as [string, number];`.
- **Expressions must be mutually exclusive.** Two definitions matching the same step text produce a `STEP_AMBIGUOUS` compile error when a feature uses that text.

## The step context

The first handler argument is the `StepRunContext`:

| Field | Type | Meaning |
|---|---|---|
| `actor` | `ActorRuntime` | The addressed actor's runtime (below) |
| `world` | `Record<string, unknown>` | Per-scenario shared state across all actors' steps |
| `tasks` | `TaskRegistry` | The scenario's background-task registry; managed by the scheduler — handlers normally never touch it |
| `abort` | `AbortSignal` | Fired on the first failure in the scenario (fail-fast); long operations and detached bodies must honor it |
| `actors` | `ReadonlyMap<string, ActorRuntime>` | All booted actor runtimes, for the rare step that must inspect another actor |

`ActorRuntime` — what `ctx.actor` exposes:

| Field | Type | Meaning |
|---|---|---|
| `id` | `string` | The actor's declared name |
| `platform` | `string` | The actor's platform (`android`, `ios`, `web`, …) |
| `session` | `UserSession` | The device session — see [below](#actor-session) |
| `signals` | `SignalHandle` | The actor's signal handle — see [below](#actor-signals) |
| `log` | `Logger` | Structured logging: `debug`/`info`/`warn`/`error(message, meta?)`, routed into the run's event stream |

## The world

`ctx.world` is a plain object created fresh for each scenario and shared by **every step of every actor** in that scenario, including detached task bodies. It is the mechanism for passing runtime data — generated names, server-assigned ids — from one actor's step to another's:

```ts
When('{actor} creates a room', async ({ actor, world }) => {
  const roomName = `room-${Date.now()}`;
  await actor.session.typeText({ by: 'testId', value: 'room-name' }, roomName);
  await actor.session.tap({ by: 'testId', value: 'create' });
  world['roomName'] = roomName;
});

Then('{actor} sees the room in the list', async ({ actor, world }) => {
  const roomName = world['roomName'] as string;
  await actor.session.waitFor({ by: 'text', value: roomName }, 'visible', { timeoutMs: 10_000 });
});
```

The world carries *data*; it does not synchronize. Ordering between devices is the job of [signals](/guide/signals).

## Step options

The optional second argument to `Given`/`When`/`Then` accepts three flags.

### `publishes`

```ts
When(
  '{actor} sends the message {string}',
  { publishes: ['message-sent'] },
  async ({ actor }, ...args) => {
    // … perform the action …
    await actor.signals.publish('message-sent');
  },
);
```

`publishes` declares the signal names the handler publishes. The declaration feeds the [static deadlock analysis](/guide/writing-features#dry-run-compilation): a built-in signal-wait step compiles only if an earlier step or background task declares publishing the awaited name.

A `'$N'` entry references the step's **Nth handler argument** (1-based, addressee excluded) and is resolved at compile time from the concrete step text. `publishes: ['$1']` on `'{actor} announces {string}'` means the step `alice announces "round-over"` declares publishing `round-over`.

The declaration is honor-system: nothing prevents a handler from publishing names it did not declare. The analyzer catches the class that matters — waits with no declared producer — and runtime diagnostics cover the rest: a signal wait that times out reports the scope's history and suggests published names within edit distance 2 of the awaited one.

### `polls`

```ts
Then(
  '{actor} sees the message {string}',
  { polls: true },
  async ({ actor }, ...args) => {
    const [message] = args as unknown as [string];
    await actor.session.waitFor({ by: 'text', value: message }, 'visible', { timeoutMs: 10_000 });
  },
);
```

`polls` is a marker declaring that the definition is a **polling assertion**: a `Then`-step whose handler retries its check until an explicit deadline (typically via `session.waitFor`) instead of asserting once. It is recorded on the definition as metadata and does not change matching or scheduling — the retry behavior itself lives in the handler.

### `detached`

```ts
When(
  '{actor} starts uploading {string} as {string}',
  { detached: true },
  async ({ actor, abort }, ...args) => {
    const [file] = args as unknown as [string, string];
    // Long-running work; must honor the abort signal.
    await uploadWithAbort(actor.session, file, abort);
  },
);
```

`detached: true` turns the definition into a **background task**:

- At runtime the step passes as soon as the handler *starts*; the handler keeps running concurrently with the following steps.
- The **last `{string}` argument** in the step text is the task handle — the name the scenario later joins on. A trailing `{duration}` or `{int}` never shadows it; a detached expression with no string parameter is a compile error.
- The task is joined with the built-in step `` {actor}'s background task {string} completes within {duration} ``. The join blocks until the task settles; a handler that threw in the background surfaces its error at the join (`KRK-STEP-FAILED`), and a task that outlives the timeout fails the join with `KRK-PLAN-TASK-JOIN-TIMEOUT`.
- Every detached task **must** be joined before the scenario ends, handles are unique per scenario, and a join requires an earlier detach — all three are compile errors, plus runtime leak detection as a backstop (`KRK-PLAN-UNJOINED-TASK`).
- Detached bodies must honor `ctx.abort`. After a scenario ends, still-running tasks are drained with a bounded grace period; a task that ignores the abort signal past that budget fails the scenario explicitly.

## The actor surfaces

### `actor.session` {#actor-session}

`actor.session` is the actor's device session — the same contract on Android, iOS and Web: `tap`, `typeText`, `readText`, `waitFor`, `isDisplayed`, `scrollIntoView`, `pressKey`, `navigate`, `screenshot`, `source`, plus the typed `native()` escape hatch. Elements are addressed with portable locators (`{ by: 'testId' | 'text' | 'a11y' | 'native', value }`). The full surface, locator semantics and platform mappings are documented in [The session API](/guide/session-api).

### `actor.signals` {#actor-signals}

`actor.signals` is the actor's handle onto the scenario's signal log:

| Member | Signature | Semantics |
|---|---|---|
| `publish` | `publish(name, payload?)` | Append a named record, optionally carrying a JSON-serializable payload; resolves once durably ordered, never blocks on receivers |
| `waitFor` | `waitFor(name, { timeoutMs, from?, where?, signal? })` | Resolve with the earliest matching record this actor has not yet consumed — replay-first, per-subscriber FIFO |
| `barrier` | `barrier(name, { participants, timeoutMs, signal? })` | Rendezvous: resolves once every listed participant has arrived |
| `subscriberId` | `string` | This handle's identity in the log (the actor id) |

`waitFor` options: `timeoutMs` is mandatory — there is no library default; `from` accepts only records published by that subscriber; `where` is a payload predicate (a rejected record is consumed for this cursor — there is no non-consuming peek); `signal` aborts the wait. One pending wait per subscriber and signal name: concurrent identical waits are rejected by design as ambiguous. Full semantics, transports and diagnostics are documented in [Signals](/guide/signals).

When a handler publishes, declare the names with [`publishes`](#publishes) so feature files can wait on them without tripping the deadlock analyzer.

## Custom parameter types

`defineParameterType` registers project-specific parameter types on the same registry:

```ts
defineParameterType({
  name: 'color',
  regexp: /red|green|blue/,
  transformer: (value) => value.toUpperCase(),
});

When('{actor} picks the {color} pill', async ({ actor }, ...args) => {
  const [color] = args as unknown as [string]; // 'RED' | 'GREEN' | 'BLUE'
});
```

The `transformer` is optional; without it the raw matched text is passed through.

## Editor integration

The Cucumber VS Code extension cannot discover parameter types that live inside `node_modules`, so `kraken init` scaffolds `.vscode/settings.json` with everything the extension needs — feature and glue globs plus Kraken's parameter-type regexps:

```json
{
  "cucumber.features": ["features/**/*.feature"],
  "cucumber.glue": ["steps/**/*.ts"],
  "cucumber.parameterTypes": [
    { "name": "actor", "regexp": "[a-zA-Z][a-zA-Z0-9_-]*|\"[^\"]+\"" },
    { "name": "duration", "regexp": "\\d+(?:\\.\\d+)?(?:ms|s|m)" }
  ]
}
```

With this file in place the extension autocompletes steps containing `{actor}` and `{duration}`, navigates from feature lines to definitions, and flags undefined steps as you type. The regexps are kept byte-identical to the runtime matchers in `@kraken-e2e/gherkin` — a repository test pins the equality — so the editor and the compiler always agree on what matches.

`kraken init` never overwrites existing files; merge the `cucumber.*` keys manually into a pre-existing `settings.json`. When you add a [custom parameter type](#custom-parameter-types), append a matching `{ "name", "regexp" }` entry to `cucumber.parameterTypes` so editor autocomplete covers it too. See the [CLI reference](/reference/cli) for everything `kraken init` scaffolds.
