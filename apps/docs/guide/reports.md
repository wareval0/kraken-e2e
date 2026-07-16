# Reports

Every output a Kraken run produces — the live terminal view, the JSONL log, the Allure results, the CTRF report, the [`kraken serve`](/guide/serve) API — is a projection of one totally ordered stream of typed events. This page describes the projection model and every artifact written to the run directory. The event types themselves are specified in the [events reference](/reference/events).

## Reporters are projections

A reporter is a single-method subscriber of the serialized event stream:

```ts
interface Reporter {
  readonly id: string;
  onEvent(event: KrakenEvent): void | Promise<void>;
  /** Awaited at run end — drain buffers, close files. */
  flush?(): Promise<void>;
}
```

During a run, the event bus stamps each event's envelope (`ts`, `runId`, `seq`) and fans it out to every subscribed reporter. Two properties of this fan-out matter in practice:

- **Per-reporter ordering without blocking.** Each reporter consumes events through its own promise chain, so a slow reporter never delays the run loop or the other reporters, and every reporter still observes events in `seq` order.
- **Containment.** A reporter that throws or rejects is reported once — `kraken run` prints `! reporter "<id>" failed: <message>` for the reporter's first failure — and the stream keeps flowing to the remaining reporters. A broken reporter can never fail a run: run status is derived exclusively from scenario outcomes.

At run end the bus awaits every reporter's pending chain and its optional `flush()`. Flush errors are contained under the same rule.

`kraken run` always attaches four reporters: the live terminal renderer (lanes or plain lines), the JSONL log, the Allure projection and the CTRF projection. The last three are unconditional — there is no flag to enable, disable or select report formats.

## The run directory

