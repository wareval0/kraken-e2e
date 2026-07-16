# Events

A Kraken run emits a totally ordered stream of typed events — the substrate every other output projects from: the live terminal UI, `events.jsonl`, the Allure and CTRF reports, and the [`kraken serve`](/guide/serve) API. This page specifies the envelope, every event type and its payload, and the rules under which the stream evolves. The types live in `@kraken-e2e/contracts`.

## The envelope

Every event carries the same envelope plus a `type` discriminant:

```ts
interface KrakenEventBase {
  readonly ts: number;    // epoch milliseconds at emission
  readonly runId: string; // the run's UUID
  readonly seq: number;   // monotonic per run, starting at 1
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `ts` | `number` | Wall-clock timestamp (epoch ms) stamped at emission |
| `runId` | `string` | The run identifier; also the run's directory name under `.kraken/runs/` |
| `seq` | `number` | Monotonic sequence number per run — a **total order** any consumer can rely on without trusting clocks |

The event bus stamps the envelope; producers supply only the payload (`KrakenEventInput` is a `KrakenEvent` minus the envelope fields). Core validates every event against schemas at emission — a malformed emission is an internal error — and exports the stream's JSON Schema for external consumers via `krakenEventJsonSchema()` from `@kraken-e2e/core`. In `events.jsonl`, line order matches `seq` order.

### Shared payload types

```ts
type StepStatus = 'passed' | 'failed' | 'skipped';
type RunStatus = 'passed' | 'failed';

interface ActorSummary {
  readonly id: string;
  readonly platform: string;
  readonly driverId: string;
}

interface SerializedKrakenError {
  readonly code: string;
  readonly message: string;
  readonly fix?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}
```

`SerializedKrakenError` is specified in the [error-codes reference](/reference/error-codes).

## Event catalog

Sixteen event types, in six families:

| Family | Types |
| --- | --- |
| Run | `runStarted`, `runFinished` |
| Scenario | `scenarioStarted`, `scenarioFinished` |
| Step | `stepStarted`, `stepFinished` |
| Actor / driver | `actorSessionStarted`, `actorSessionFinished`, `driverRegistered`, `driverDisabled`, `driverLog` |
| Signal | `signalSent`, `signalWaitStarted`, `signalReceived`, `signalTimedOut` |
| Artifact | `artifactCaptured` |

## Run events

### runStarted

Emitted once, before any driver starts or scenario runs.

| Field | Type | Meaning |
| --- | --- | --- |
| `protocol` | `1` (literal) | The stream protocol marker — see [evolution rules](#evolution-rules) |
| `scenarioCount` | `number` | Number of scenario plans the run will execute |

### runFinished

Emitted once, after every scenario has finished and the drivers have been stopped. It is always emitted, including on failure paths, and is the last event of a completed run.

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `RunStatus` | `passed` only when every planned scenario executed and passed; otherwise `failed` |
| `durationMs` | `number` | Wall-clock duration of the run |

## Scenario events

Scenario ids produced by the Gherkin compiler have the shape `<featureUri>#<n>` (the n-th scenario in the file, expanded examples included); programmatically built scenarios use generated ids. Consumers should treat `scenarioId` as an opaque key that is unique within the run.

### scenarioStarted

Emitted after every actor of the scenario has been bound to a driver, before sessions boot.

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Run-unique scenario key |
| `name` | `string` | The scenario's human-readable name |
| `featureUri` | `string` (optional) | Path of the feature file, when the scenario came from Gherkin |
| `actors` | `readonly ActorSummary[]` | The scenario's cast: actor id, platform, and the driver serving it |

### scenarioFinished

Emitted when the scenario settles, before session teardown completes.

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `status` | `StepStatus` | The scenario outcome (the runner emits `passed` or `failed`) |
| `durationMs` | `number` | Wall-clock duration including session boot |
| `error` | `SerializedKrakenError` (optional) | Present on failure — the serialized cause |

## Step events

Step ids from the compiler have the shape `<featureUri>#<n>-step-<m>` and are unique within the run. Every plan node — regular steps, detached-task starts and joins — produces this pair of events.

### stepStarted

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `stepId` | `string` | Run-unique step key |
| `actorId` | `string` | The actor the step is addressed to |
| `text` | `string` | The step's text (Gherkin text or programmatic title) |

### stepFinished

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `stepId` | `string` | Step key |
| `actorId` | `string` | The addressed actor |
| `text` | `string` | The step's text |
| `status` | `StepStatus` | `passed`, `failed` or `skipped` |
| `durationMs` | `number` | Step duration; `0` for skipped steps |
| `error` | `SerializedKrakenError` (optional) | Present when the step failed |

After the first failure in a scenario, the remaining steps are still reported — each as a `stepStarted` immediately followed by a `stepFinished` with `status: 'skipped'` and `durationMs: 0` — so the timeline stays complete for every consumer.

