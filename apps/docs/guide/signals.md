# Signals

Signals are Kraken's synchronization primitive: the only sanctioned way for one actor's progress to depend on another's. They are implemented by `@kraken-e2e/signaling`, a standalone package with zero runtime dependencies — usable with the Gherkin runner, with the programmatic API, or entirely on its own.

This page covers the log model, the `publish`/`waitFor` API as step definitions use it, the delivery guarantees, static deadlock detection, timeout diagnostics, the distributed Redis transport, and the conformance suite that every transport must pass.

## The model: an append-only log per scenario

Every scenario instance owns one **signal scope**, identified by `{ runId, scenarioId }`. Each `Examples` row of a scenario outline is its own instance and therefore its own scope; cross-scenario signals are unsupported by design. The runner opens the scope before the first step and destroys it during teardown.

Within a scope, signals form an **append-only log**. Publishing appends a record; nothing is ever removed or mutated until the scope is destroyed with the scenario. Every record has this shape:

| Field | Type | Meaning |
|---|---|---|
| `seq` | `number` | Strictly increasing per scope, assigned by the transport's single sequencer. The total order. |
| `name` | `string` | The signal name given to `publish`. |
| `from` | `string` | Subscriber id of the publisher — the actor id in Gherkin runs. |
| `payload` | `P` | The JSON-cloned payload (`null` when omitted). |
| `publishedAt` | `number` | Epoch milliseconds at the sequencer. Diagnostic only — never used for ordering. |

Readers do not remove records. Instead, each subscriber advances a private **cursor** through the log, which is what makes the delivery guarantees below possible.

## Publishing

Inside a step definition, the addressed actor's handle is `ctx.actor.signals` (see [Writing steps](/guide/writing-steps)):

```ts
When('{actor} taps send', { publishes: ['message-sent'] }, async ({ actor }) => {
  await actor.session.tap({ by: 'testId', value: 'send-button' });
  const text = await actor.session.readText({ by: 'testId', value: 'composer' });
  await actor.signals.publish('message-sent', { text });
});
```

```ts
publish<P extends SignalPayload>(name: string, payload?: P): Promise<SignalRecord<P>>
```

`publish` is fire-and-persist: the returned promise resolves once the record is durably ordered in the log. It never blocks on receivers and never fails because nobody is listening. The resolved value is the appended record, including its assigned `seq`.

### Payload rules

Payloads must be **JSON-serializable** — the `SignalPayload` type admits `null`, booleans, numbers, strings, arrays and plain objects thereof, and nothing else:

```ts
type SignalPayload =
  | null
  | boolean
  | number
  | string
  | SignalPayload[]
  | { [key: string]: SignalPayload };
```

Every transport round-trips payloads through JSON, so records are isolated **by value**: mutating an object after publishing it does not change the record any subscriber receives. Passing a function, a session object or a cyclic structure throws `SignalPayloadError`. An omitted payload is normalized to `null`.

Two guardrails apply, both configurable through `SignalBusOptions`:

| Option | Default | Effect |
|---|---|---|
| `maxPayloadBytes` | `65536` (64 KiB) | A serialized payload above the cap throws `SignalPayloadError`. |
| `scopeRecordWarnThreshold` | `10000` | Publishing more records than this in one scope emits a one-time warning through `onWarning` (a runaway publish loop diagnostic). |
| `onWarning` | — | Callback receiving warning messages; the orchestrator wires it to its logger. |

::: tip
Signals coordinate actors — they are not a data pipe. When a payload approaches the cap, pass a reference (an id, a path) instead of the data itself.
:::

## Waiting

```ts
waitFor<P extends SignalPayload>(name: string, opts: WaitOptions<P>): Promise<SignalRecord<P>>
```

```ts
const record = await actor.signals.waitFor<{ text: string }>('message-sent', {
  timeoutMs: 5_000,
});
record.payload.text; // typed payload
record.from;         // who published it
record.seq;          // its position in the scope's total order
```

Each call resolves with **exactly one record**: the earliest record matching the query that this subscriber has not yet consumed. `WaitOptions`:

