# Error codes

Kraken reports failures through stable, machine-readable `KRK-*` codes so the CLI, `kraken doctor`, reporters and external UIs render errors consistently. The stability rule is absolute: **released codes are never renamed or reused**.

## The KrakenError shape

Every error Kraken raises is a `KrakenError` from `@kraken-e2e/contracts`:

```ts
class KrakenError extends Error {
  readonly name: 'KrakenError';
  readonly code: KrakenErrorCode;                              // 'KRK-…'
  readonly fix: string | undefined;                            // actionable remediation
  readonly data: Readonly<Record<string, unknown>> | undefined; // structured context
}

interface SerializedKrakenError {
  readonly code: string;
  readonly message: string;
  readonly fix?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}
```

| Field | Meaning |
| --- | --- |
| `code` | The stable error code — the only field external tooling should match on |
| `message` | Human-readable description with concrete values interpolated |
| `fix` | Present when the failure carries a known remediation; the CLI and reports render it next to the message as `fix: …` |
| `data` | Structured context for tooling — selectors, driver ids, validation issues |

Serialization rules: `serializeError()` converts any thrown value into the event-carriable `SerializedKrakenError`. A `KrakenError` keeps its code, fix and data. A foreign `Error` becomes `KRK-STEP-FAILED` with the message `<Name>: <message>`. A non-error value becomes `KRK-STEP-FAILED` with its string form. `KrakenError.wrap(error, code, message?)` places a foreign error under a specific code while preserving the original as `cause`; a value that is already a `KrakenError` passes through unchanged.

Serialized errors appear in `stepFinished.error` and `scenarioFinished.error` in the [event stream](/reference/events), in the Allure failure details, and in the CLI's failure lines.

### Code space

| Pattern | Minted by |
| --- | --- |
| `KRK-*` (the codes below) | Kraken itself |
| `KRK-HOST-<ID>-UNSUPPORTED` | Composed per driver id for host gates, e.g. `KRK-HOST-IOS-UNSUPPORTED` |
| `KRK-DRV-<ID>-*` | Reserved for third-party drivers' own codes |

A few codes in the taxonomy are **reserved**: they name a failure class whose current code paths report through other means. Reserved codes are part of the stable taxonomy and follow the same never-rename, never-reuse rule; they are marked below.

## Configuration and plugins

### KRK-CONFIG-NOT-FOUND

No `kraken.config.{ts,mts,js,mjs}` was found searching from the working directory upwards.

- **Fix carried:** create one with `defineConfig()` — see [Configuration](/guide/configuration).

### KRK-CONFIG-INVALID

The project configuration or the steps module cannot be used. Raised in five situations:

- The config module fails to load (syntax error, failing import).
- The config fails schema validation. The message lists every offending field. **Fix carried:** fix the listed fields; the `defineConfig()` types describe the expected shape.
- The config declares no actors. **Fix carried:** declare at least one actor, e.g. `actors: { alice: { platform: 'android' } }`.
- The steps module fails to load. **Fix carried:** point `config.steps` at a module that exports your step `registry`.
- The steps module does not export a `registry` created by `createStepRegistry()`. **Fix carried:** `export const { Given, When, Then, registry } = createStepRegistry();` and import your step files from that module.

### KRK-PLUGIN-NOT-FOUND

*Reserved.* A referenced plugin package cannot be resolved. In current code paths an unresolvable driver reference surfaces through the package manager or module loader before this code is minted.

### KRK-PLUGIN-INVALID

A driver package fails validation:

- Its default export is not a factory created with `defineDriver()` from `@kraken-e2e/contracts` (the brand check), or
- its manifest has structural problems. The problems are listed in `data.problems` and joined into the `fix` text.

### KRK-PLUGIN-INCOMPATIBLE

A driver was built against an incompatible driver/reporter contract version. The compatibility rule is: same major, and the plugin's minor must not exceed the host's. The message states both versions; the fix depends on the mismatch:

- Same major, plugin minor newer than core: upgrade `@kraken-e2e/core`.
- Different majors: align the driver and `@kraken-e2e/core` major versions.

## Host and drivers

### KRK-HOST-UNSUPPORTED

*Reserved.* The generic host-gate code. Concrete gates always use the composed per-driver form below.

### KRK-HOST-&lt;ID&gt;-UNSUPPORTED

A driver is disabled on this host (for example, iOS automation on Linux) and an actor was bound to one of its platforms. The code embeds the driver id in upper case — `KRK-HOST-IOS-UNSUPPORTED`. The message combines the driver's platform label with the gate reason; the `fix` comes from the driver manifest's `disabledFix` or the gate's own remediation; `data` carries `{ driverId, platform }`. The same code, reason and fix also appear in the `driverDisabled` event. Kraken fails fast: the error is thrown before any session boots, and drivers whose platforms are not used by the run merely print a warning without failing anything.

### KRK-DRIVER-UNKNOWN-PLATFORM

No registered driver provides the requested platform. The message lists the known platforms, or states that no drivers are registered.

- **Fix carried:** register the driver in `kraken.config.ts` (`drivers: [...]`).

### KRK-DRIVER-START-FAILED

A driver's `start()` failed — the run-level boot of driver infrastructure, before any scenario. The message is `Driver "<id>" failed to start: <detail>`; the Android and iOS drivers report embedded-Appium boot failures under this code.

### KRK-DRIVER-APP-NOT-FOUND

An actor's configured `app` file does not exist on disk. This is a fail-fast, pre-boot check: it fails in milliseconds with the resolved path, instead of minutes later inside an emulator or simulator boot.

- **Fix carried:** check the `app` path in `kraken.config.ts` (relative paths resolve against the project root); the WebdriverIO native-demo-app works out of the box as a test app, and `kraken devices` shows what is already available on the host.

## Sessions

### KRK-SESSION-CREATE-FAILED

An actor's session boot failed and the underlying error was not already a `KrakenError` (a boot failure that is one — such as `KRK-DRIVER-APP-NOT-FOUND` — keeps its original code). Session boots use all-settled semantics: when any actor's boot fails, the sessions that did boot are rolled back before the scenario is reported failed.

### KRK-SESSION-OP-UNSUPPORTED

A session operation is not supported by the driver in use. Raised for an unknown semantic key on a platform (`pressKey` accepts `enter | escape | tab`), for the `native()` escape hatch where a driver does not expose it, and by any driver that declares an operation unsupported. This code feeds the cross-platform parity report: the conformance kit records which operations each driver rejects with it.

### KRK-SESSION-ELEMENT-NOT-FOUND

A locator resolved no element. The message names the actor, platform, strategy and value; `data` carries the platform-native selector actually used and the original target. When the strategy was `testId`, the fix is platform-specific:

- Android: check the resource-id in the app (Appium Inspector helps), or use `{ by: 'native' }` with a raw selector.
- iOS: check the accessibility identifier in the app, or use `{ by: 'native' }` with a class chain or predicate.
- Web: check the `data-testid` attribute in the page, or use `{ by: 'native' }` with a raw CSS/XPath selector.

### KRK-SESSION-WAIT-TIMEOUT

A `session.waitFor(target, state)` did not reach the requested state (`visible`, `hidden` or `attached`) within its budget. The message names the actor, platform, target, state and timeout; `data` carries the native selector, and the underlying WebDriver error is preserved as `cause`.

## Signals

### KRK-SIGNAL-TIMEOUT