Each run writes its artifacts under `.kraken/runs/<runId>/` in the project root, where `runId` is a UUID generated for the run (the same value stamped into every event's envelope):

```
.kraken/runs/<runId>/
├── events.jsonl                        # the event stream — the substrate
├── allure-results/                     # Allure 3 result files, one set per scenario
├── ctrf-report.json                    # CTRF report, written at run end
├── appium-android.log                  # embedded Appium server log (Android driver)
├── appium-ios.log                      # embedded Appium server log (iOS driver)
├── <actorId>/                          # per-actor screenshots
│   └── <platform>-<tag>-<n>.png
└── <scenarioId>-<actorId>-source.txt   # UI source dumps captured on failure
```

Driver logs appear only for the drivers involved in the run. Screenshots are named `<platform>-<tag>-<n>.png`, where the tag distinguishes the sessions a run creates (each actor gets a fresh session per scenario) and `n` numbers the screenshots within a session. When a scenario fails, Kraken captures a screenshot and a UI source dump from **every** actor, best-effort — a capture that itself fails never masks the original error. Each capture is announced by an `artifactCaptured` event carrying the file path.

At the end of every run the CLI prints the paths to `events.jsonl`, `allure-results` and `ctrf-report.json`.

## events.jsonl

The raw event log: one serialized `KrakenEvent` per line. Writes are chained, so line order always matches `seq` order. The first line is `runStarted` (carrying the `protocol: 1` marker); a completed run's last line is `runFinished`; an in-flight or interrupted run's file simply ends at whatever has happened so far. Every other report on this page can be reconstructed from this file alone.

The format is directly inspectable with `jq`:

```bash
# Step outcomes with durations
jq -r 'select(.type == "stepFinished") | "\(.seq)\t[\(.actorId)]\t\(.status)\t\(.text)"' events.jsonl

# The full signal choreography of a run
jq -c 'select(.type | startswith("signal"))' events.jsonl

# Every captured artifact, with its path
jq -r 'select(.type == "artifactCaptured") | "\(.kind)\t\(.path)"' events.jsonl

# The run verdict
jq 'select(.type == "runFinished")' events.jsonl
```

Consumers must ignore unknown event types and unknown fields — the stream evolves additively (see the [evolution rules](/reference/events#evolution-rules)).

## Allure results

`allure-results/` is an Allure 3 result set, produced through the documented custom-integration path of `allure-js-commons`. Generate the HTML report with Allure 3's npm CLI:

```bash
npx allure generate .kraken/runs/<runId>/allure-results -o allure-report
```

::: tip
Allure 3's npm CLI is pure Node — no Java runtime is required, unlike Allure 2.
:::

How the multi-actor run maps onto the report:

| Kraken concept | Allure rendering |
| --- | --- |
| Scenario | One test; `fullName` is `<scenarioId>: <name>`, labeled `framework: kraken` |
| Actor cast | Test parameters — one per actor, named `actor:<id>` with value `<platform> (<driverId>)` |
| Step | One top-level step named `[<actorId>] <text>`, with a step parameter `actor` = the actor id |
| Signal wait | Its own first-class step (see below) |
| Screenshot / source dump | Attachments on the test (`image/png` / `text/plain`) |

The `[actor]` prefix keeps steps readable in the timeline, and the machine-readable `actor` parameter renders as a chip in the Allure UI. A failed step's status details carry the error message; when the error has a remediation, it appears as trace text prefixed `fix:`.

Signal waits are rendered as their own steps so the choreography handoffs stay visible in the report:

- `signalWaitStarted` opens a step named `[<actorId>] ⏳ waits for signal "<name>" (≤<timeout>ms)`.
- On `signalReceived` the step passes and is renamed `[<by>] ⚡ received "<name>" from <from> after <latency>ms`.
- On `signalTimedOut` the step fails with the message `signal "<name>" never arrived within <timeout>ms`.

All step and test timestamps are propagated from event `ts` values, never taken from the reporter's own clock. Each test file is written the moment its scenario finishes, so a crashed run keeps the results of every scenario that completed.

## ctrf-report.json

A [CTRF](https://ctrf.io) (Common Test Report Format) report, hand-emitted with zero runtime dependencies. `reportFormat` is `CTRF`, `specVersion` is pinned to `0.0.0` — the value the reference implementation emits while the spec remains a pre-1.0 working draft — and the tool name is `kraken`:

```json
{
  "reportFormat": "CTRF",
  "specVersion": "0.0.0",
  "results": {
    "tool": { "name": "kraken" },
    "summary": {
      "tests": 2, "passed": 1, "failed": 1, "skipped": 0,
      "pending": 0, "other": 0,
      "start": 1751980000000, "stop": 1751980065000
    },
    "tests": [
      {
        "name": "a message composed on Android arrives on iOS",
        "status": "failed",
        "duration": 32000,
        "start": 1751980001000,
        "stop": 1751980033000,
        "extra": { "actors": ["alice:android", "bob:ios"] },
        "message": "bob: bob waits for the signal \"message-sent\" within 5s"
      }
    ]
  }
}
```

- **One CTRF test per scenario.** CTRF has no step model; step-level detail lives in the event log and the Allure report.
- **`status`** is `passed`, `failed` or `skipped`; `duration`, `start` and `stop` come from the scenario's events. `pending` and `other` exist in the summary for CTRF completeness and are `0` in complete runs.
- **`extra.actors`** lists the scenario's cast as `<actorId>:<platform>` strings. Everything Kraken-specific rides in `extra`, because the CTRF schema is closed (`additionalProperties: false`) everywhere else.
- **`message`**, present on failures, lists the failed steps as `<actorId>: <step text>` lines.
- The file is written once, at `runFinished`.

The report validates against the official CTRF JSON Schema and is consumable by the ctrf-io tooling ecosystem — GitHub Actions summaries, chat reporters, merge and comparison CLIs.

## The live terminal renderers

Two mutually exclusive renderers cover interactive terminals and CI logs.

### Lane renderer (interactive terminals)

On a TTY, `kraken run` renders a live view with **one lane per actor**. Each lane shows the actor's state icon, id, platform and a detail line — the step currently executing, the session boot state, or the signal the actor is blocked on:

```
✓ [alice] alice opens the conversation (1204ms)

Scenario: a message composed on Android arrives on iOS
  ▶ alice [android] alice taps send
  ⏳ bob [ios] ⏳ waiting for signal "message-sent" (≤5000ms)
```

| Lane state | Icon | Meaning |
| --- | --- | --- |
| `starting` | `◌` | Session booting |
| `ready` | `●` | Session up, actor idle |
| `acting` | `▶` | Executing a step; the detail line shows the step text |
| `waiting-signal` | `⏳` | Parked in a signal wait; the detail line shows the signal name and budget |
| `done` | `✓` | Scenario over, session closing |
| `failed` | `✗` | A step failed or a signal timed out |

When a signal is received, the receiving lane briefly shows `⚡ "<name>" from <sender> after <latency>ms` before returning to `acting`. Completed steps flow into an append-only scrollback above the lanes, and a bold run summary line closes the view. The renderer is a pure reduction of the event stream — it displays nothing that cannot be reconstructed from `events.jsonl`. Stray `console.*` output is patched into the frame rather than corrupting it, and Ctrl-C is handled by the CLI rather than the UI so multi-device teardown always runs.

### Plain line renderer

Everywhere else — pipes, CI, or when forced with `--plain` — Kraken streams actor-prefixed lines. This is deliberately a streaming renderer, not a buffered final frame: a long multi-device run must show progress as it happens.

```
Kraken run started (1 scenario)

Scenario: a message composed on Android arrives on iOS  [alice/android, bob/ios]
  ✓ [alice] alice taps send (843ms)
    [bob] ⏳ waiting for signal "message-sent" (≤5000ms)
    [bob] ⚡ received "message-sent" from alice after 112ms
  ✓ [bob] bob waits for the signal "message-sent" within 5s (118ms)
    ↳ screenshot [alice]: .kraken/runs/<runId>/alice/android-1f3a9c2e-1.png
  ✓ scenario passed in 9214ms

Run passed in 9214ms
```

A failed step appends `<code>: <message>` on the following line; a failed scenario's summary repeats the error and its `fix` when one exists; a driver disabled on the host prints `! driver "<id>" disabled: <reason>` with its fix. Quieter events — `stepStarted`, session lifecycle, driver logs — stay off the line view; they remain available in `events.jsonl`.

### Renderer selection

The lane renderer is selected when stdout is a TTY and the `CI` environment variable is not set; otherwise the line renderer is used. `kraken run --plain` forces the line renderer unconditionally:

```
lanes = TTY && !CI && not --plain
lines = everything else
```

## Custom reporters

The shipped reporters live in `@kraken-e2e/reporters` and depend only on `@kraken-e2e/contracts` — never on the engine. Programmatic runs through `runScenarios()` from `@kraken-e2e/core` accept any array of reporters; the `defineReporter()` helper from `@kraken-e2e/contracts` provides typing:

```ts
import { defineReporter } from '@kraken-e2e/contracts';

export const durations = defineReporter({
  id: 'durations',
  onEvent(event) {
    if (event.type === 'stepFinished') {
      console.error(`${event.durationMs}ms\t[${event.actorId}] ${event.text}`);
    }
  },
});
```

To consume a run without writing a reporter — including from another process or another language — read `events.jsonl` directly or use the HTTP/WebSocket API of [`kraken serve`](/guide/serve).