| Option | Type | Required | Description |
|---|---|---|---|
| `timeoutMs` | `number` | yes | Wall-clock budget. There is no library-level default — every wait states its own budget explicitly, by design. |
| `from` | `string` | no | Only accept records published by this subscriber. The filter is part of the cursor key (see below). |
| `where` | `(payload: P) => boolean` | no | Client-side payload filter. A predicate-rejected record is **permanently consumed** for this cursor — there is no non-consuming peek. Retries after a rejection continue within the same `timeoutMs` budget. |
| `signal` | `AbortSignal` | no | Cancels the pending wait with `SignalWaitAbortedError`. In Gherkin runs the scenario's fail-fast abort signal is wired in automatically when this is omitted. |

## Replay-first delivery

`waitFor` inspects the log's **history first** and only then parks for live records. A signal published before the wait began is therefore never lost — publish-before-wait is safe by design, and the relative timing of `publish` and `waitFor` is irrelevant to correctness. The lost-wakeup race that plagued ad-hoc synchronization (and Kraken v2's signal implementation) cannot occur.

```gherkin
When alice taps send                                  # publishes "message-sent"
Then bob waits for the signal "message-sent" within 5s  # started AFTER the publish — still delivered
```

## Per-subscriber FIFO cursors

Delivery state is a cursor per `(subscriber, signal name, from-filter)` channel. Consequences:

- Each subscriber consumes each matching record **once**, in publication (`seq`) order.
- Repeated publications of the same name are counted, not collapsed: collecting N publications is N sequential waits, and they arrive in publish order.
- Waits filtered with `from` keep a cursor separate from unfiltered waits on the same name: a `from`-filtered wait never advances past other senders' records, because those records were never delivered to that waiter.

```ts
Then('{actor} collects {int} sign-offs in publish order within {duration}',
  async ({ actor, world }, ...args) => {
    const [count, timeoutMs] = args as unknown as [number, number];
    const collected: Array<{ platform: string; by: string }> = [];
    for (let i = 0; i < count; i += 1) {
      // FIFO per subscriber: each wait resumes after the last delivered record,
      // so the same signal name yields each publication exactly once, in order.
      const record = await actor.signals.waitFor<{ platform: string; by: string }>(
        'signoff',
        { timeoutMs },
      );
      collected.push(record.payload);
    }
    world['signoffs'] = collected;
  });
```

One subscriber cannot hold two pending waits on the same channel at the same time: which record would go to which wait is ambiguous, so the second call throws `SignalUsageError`. Wait sequentially to count; use distinct subscribers to broadcast.

## Fan-out

Cursors are per subscriber, so **one publication satisfies every waiting subscriber**. If three actors are each waiting for `release-published`, a single `publish('release-published', …)` delivers the same record — same `seq`, same payload — to all three. Broadcast requires no extra API; it is a property of the log model.

## Barriers

`barrier` is rendezvous sugar over `publish` + `waitFor`:

```ts
barrier(name: string, opts: {
  participants: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<void>
```

The caller publishes `${name}:${self}` and waits, concurrently, for `${name}:${participant}` from every other listed participant. When every participant executes the same barrier with the same participant list, all of them proceed together or none does (within the timeout).

## Signals in Gherkin

Kraken ships exactly two built-in waiting steps — the choreography vocabulary is deliberately minimal, and publishing is always done from the project's own step definitions:

| Step expression | Behavior |
|---|---|
| `{actor} waits for the signal {string} within {duration}` | `actor.signals.waitFor(name, { timeoutMs })` |
| `{actor} waits for the signal {string} from {actor} within {duration}` | `actor.signals.waitFor(name, { timeoutMs, from })` |

`{duration}` accepts `500ms`, `10s` or `2m` and converts to milliseconds — this is how the mandatory `timeoutMs` is supplied from the feature file.

Step definitions that publish declare it with the `publishes` option:

```ts
When('{actor} taps send', { publishes: ['message-sent'] }, async ({ actor }) => {
  await actor.signals.publish('message-sent');
});

// '$N' references the step's Nth handler argument (1-based, actor excluded),
// for steps whose signal name comes from the feature text:
When('{actor} announces {string}', { publishes: ['$1'] }, async ({ actor }, ...args) => {
  const [name] = args as unknown as [string];
  await actor.signals.publish(name);
});
```

