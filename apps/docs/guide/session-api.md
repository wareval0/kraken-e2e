# The session API

Every actor exposes the same session surface, `UserSession`, regardless of platform. It is a deliberately small, locator-driven, stateless set of operations that every platform can offer faithfully, plus a typed native escape hatch. The surface is defined in `@kraken-e2e/contracts` and grows only through the parity gate: an RFC, a conformance-kit case, and passing implementations on **both** Android and iOS.

Inside a step definition the session is `ctx.actor.session` (see [Writing steps](/guide/writing-steps)):

```ts
When('{actor} writes {string}', async ({ actor }, ...args) => {
  const [message] = args as unknown as [string];
  await actor.session.typeText({ by: 'testId', value: 'composer' }, message);
});
```

## The contract

```ts
interface UserSession {
  readonly actorId: string;
  readonly driverId: string;
  readonly platform: string;
  readonly capabilities: Readonly<Record<CoreOperation, 'supported' | 'unsupported'>>;

  tap(target: TargetLocator): Promise<void>;
  typeText(target: TargetLocator, text: string): Promise<void>;
  readText(target: TargetLocator): Promise<string>;
  waitFor(target: TargetLocator, state: WaitState, opts?: SessionWaitOptions): Promise<void>;
  isDisplayed(target: TargetLocator): Promise<boolean>;
  scrollIntoView(target: TargetLocator): Promise<void>;
  pressKey(key: SemanticKey): Promise<void>;
  navigate(destination: string): Promise<void>;
  screenshot(): Promise<ArtifactRef>;
  source(): Promise<string>;
  dispose(): Promise<void>;

  native<K extends keyof KrakenNativeSessions>(kind: K): KrakenNativeSessions[K];
}
```

The eleven **core operations** — the set the parity report is generated over — are:

```ts
const CORE_OPERATIONS = [
  'tap', 'typeText', 'readText', 'waitFor', 'isDisplayed', 'scrollIntoView',
  'pressKey', 'navigate', 'screenshot', 'source', 'dispose',
] as const;
```

### Identity and capabilities

| Field | Meaning |
|---|---|
| `actorId` | The actor this session belongs to (`alice`). |
| `driverId` | The driver that created it: `android`, `ios` or `web`. |
| `platform` | The actor's configured platform string. |
| `capabilities` | A record mapping every core operation to `'supported'` or `'unsupported'`. Feeds the parity report. Calling an unsupported operation throws `KRK-SESSION-OP-UNSUPPORTED`. |

All three first-party drivers mark all eleven core operations as `'supported'`; parity is proven by the conformance kit on real devices, not merely claimed.

## Locators

Element-addressing operations take a `TargetLocator` — a portable strategy plus a value:

```ts
type TargetLocator =
  | { by: 'testId'; value: string }
  | { by: 'text';   value: string; exact?: boolean }
  | { by: 'a11y';   value: string }
  | { by: 'native'; value: string };
```

- `testId` — the stable test identifier: Android resource-id, iOS accessibility identifier, web `data-testid`. The preferred strategy.
- `text` — visible text. `exact: true` requires equality; the default is a *contains* match.
- `a11y` — the accessibility label: Android content-description, iOS accessibility identifier, web `aria-label`.
- `native` — an explicitly non-portable raw selector, passed through to the underlying stack unchanged. Exempt from the conformance kit; a scenario using it is tied to one platform.

### Per-platform resolution

Each driver translates the portable strategy into its stack's native selector. The exact mappings:

| Strategy | Android (UiAutomator2) | iOS (XCUITest) | Web (WebdriverIO) |
|---|---|---|---|
| `testId` (unqualified value) | `android=new UiSelector().resourceIdMatches(".*:id/<value>")` — regex against the `<package>:id/<value>` convention, so feature files stay package-agnostic | `~<value>` (accessibility identifier) | `[data-testid="<value>"]` |
| `testId` (value contains `:id/`) | `android=new UiSelector().resourceId("<value>")` — matched literally | `~<value>` | `[data-testid="<value>"]` |
| `text`, `exact: true` | `android=new UiSelector().text("<value>")` | `-ios predicate string:label == "<value>" OR value == "<value>"` | `=<value>` (WDIO exact-text selector) |
| `text` (default, contains) | `android=new UiSelector().textContains("<value>")` | `-ios predicate string:label CONTAINS "<value>" OR value CONTAINS "<value>"` | `*=<value>` (WDIO contains-text selector, any element) |
| `a11y` | `~<value>` (content-description) | `~<value>` (accessibility identifier) | `[aria-label="<value>"]` |
| `native` | raw selector, unchanged (any WebdriverIO/Appium selector) | raw selector, unchanged (class chain, predicate, XPath) | raw selector, unchanged (CSS, XPath, WDIO selector) |

Values are escaped per stack: backslashes and double quotes are escaped inside UiSelector strings, iOS predicates, and CSS attribute values.

On iOS, `testId` and `a11y` intentionally resolve to the same concept — XCUITest exposes a single accessibility identifier.

When an element cannot be resolved, element-addressing operations throw `KRK-SESSION-ELEMENT-NOT-FOUND`, carrying the resolved native selector in its data and, for `testId`, a driver-specific fix hint (check the resource-id / accessibility identifier / `data-testid`, or fall back to `{ by: 'native' }`). The exception is `isDisplayed`, which reports absence as `false` instead of throwing.

## Operations

### tap

```ts
tap(target: TargetLocator): Promise<void>
```

Resolves the element and clicks/taps it once.

### typeText

```ts
typeText(target: TargetLocator, text: string): Promise<void>
```

Resolves the element and sets its value to `text` (WebdriverIO `setValue` on all platforms).

### readText

```ts
readText(target: TargetLocator): Promise<string>
```

Returns the element's text. On Android and iOS this is the element's text/label. On web, form controls (`input`, `textarea`, `select`) carry their content in the `value` property rather than in text nodes — when the element's text is empty, the web driver falls back to reading its value, so `readText` works uniformly on both static text and inputs.

### waitFor

```ts
waitFor(target: TargetLocator, state: WaitState, opts?: SessionWaitOptions): Promise<void>
```

Polls until the element reaches the requested state or the budget elapses.

```ts
type WaitState = 'visible' | 'hidden' | 'attached';

interface SessionWaitOptions {
  timeoutMs?: number; // default 10 000
  pollMs?: number;    // default 100
}
```

| State | Meaning |
|---|---|
| `visible` | The element is present and displayed. |
| `hidden` | The element is not displayed (the inverse wait). |
| `attached` | The element exists in the DOM / view hierarchy, displayed or not. |

On timeout the operation throws `KRK-SESSION-WAIT-TIMEOUT`, naming the actor, the locator, the state and the budget, with the resolved native selector attached as data.

### isDisplayed

```ts
isDisplayed(target: TargetLocator): Promise<boolean>
```

A point-in-time check: `true` if the element exists and is displayed, `false` otherwise — including when the element does not exist at all. It never throws for absence, which makes it suitable for branching; for assertions with a deadline, prefer `waitFor`.

### scrollIntoView

```ts
scrollIntoView(target: TargetLocator): Promise<void>
```

Intent-level — *bring this element into view* — not a raw gesture:

- **Android** drives the platform's own scrolling with `UiScrollable`: `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(<inner selector>)`, falling back to a plain element lookup when the screen has no scrollable container (or when the target is a `native`/`a11y` selector that is not a `UiSelector`).
- **iOS** executes `mobile: scroll` with `toVisible: true` on the resolved element.
- **Web** calls the element's `scrollIntoView` with `{ block: 'center', inline: 'nearest' }`.

### pressKey

```ts
pressKey(key: SemanticKey): Promise<void>

type SemanticKey = 'enter' | 'escape' | 'tab';
```

Sends a genuine system-level key event — faithful hardware-key semantics on every platform:

| Key | Android — key code via `mobile: pressKey` | iOS — HID usage, page `0x07`, via `mobile: performIoHidEvent` | Web — WebDriver codepoint via W3C key actions |
|---|---|---|---|
| `enter` | `66` (`KEYCODE_ENTER`) | `0x28` (Keyboard Return) | `` |
| `escape` | `111` (`KEYCODE_ESCAPE`) | `0x29` (Keyboard Escape) | `` |
| `tab` | `61` (`KEYCODE_TAB`) | `0x2B` (Keyboard Tab) | `` |

On iOS the events are injected device-level through WebDriverAgent's `performIoHidEvent` (a 5 ms press) — no hardware-keyboard setting is required. Verified behavior on iOS 18.6: Return commits and dismisses the keyboard, Escape performs UIKit's hardware-Escape cancel, Tab behaves as hardware Tab.

::: warning Android BACK is not a semantic key
`back` is deliberately absent from `SemanticKey`: it is an Android platform concept with no faithful equivalent elsewhere — iOS ignores even the HID *AC Back* consumer event, as live testing confirmed. `KEYCODE_BACK` (4) remains reachable on Android through native-level flows.
:::

### navigate

```ts
navigate(destination: string): Promise<void>
```

The meaning of `destination` is per platform:

- **Web** — a URL; the browser navigates to it.
- **Android** — a deep link, executed with `mobile: deepLink`. When the actor's configuration declares an `appPackage`, the link is routed into that package; plain URLs go to the system's default handler.
- **iOS** — a deep link, executed with `mobile: deepLink`.

### screenshot

```ts
screenshot(): Promise<ArtifactRef>

interface ArtifactRef {
  kind: 'screenshot' | 'log' | 'video' | 'source';
  path: string;
}
```

Captures the screen and writes a PNG under the run's artifacts directory, at `<artifactsDir>/<actorId>/<driver>-<sessionTag>-<n>.png`, where `sessionTag` distinguishes the run's many sessions (one per scenario) and `n` counts the session's screenshots. The return value is a **path reference, never bytes** — reporters and the event stream carry references, not payloads.

### source

```ts
source(): Promise<string>
```

Returns the full page source: the DOM serialization on web, the view-hierarchy XML on Android and iOS. Useful for debugging locators.

### dispose

```ts
dispose(): Promise<void>
```

Ends the underlying device/browser session. Idempotent by contract — SIGINT teardown may call it more than once — and tolerant: a failure to delete an already-dead session is logged at debug level and ignored, because a dead session is a disposed session.

### native

```ts
native<K extends keyof KrakenNativeSessions>(kind: K): KrakenNativeSessions[K]
```

The typed escape hatch to the platform-native session object. `KrakenNativeSessions` is an empty registry interface that driver packages augment via TypeScript declaration merging, keeping the core free of driver imports:

```ts
declare module '@kraken-e2e/contracts' {
  interface KrakenNativeSessions {
    web: WebdriverIO.Browser;
  }
}
```

By contract, `native(kind)` throws when `kind` does not match the session's driver. None of the three first-party drivers exposes a native session yet — calling `native()` on any of them throws `KRK-SESSION-OP-UNSUPPORTED`. For raw selectors, the `{ by: 'native' }` locator strategy is available today on all platforms.

## Errors

| Code | Raised by | Meaning |
|---|---|---|
| `KRK-SESSION-ELEMENT-NOT-FOUND` | `tap`, `typeText`, `readText`, `scrollIntoView` | No element resolved for the locator. Carries the resolved native selector and a strategy-specific fix hint. |
| `KRK-SESSION-WAIT-TIMEOUT` | `waitFor` | The element did not reach the requested state within `timeoutMs`. |
| `KRK-SESSION-OP-UNSUPPORTED` | any operation marked `'unsupported'` in `capabilities`; `native()` on the first-party drivers | The session cannot perform the operation. |

See [Error codes](/reference/error-codes) for the full catalog.

## Parity, not aspiration

A step written against portable strategies and core operations runs unchanged on Android, iOS and web. This is enforced mechanically: a conformance kit exercises the full session surface against fixture applications on real devices, the `capabilities` record feeds a generated parity report, and the surface itself only changes through the parity gate. See [Drivers](/guide/drivers) for what each driver requires from the host.
