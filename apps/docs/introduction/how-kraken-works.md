# How Kraken works

This page describes the model behind Kraken. Every other page in this documentation builds on the five concepts introduced here.

## Actors: a closed cast

A scenario's participants are declared once, in `kraken.config.ts`, as a named map of **actors**:

```typescript
actors: {
  alice: { platform: 'android', avd: 'Pixel_9_API_35', app: './apps/app.apk' },
  bob:   { platform: 'ios', deviceName: 'iPhone 16', platformVersion: '18.6', app: './apps/App.app' },
  carol: { platform: 'web', browser: 'chrome' },
}
```

The cast is *closed*: a feature step that names an undeclared actor is rejected at compilation time, before any session boots. Each actor receives its own fully independent device session — Kraken never multiplexes actors over a shared session.

## The screenplay: steps run in written order

Kraken uses Gherkin, but its execution model is deliberately simple: steps run **in the order they appear in the feature file**, one at a time, regardless of which actor each step is addressed to. A multi-device story is easiest to reason about when it reads — and executes — like a script.

Concurrency is introduced only through two explicit escape hatches:

- **Background tasks** — a step marked `detached` starts work that runs alongside the rest of the screenplay and is joined later by an explicit step.
- **Signals** — the synchronization primitive described next.

## Signals: deterministic cross-device coordination

Actors coordinate through an **append-only signal log**, scoped to the scenario. Two operations exist:

- `publish(name, payload?)` appends a named record, optionally carrying JSON-serializable data.
- `waitFor(name, { timeoutMs })` resolves with the earliest matching record the caller has not yet consumed.

Three properties make this primitive dependable:

1. **Replay-first delivery.** `waitFor` inspects the log's history before parking for live records. A signal published *before* the wait began is therefore never lost — the publish/wait order is irrelevant to correctness.
2. **Per-subscriber FIFO.** Each waiting actor consumes matching records through its own cursor, in publication order, exactly once.
3. **Static analysis.** Steps declare the signals they publish. Before a run starts, Kraken analyzes the scenario for waits that no step can ever satisfy and rejects the compilation, suggesting the closest published name when the cause is a typo.

The default log is in-memory. For runs distributed across processes or machines, a Redis Streams transport provides identical semantics — it passes the same conformance suite, including its chaos cases.

## One session contract, portable locators

Every actor exposes the same session interface: `tap`, `typeText`, `readText`, `waitFor`, `isDisplayed`, `scrollIntoView`, `pressKey`, `navigate`, `screenshot`, `source` and `dispose`. Elements are addressed with **portable locator strategies**:

| Strategy | Android | iOS | Web |
|---|---|---|---|
| `testId` | resource-id | accessibility id | `[data-testid]` |
| `a11y` | content-desc | accessibility id | `[aria-label]` |
| `text` | UiSelector text match | predicate on label/value | text selector |
| `native` | raw selector (escape hatch) | raw selector (escape hatch) | raw CSS/XPath |

`pressKey` accepts the cross-platform semantic key set `enter | escape | tab`, mapped to genuine system key events on every platform. Android's hardware *back* is intentionally absent from the portable set — it has no faithful equivalent on iOS or the web — and remains reachable through the `native` escape hatch.

A step written against portable strategies runs unchanged on all three platforms. Platform parity is not an aspiration: a conformance kit exercises the full session surface against a fixture application on real devices, and the resulting parity reports are checked mechanically.

## Drivers: a hexagonal core

Kraken's engine never imports Appium, WebdriverIO, ADB or a browser. Platform knowledge lives in **driver packages** installed per project and pinned in the project lockfile:

| Driver | Stack | Host support |
|---|---|---|
| `@kraken-e2e/driver-android` | Appium 3 + UiAutomator2, embedded server | macOS, Linux, Windows |
| `@kraken-e2e/driver-ios` | Appium 3 + XCUITest, embedded server | macOS only (platform restriction) |
| `@kraken-e2e/driver-web` | WebdriverIO native, no Appium | macOS, Linux, Windows |

Each driver ships a manifest that Kraken reads *before* importing the driver's implementation. On a host that cannot run a driver — iOS automation on Linux, for instance — the driver disables itself with an explicit message, and the rest of the suite remains usable.

## Everything is an event

A run emits a totally ordered stream of typed events — scenario and step lifecycle, actor sessions, every signal publication and delivery, captured artifacts. The stream is persisted as a JSONL log, and every other output is a pure projection of it: the live terminal UI, the Allure results, the CTRF report, and the `kraken serve` HTTP/WebSocket endpoint that exposes runs to external consumers. Nothing renders state that cannot be reconstructed from the log.