## Static deadlock detection

The `publishes` declarations exist so the compiler can reason about signal reachability **before any session boots**. Steps execute in written order (the screenplay total order), so a built-in wait step whose signal is not declared as published by any *earlier* step or background task is a guaranteed deadlock — the wait can never be satisfied. The compiler rejects it as an error:

```
"bob waits for the signal "paid" within 5s" waits for signal "paid", but no earlier
step or background task declares publishing it (via the publishes: option). Under
screenplay order this wait can never be satisfied.
```

`kraken run` refuses to start while any compilation error exists; `kraken run --dry-run` stops after this analysis pass. The analysis covers the built-in wait steps; a `waitFor` call buried inside a custom step handler is not statically visible (declare `publishes` on producers and prefer the built-in wait steps for choreography), and any wait that slips through is still caught at runtime by its timeout.

## Timeout diagnostics

A wait that exhausts its budget rejects with `SignalTimeoutError`. This is classified as a **test failure** (the scenario is wrong or too slow), not an infrastructure failure. The error message is self-diagnosing — it carries what was expected, what actually happened, and the most likely cause:

```
Timed out after 5000ms: subscriber "bob" was waiting for signal "mesage-sent"
(after seq 0) in scope 7f3a…/features/messaging.feature#1.
Signals published so far: "message-sent" by alice (seq 1). Did you mean "message-sent"?
```

Three parts are always present:

1. **The wait**: subscriber, signal name, the cursor position (`after seq N`) the wait was issued with, the budget, and the scope.
2. **The history snapshot**: every signal published in the scope so far, as `"name" by publisher (seq N)` — or `No signals were published in this scope.` when the log is empty. This is the "what actually happened" dump.
3. **Near-miss suggestions**: signal names present in the history within Levenshtein edit distance 2 of the waited name — the typo diagnosis (`Did you mean …?`). Omitted when there is no near miss.

The same data is available programmatically on `error.detail` (`SignalTimeoutDetail`):

| Field | Type | Meaning |
|---|---|---|
| `scope` | `SignalScope` | The `{ runId, scenarioId }` the wait ran in. |
| `subscriberId` | `string \| undefined` | Who was waiting. Unknown at transport level; the `SignalBus` enriches it. |
| `signalName` | `string` | The waited name. |
| `timeoutMs` | `number` | The budget that elapsed. |
| `cursor` | `number` | The `afterSeq` the wait was issued with. |
| `historySnapshot` | `readonly SignalRecord[]` | Everything published in the scope so far. |
| `nearMissNames` | `readonly string[]` | Names within edit distance 2 of `signalName`. |

## Errors

All signaling errors are exported from `@kraken-e2e/signaling`:

| Error | Classification | Raised when |
|---|---|---|
| `SignalTimeoutError` | Test failure | A waited-for signal did not arrive within the budget. |
| `ScopeClosedError` | Test failure | An operation ran against a scope that was never created or already destroyed; pending waiters are rejected with it on scope destruction. |
| `SignalWaitAbortedError` | Cancellation | A pending wait was cancelled through its `AbortSignal` (for example, fail-fast teardown after another step failed). |
| `TransportUnavailableError` | Infrastructure failure — **not** a test failure | The transport is down or unreachable (for example, Redis connection refused). |
| `SignalPayloadError` | Test authoring error | The payload is not JSON-serializable or exceeds `maxPayloadBytes`. |
| `SignalUsageError` | Test authoring error | API misuse — for example, two concurrent identical waits by one subscriber. |

## Observability

Every publish and wait surfaces in the run's event stream: `signalSent`, `signalWaitStarted`, `signalReceived` and `signalTimedOut` events carry the scenario, actor and signal name, so reporters and the live terminal UI can render the choreography as it happens. See [Events](/reference/events).

## Transports

