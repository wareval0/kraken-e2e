# @kraken-e2e/driver-web

## 3.1.0

### Minor Changes

- 9c95718: Real-world robustness, across the board:

  - **Web `text` locators now match ANY element.** They previously compiled to
    WebdriverIO's `=text`/`*=text`, which are LINK-TEXT selectors — they match
    `<a>` elements only, so a text locator aimed at a `<button>Start</button>` or
    a `<div>` title silently found nothing. The strategy now compiles to an XPath
    that selects the innermost element whose normalised text equals (or contains)
    the value.
  - **Android actions tolerate render races.** A `tap`/`typeText`/`readText`
    whose target hasn't mounted yet (a button that enables after input, a screen
    mid-transition) now gets a short, bounded existence wait before failing —
    instead of throwing `KRK-SESSION-ELEMENT-NOT-FOUND` on the very first frame.
    It never masks a genuinely absent element (still throws after the wait) and
    never slows queries (`isDisplayed`/`waitFor` don't route through it).
  - **Android sessions boot their own emulator.** Device resolution now runs
    before Appium: a configured `udid` that is not connected falls back to the
    configured AVD (booting it), then to any running device, then to booting an
    available AVD; a configured AVD already running is reused. Nothing anywhere
    fails immediately with `KRK-DRV-ANDROID-NO-DEVICE` and a fix, instead of a
    slow Appium timeout.
  - **Web waits absorb loaders and redirects.** `waitFor` polls the top document
    cheaply and runs the deep iframe/tab sweep on a cadence, so heavy pages keep
    a real poll rate; and when the page URL changes mid-wait (loader → redirect,
    countdowns) the remaining budget is topped back up, bounded by a hard cap of
    3× the timeout.
  - **Per-step screenshots.** New config option `screenshots:
'on-failure' | 'per-step' | 'off'` — `'per-step'` captures the acting actor's
    screen after every completed step, a visual timeline of the run. Steps can
    still capture explicitly via `actor.session.screenshot()`.
  - **Inspector tap-through no longer steals focus.** On web the click is
    dispatched inside the page at the exact point — the browser window is never
    raised, and late-rendered layers (cookie sheets) are hit-tested at dispatch
    time. Identification also merges the clicked leaf's identifiers with its
    container's, so specific hooks are never hidden behind a general layer.

- 9c95718: Web element resolution now looks past the top document, so real sites work
  without special-casing: an element not found there is searched for inside the
  current window's iframes (a consent/upsell/embed frame — WebDriver frame
  switching is not bound by the same-origin policy) and then in the other open
  tabs/windows (a link that opened a new tab). An action taps/types where the
  element actually is and, for a new tab, the flow follows it there; a query
  (isDisplayed/waitFor) is side-effect-free. Single-window, single-frame pages are
  unaffected — the extra lookups only engage when the element is not in the
  current top document.

  Because tapping now crosses frames, `kraken inspect` no longer refuses to tap an
  element it identified inside an iframe.

- 9c95718: Web element inspection and per-actor data (contract 2.2, additive).

  - **`kraken inspect` now works on web.** Web sessions had no coordinates in
    their source, so hit-testing found nothing ("no element at that point").
    A new optional `UserSession.evaluate(script)` (implemented by the web driver)
    lets the inspector read live DOM geometry, so clicking any element on a web
    page returns its ranked locators and a Screen Object snippet — including a
    stable attribute selector (`[data-functional-selector=…]`, `[name=…]`) or
    `#id` when no test id exists. Validated live against a real site.
  - **Per-actor data.** Each actor in `kraken.config.ts` can carry a `data`
    object and/or an `env` file path (merged, inline wins), exposed to steps as
    `actor.data` — the place for per-actor credentials and custom fields. It is
    step-facing only and never passed to the driver. `env` files should be
    gitignored.

### Patch Changes

- 9c95718: Web sessions now run with classic WebDriver by default (opt out via
  capabilities). WebdriverIO defaults to BiDi for Chrome/Edge/Firefox, but BiDi's
  `browsingContext` calls (used to enumerate frames and tabs, and for screenshots)
  intermittently hang on heavy single-page apps and can take the process down.
  Classic WebDriver is stable, covers every Kraken operation including the new
  frame/tab-aware element resolution, and matches what `kraken inspect` already
  used.
- Updated dependencies [9c95718]
  - @kraken-e2e/contracts@3.1.0

## 3.0.0

### Patch Changes

- @kraken-e2e/contracts@3.0.0

## 2.0.0

### Minor Changes

- `kraken devices` + fail-fast fixes from tutorial field feedback:

  - **New command `kraken devices`** (contract 2.1, additive): lists everything
    you can already drive — booted simulators, running emulators, connected
    devices, installed browsers — each with a ready-to-paste `actor config`.
    Running targets pin by udid/serial so Kraken attaches to what's already up
    instead of provisioning; available iOS entries always pin deviceName AND
    platformVersion together (the pairs that really exist — no more ghost-sim
    boot storms from hand-written names).
  - **Fail-fast app validation** (android/ios): a missing `app` file now fails
    in milliseconds with `KRK-DRIVER-APP-NOT-FOUND`, the resolved path and an
    actionable fix — instead of minutes of emulator boot ending in a raw
    Appium error. Relative paths resolve against the project root.
  - **Project-local browser-driver cache** (web): WDIO downloads now live in
    `.kraken/browser-cache` instead of the OS temp dir, where one interrupted
    download used to poison every later run. Recovery: rm -rf .kraken/browser-cache
  - Packages now version in LOCKSTEP (changesets `fixed`): one version across
    the whole platform from here on.

### Patch Changes

- Updated dependencies
  - @kraken-e2e/contracts@2.0.0

## 1.0.0

### Minor Changes

- 350ef19: Kraken 3.0 first public alpha: multi-user/multi-device E2E testing with
  signal-synchronized choreography across real Android, iOS and Web in one BDD
  scenario. Verified mobile parity (machine-checked gate), embedded Appium
  servers, WDIO-native web driver, Ink live UI, Allure 3 + CTRF reporters,
  seeded data-gen and fuzzing, Redis Streams distributed signaling.

### Patch Changes

- Updated dependencies [350ef19]
  - @kraken-e2e/contracts@0.1.0