## Actor and driver events

### actorSessionStarted

Emitted per actor once its device or browser session has booted.

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `actorId` | `string` | The actor |
| `driverId` | `string` | The driver serving the session |
| `platformLabel` | `string` | The driver's human-readable platform label |

### actorSessionFinished

Emitted per actor when its session is disposed during scenario teardown.

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `actorId` | `string` | The actor |
| `status` | `'ok' \| 'failed'` | `failed` when disposal errored or exceeded the 15-second teardown guard |

### driverRegistered

Announces a validated, host-compatible driver. Emitted during driver-registry construction when the registry is created with an event sink.

| Field | Type | Meaning |
| --- | --- | --- |
| `driverId` | `string` | The driver's manifest id |
| `version` | `string` | The driver package version |
| `platforms` | `readonly string[]` | The platforms the driver provides |

### driverDisabled

Announces a driver that is present but unusable on this host (for example, the iOS driver on Linux). Emitted under the same condition as `driverRegistered`.

| Field | Type | Meaning |
| --- | --- | --- |
| `driverId` | `string` | The driver's manifest id |
| `code` | `string` | The composed host-gate error code, e.g. `KRK-HOST-IOS-UNSUPPORTED` |
| `reason` | `string` | Why the driver is disabled here |
| `fix` | `string` | Remediation text |

### driverLog

Diagnostic log lines forwarded from drivers into the stream.

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | `string` | The emitting component, e.g. `driver:android` or `driver:android/alice` |
| `level` | `'debug' \| 'info' \| 'warn' \| 'error'` | Log level |
| `message` | `string` | The log line |

## Signal events

Every `publish` and `waitFor` performed through an actor's signal handle surfaces in the stream — the observable choreography described in [Signals](/guide/signals).

### signalSent

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `signal` | `string` | The signal name |
| `from` | `string` | The publishing actor |
| `recordSeq` | `number` | The record's sequence number in the scenario's signal log (distinct from the envelope `seq`) |

### signalWaitStarted

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `signal` | `string` | The awaited signal name |
| `actorId` | `string` | The waiting actor |
| `timeoutMs` | `number` | The wait's explicit budget |

### signalReceived

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `signal` | `string` | The signal name |
| `by` | `string` | The actor whose wait was satisfied |
| `from` | `string` | The actor that published the consumed record |
| `latencyMs` | `number` | Milliseconds between the start of the wait and delivery |

### signalTimedOut

| Field | Type | Meaning |
| --- | --- | --- |
| `scenarioId` | `string` | Scenario key |
| `signal` | `string` | The signal that never arrived |
| `actorId` | `string` | The actor whose wait expired |
| `timeoutMs` | `number` | The exhausted budget |

A `signalWaitStarted` is always terminated by exactly one of `signalReceived` or `signalTimedOut` (or by scenario abort). This pairing is what the terminal lanes and the Allure signal steps render.

## Artifact events

### artifactCaptured

Announces a file written into the run directory: the runner's all-actor failure captures (screenshot plus UI source from every actor) and any artifact a driver emits on its own.

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `'screenshot' \| 'log' \| 'video' \| 'source'` | Artifact class |
| `path` | `string` | Absolute path of the file on the machine that ran the tests |
| `scenarioId` | `string` (optional) | Present on the runner's failure captures |
| `actorId` | `string` (optional) | Present when the artifact belongs to one actor |

To serve an artifact over HTTP, map `path` relative to the run directory onto `/api/runs/:id/artifacts/<path>` — see [Serving results](/guide/serve).

## Evolution rules

The stream follows the additive-evolution model of `cucumber-messages`:

- **Additive only.** A change may add a new event type or a new *optional* field on an existing type. A semantic change to an existing event ships as a **new** event type instead.
- **Consumers must ignore unknown types and unknown fields.** This is what keeps yesterday's consumer working against today's stream.
- **Versioning discipline.** Additive changes bump the contract **minor** version; renaming or removing an event type or field is a breaking change and requires a contract **major** bump. The contract version lives in `@kraken-e2e/contracts` (`CONTRACT_VERSION`) and is the same version checked when drivers load.
- **The protocol marker.** `runStarted` carries the literal `protocol: 1` — a single assertion point for consumers that want to verify they are reading a stream shape they understand.

## Consuming the stream

Three transport-symmetric ways to read the same events:

- **`events.jsonl`** in the run directory — one event per line, line order = `seq` order. See [Reports](/guide/reports).
- **`kraken serve`** — `GET /api/runs/:id/events` for a snapshot, `WS /api/runs/:id/live` for replay-then-tail. See [Serving results](/guide/serve).
- **In-process reporters** — subscribe a `Reporter` when running programmatically. See [Reports](/guide/reports#custom-reporters).