The log is stored by a **transport** implementing the `SignalTransport` SPI — deliberately a "dumb log": acknowledged append with total ordering, blocking reads after a sequence number, full-history snapshots, and scope lifecycle. All intelligence (subscriber cursors, predicates, payload validation, enriched diagnostics) lives above it, in the `SignalBus` facade, so every transport provides identical semantics.

```ts
interface SignalTransport {
  createScope(scope: SignalScope): Promise<void>;
  publish(scope, { name, from, payload }): Promise<SignalRecord>;
  waitFor(scope, query: SignalQuery, opts: TransportWaitOptions): Promise<SignalRecord>;
  history(scope): Promise<readonly SignalRecord[]>;
  destroyScope(scope): Promise<void>;
  ping(): Promise<void>;
}
```

### The in-memory default

`InMemoryTransport` is the reference implementation and what `kraken run` wires: a per-scope append-only log held in a `Map`. It is deliberately "as awkward as a network": resolution is always microtask-deferred (never synchronous), and payloads are JSON round-tripped, so shared-mutable-reference bugs and same-tick timing assumptions fail locally exactly as they would fail against a distributed transport.

### Distributed runs: the Redis transport

`RedisStreamTransport` stores the log in Redis Streams for runs whose actors span processes or machines. It ships as a **subpath export** so that installing Kraken never pulls Redis in:

```ts
import { RedisStreamTransport } from '@kraken-e2e/signaling/redis';
```

The `redis` client (node-redis) is an **optional peer dependency**, `redis@^6.1.0`, loaded dynamically on first use. Projects that use the transport install it explicitly:

```bash
npm install redis@^6.1.0
```

Constructor options (`RedisTransportOptions`):

| Option | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | node-redis default (`redis://localhost:6379`) | `redis://` connection URL. Ignored when `client` is provided. |
| `client` | `RedisClientLike` | — | A pre-built node-redis client (tests, custom TLS/auth configuration). Must **not** be connected yet; the transport connects it. |
| `keyPrefix` | `string` | `'kraken'` | Key namespace. Instances with different prefixes are fully isolated, even on the same Redis server. |
| `pollMs` | `number` | `15` | The `waitFor` poll interval. |

**Mechanics.** Each scope maps to one Redis Stream. Kraken's monotonic `seq` is assigned by an atomic Lua script — `INCR` on a per-scope counter followed by `XADD` with the explicit stream id `${seq}-0` — so stream order *is* seq order and catch-up reads are a single `XRANGE` with an exclusive start. `waitFor` polls at `pollMs` rather than holding per-waiter blocking connections, keeping the dumb-log semantics and letting one client serve any number of waiters; FIFO fairness and cursors remain the `SignalBus`'s job, above the transport.

**Scope lifecycle.** A scope uses three keys under `{keyPrefix}:{runId}/{scenarioId}`: `:stream` (the records), `:seq` (the counter), and `:open` (the liveness flag). `createScope` sets the flag; `publish`, `waitFor` and `history` assert it and reject with `ScopeClosedError` when it is absent. `destroyScope` deletes all three keys and is idempotent; pending waiters observe the missing flag on their next poll and reject with `ScopeClosedError` — no server-side waiter registry exists to clean up.

**Connection lifecycle.** The client connects lazily on first use; a failed connection surfaces as `TransportUnavailableError`. `ping()` is the health probe `kraken doctor` uses. `close()` is transport-level teardown (not per-scope): it closes the underlying client, and a wait still pending across `close()` rejects with `TransportUnavailableError`.

**Wiring.** The bundled `kraken run` command wires the in-memory transport; distributed topologies use the programmatic host API, which accepts any `SignalBus`:

```ts
import { runScenarios } from '@kraken-e2e/core';
import { SignalBus } from '@kraken-e2e/signaling';
import { RedisStreamTransport } from '@kraken-e2e/signaling/redis';

const transport = new RedisStreamTransport({
  url: 'redis://coordination-host:6379',
  keyPrefix: 'ci-1234',
});

const result = await runScenarios({
  plans,
  registry,
  hostContext,
  signalBus: new SignalBus(transport),
});

await transport.close();
```

### Writing a transport: the conformance suite