A waited-for signal never arrived within its budget — a test failure, not an infrastructure failure. *Reserved in the current release:* the signaling engine raises `SignalTimeoutError` (a rich diagnostic carrying the scope's full history snapshot and near-miss signal names for typo diagnosis), which the event stream serializes under the step's failure code. In `events.jsonl` a signal timeout is therefore recognizable by the `signalTimedOut` event and by a `stepFinished` error whose message begins with `SignalTimeoutError:`. The timeout message itself lists every signal published in the scope so far and suggests close names when the cause looks like a typo. See [Signals](/guide/signals).

## Steps and plan

### KRK-STEP-UNMATCHED

A feature step has no matching definition. Also raised at registration time when `Given`/`When`/`Then` is called without a handler. During compilation the same condition is reported as the `STEP_UNMATCHED` diagnostic, with the closest registered expression suggested — see [compile-time diagnostics](#compile-time-diagnostics).

### KRK-STEP-AMBIGUOUS

A step's text matches more than one definition. The message lists every matching expression.

- **Fix carried:** make the step expressions mutually exclusive.

### KRK-STEP-UNKNOWN-ACTOR

An actor reference cannot be resolved. Raised in three situations:

- A step expression is registered without an `{actor}` parameter — every Kraken step is addressed to exactly one actor. **Fix carried:** start the expression with `{actor} …`.
- A programmatic scenario addresses an undeclared actor. **Fix carried:** declare the actor, or fix the actor name in the step.
- A plan node references an actor for which no session was booted.

### KRK-STEP-FAILED

The general step-failure code: a step handler threw, a joined background task failed, or any non-`KrakenError` was serialized into the event stream (see [the shape](#the-krakenerror-shape)). Assertion failures from user step code surface under this code.

### KRK-PLAN-DEADLOCK

*Reserved.* A wait that can never be satisfied under the screenplay's total order. This condition is detected statically, before any session boots: the dry-run analyzer rejects compilation with the `DEADLOCK` diagnostic when a step waits for a signal that no earlier step or background task declares publishing (via the `publishes:` step option).

### KRK-PLAN-UNJOINED-TASK

Background-task hygiene failed at scenario end. Two variants:

- The scenario ended with detached tasks that were never joined. **Fix carried:** join every detached task with a `…background task {handle} completes within…` step.
- Detached tasks did not settle within the drain budget after the scenario ended, which means they ignored the abort. **Fix carried:** detached task bodies must honor `ctx.abort` (an `AbortSignal`).

### KRK-PLAN-UNKNOWN-TASK

A background-task reference cannot be resolved: a join names a task that was never started (**fix carried:** start it with a detached step before joining it), a detach or join node has no task handle, or a join node has no timeout — Kraken has an explicit-duration policy with no silent defaults.

### KRK-PLAN-DUPLICATE-TASK

A detached step reuses a task handle that is already running in the scenario. The check runs before the task body is invoked, so a rejected registration never leaves an untracked task running.

- **Fix carried:** use a distinct handle per detached task within a scenario.

### KRK-PLAN-TASK-JOIN-TIMEOUT

A joined background task did not complete within the join step's budget. The message names the task handle and the step that started it.

## Run

### KRK-RUN-ABORTED

Run-level abort. Also used by core's internal event-validation guard: every event is schema-validated at emission, and a malformed emission — a core bug, not a user error — is raised under this code with the validation issues in `data.issues`.

## Compile-time diagnostics

Before any session boots, `kraken run` compiles every feature and refuses to start on errors (`--dry-run` stops after this pass). Compilation problems are reported as diagnostics rather than thrown errors, printed as `✗ [<CODE>] <file> › <scenario>: <message>`:

| Diagnostic code | Meaning |
| --- | --- |
| `PARSE_ERROR` | The feature file is not valid Gherkin |
| `STEP_UNMATCHED` | No step definition matches; the closest registered expression is suggested |
| `STEP_AMBIGUOUS` | The step text matches more than one definition |
| `UNKNOWN_ACTOR` | The step addresses an undeclared actor; a close declared name is suggested |
| `DEADLOCK` | A signal wait that no earlier step declares satisfying — guaranteed to hang, rejected statically |
| `UNJOINED_TASK` | A detached background task is never joined |
| `UNKNOWN_TASK` | A join without a matching detach, a detach without a usable handle, or a reused handle |

These diagnostics correspond to the `KRK-STEP-*` and `KRK-PLAN-*` runtime codes above but are a separate, compile-scoped enumeration.