Every `SignalTransport` — first-party or third-party, in-memory or networked — must pass the transport conformance suite before use. The suite is the executable definition of signal semantics; a transport that passes it is a drop-in replacement.

It ships as the subpath export `@kraken-e2e/signaling/conformance` and registers a `describe` block inside a Vitest suite (`vitest@^4` is an optional peer dependency):

```ts
import { describeSignalTransportContract } from '@kraken-e2e/signaling/conformance';

import { MyTransport } from './my-transport.js';

describeSignalTransportContract('MyTransport', () => new MyTransport(), {
  // Raise the budgets for high-latency (networked) transports:
  generousTimeoutMs: 5_000,
  shortTimeoutMs: 200,
});
```

`ConformanceOptions`:

| Option | Default | Purpose |
|---|---|---|
| `generousTimeoutMs` | `2000` | Baseline budget for tests that must **not** time out. |
| `shortTimeoutMs` | `60` | Budget for tests that **must** time out. |
| `skip` | `false` | Register the whole suite as skipped when external infrastructure is absent (for example, no `redis-server` on the machine). Skipping stays visible in the test summary; silently not registering the suite would hide the gap. |

The factory may be async (`() => Promise<SignalTransport>`). The suite verifies thirteen invariants:

| # | Invariant |
|---|---|
| 1 | Replays a signal published **before** the wait started (replay-first delivery). |
| 2 | Assigns a strictly increasing per-scope total order. |
| 3 | Serves records FIFO as `afterSeq` advances (loop counting). |
| 4 | Broadcasts: independent queries each receive the same record. |
| 5 | Filters by publisher when `from` is given. |
| 6 | Isolates scopes completely. |
| 7 | Never resolves in the same synchronous execution (Zalgo prevention). |
| 8 | Isolates payloads by value (JSON round-trip; post-publish mutation does not propagate). |
| 9 | Rejects with `SignalTimeoutError` once the budget elapses — and not much before. |
| 10 | Cancels a pending wait promptly through its `AbortSignal` (`SignalWaitAbortedError`). |
| 11 | `destroyScope` rejects pending waiters, is idempotent, and closes the scope for publish/wait/history. |
| 12 | `ping` resolves on a healthy transport. |
| 13 | Timeout errors carry the full history snapshot and near-miss suggestions. |

For resilience testing, `ChaosTransport` (exported from the package root) decorates any transport with injected latency (`latencyMs`, fixed or a `[min, max]` range with injectable randomness) and scripted `TransportUnavailableError` failures (`shouldFail(operation, nthCall)`). Kraken's own Redis suite runs the thirteen invariants a second time through a chaos wrapper; third-party transports are encouraged to do the same:

```ts
import { ChaosTransport } from '@kraken-e2e/signaling';

describeSignalTransportContract(
  'ChaosTransport(MyTransport, latency 1-5ms)',
  () => new ChaosTransport(new MyTransport(), { latencyMs: [1, 5] }),
  { generousTimeoutMs: 5_000, shortTimeoutMs: 300 },
);
```

## Using the library directly

`@kraken-e2e/signaling` has no dependency on Gherkin, WebdriverIO or the rest of Kraken. The facade is `SignalBus`; a scope handle (`ScopedSignals`) manages lifecycle and mints per-subscriber handles (`ActorSignals` — the same object steps receive as `ctx.actor.signals`):

```ts
import { InMemoryTransport, SignalBus } from '@kraken-e2e/signaling';

const bus = new SignalBus(new InMemoryTransport(), {
  onWarning: (message) => console.warn(message),
});

const scoped = bus.scope({ runId: 'run-1', scenarioId: 'checkout#1' });
await scoped.open(); // creates the scope on the transport — required before any publish/wait

const alice = scoped.forActor('alice');
const bob = scoped.forActor('bob');

await alice.publish('paid', { orderId: 'o-1' });
const record = await bob.waitFor<{ orderId: string }>('paid', { timeoutMs: 2_000 });

const everything = await scoped.history(); // full in-scope snapshot, in seq order
await scoped.destroy(); // idempotent; rejects pending waiters with ScopeClosedError
```

`bus.ping()` delegates to the transport's health probe.
