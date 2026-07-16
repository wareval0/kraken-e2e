# @kraken-e2e/cli

## 3.1.0

### Minor Changes

- 9c95718: New command `kraken inspect <actor>`: mirrors a live actor session in the
  browser and turns clicks on the mirror into element identification — the
  element's identifier, the ranked portable Kraken locators that address it
  (accessibility id first, then test id, then text, with a raw class selector
  only as a flagged last resort), and a ready-to-paste Screen Object method.
  Includes deep-link/URL navigation and a tap-through mode. Built entirely on
  the portable session contract (screenshot + source + tap + navigate), so it
  works with any driver.
- 9c95718: Make `kraken inspect` recommend locators that identify exactly ONE element on
  mobile. The inspector now parses the page source into an element tree and ranks
  locators by UNIQUENESS across the whole screen instead of by strategy type
  alone: a `resource-id` shared across a list or navigation bar (`titleTextView`,
  `navigation_bar_item_…`) is demoted and flagged, and the recommended locator
  becomes the unique visible text or, for a tappable container with no unique id
  of its own, the child label that names it. When nothing is unique it emits a
  disambiguated native selector — an indexed `UiSelector` (by resource-id or
  content-desc) on Android, an indexed class chain on iOS. Works for XML/Java
  views, Jetpack Compose and Flutter (content-desc only), and iOS. In the mirror,
  each candidate shows a recommended/unique/matches-N badge and the generated
  Page Object snippet follows the candidate you click.

  Also: on Android, an unqualified `testId` now resolves to a resource-id that
  matches both the classic `pkg:id/name` shape and a bare Compose
  `testTagsAsResourceId` id, with the value regex-escaped.

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

- 9c95718: Fix and polish `kraken inspect` interaction on web and mobile:

  - **Web identify no longer crashes.** WebDriver serialises `undefined` → `null`
    over the wire, so web element fields arrived as `null`; the ranker then threw
    `Cannot read properties of null (reading 'indexOf')` on almost every element.
    The evaluated element is now normalised (null → absent) before ranking.
  - **Text locators are matchable.** Text is taken from the clicked leaf's own
    text nodes, not a container's concatenated `textContent` (which produced
    unmatchable strings like `"ENEnglish (US)"`); a multi-child container yields
    no text so a stable attribute is recommended instead.
  - **Same-origin iframes** are descended into (with correct coordinate mapping,
    including the frame's border/padding) so their contents are identifiable;
    in-frame elements are identify-only (no cross-frame tap).
  - **Mobile sessions survive idle.** `appium:newCommandTimeout` is disabled for
    the inspect session, so it is not reaped while you pause between clicks.
  - **Tap feedback.** A processing indicator shows on the mirror and clicks are
    ignored while one is in flight, preventing accidental double-taps; the tapped
    locator is confirmed instantly. One screenshot per tap instead of two.
  - **`--headless`** (web) runs the browser hidden so tapping doesn't steal focus
    from the mirror.

- 9c95718: Make `kraken inspect` on web identify the element you actually see, not a
  transparent overlay on top of it. Many cards and list rows lay an empty,
  transparent click-capture `<div>` over their content; `elementFromPoint`
  returned that overlay, so a click on a card's title reported the generic
  overlay (and tapped the card centre) instead of the title. The inspector now
  peels such see-through spacer elements — by temporarily disabling their
  `pointer-events` and re-hit-testing — to reveal the visible element beneath,
  while keeping genuine controls (buttons, links, icon-only `<button>`s,
  stretched-link `<a>`s, SVG shapes, ARIA-labelled/focusable elements) and opaque
  modals untouched. It also pierces open shadow DOM (common in cookie/consent
  sheets and web components), which previously blocked identification and
  tap-through.
- 9c95718: `kraken inspect` now ranks WEB locators by uniqueness, like the mobile path
  already does. It counts, in the page, how many elements each candidate matches,
  so a locator that resolves to exactly one element is recommended and an
  ambiguous one is demoted and flagged (for example, a `text: "Log in"` shared by
  a login card's heading and its submit button now loses to the button's unique
  `data-functional-selector`). This stops the inspector from suggesting a selector
  that matches the wrong element.
- 9c95718: Fix `kraken inspect` on web to hit-test the element actually painted on top.
  The web mirror now identifies clicks with the browser's own
  `document.elementFromPoint` (which honours z-index, overlays, dialogs and
  `pointer-events`) instead of picking the smallest element containing the point.
  Previously a click over a modal fell through to the content hidden behind it,
  because occluded elements are still "visible" per computed style and keep their
  boxes. Both identify and tap-through now resolve to the top layer and climb to
  the nearest addressable, tappable ancestor.
- 9c95718: `kraken inspect` on web is now robust: the session uses classic WebDriver
  (BiDi's browsingContext calls intermittently hung on heavy SPAs, timing out
  and crashing the process); every driver call is time-bounded so a slow page
  retries instead of hanging; a stray command rejection can no longer take the
  process down; the initial capture retries until the mirror appears; and the
  mirror is width-capped so the identifier panel keeps its space on wide desktop
  layouts. Tap-through no longer freezes the inspector.
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

- Updated dependencies [9c95718]
- Updated dependencies [9c95718]
- Updated dependencies [9c95718]
  - @kraken-e2e/config@3.1.0
  - @kraken-e2e/core@3.1.0
  - @kraken-e2e/contracts@3.1.0
  - @kraken-e2e/gherkin@3.1.0
  - @kraken-e2e/doctor@3.1.0
  - @kraken-e2e/reporters@3.1.0
  - @kraken-e2e/tui@3.1.0
  - @kraken-e2e/signaling@3.1.0

## 3.0.0

### Patch Changes

- @kraken-e2e/config@3.0.0
- @kraken-e2e/contracts@3.0.0
- @kraken-e2e/core@3.0.0
- @kraken-e2e/doctor@3.0.0
- @kraken-e2e/gherkin@3.0.0
- @kraken-e2e/reporters@3.0.0
- @kraken-e2e/signaling@3.0.0
- @kraken-e2e/tui@3.0.0

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
  - @kraken-e2e/config@2.0.0
  - @kraken-e2e/core@2.0.0
  - @kraken-e2e/doctor@2.0.0
  - @kraken-e2e/gherkin@2.0.0
  - @kraken-e2e/reporters@2.0.0
  - @kraken-e2e/tui@2.0.0
  - @kraken-e2e/signaling@2.0.0

## 0.1.1

### Patch Changes

- Robustness fixes from the Phase 4+5 verification pass (no API changes):

  - **kraken serve** (`@kraken-e2e/cli`): the WebSocket live tail reads only the
    newly-appended byte range instead of re-reading the entire `events.jsonl` on
    every poll (UTF-8-correct across chunk boundaries); `/api/runs` summaries are
    cached by the events file's (mtime, size) so the viewer's periodic poll no
    longer re-parses every run's full log; a containment guard rejects a run id
    that would escape the runs directory.
  - **Redis transport** (`@kraken-e2e/signaling`): `close()` now settles an
    in-flight connection (no leaked client) and `waitFor` stops cleanly on close
    instead of touching a torn-down client.
  - **Data generation** (`@kraken-e2e/data-gen`): fixture generators and overrides
    are typed against the schema's input type (`z.input`), correct for schemas
    that use `.transform()`/`.pipe()`/coercion; `build()` still returns the parsed
    output.

- Updated dependencies
  - @kraken-e2e/signaling@0.1.1
  - @kraken-e2e/contracts@0.1.1
  - @kraken-e2e/core@0.1.1
  - @kraken-e2e/config@0.1.1
  - @kraken-e2e/doctor@0.1.1
  - @kraken-e2e/gherkin@0.1.1
  - @kraken-e2e/reporters@1.0.0
  - @kraken-e2e/tui@0.1.1

## 0.1.0

### Minor Changes

- 350ef19: Kraken 3.0 first public alpha: multi-user/multi-device E2E testing with
  signal-synchronized choreography across real Android, iOS and Web in one BDD
  scenario. Verified mobile parity (machine-checked gate), embedded Appium
  servers, WDIO-native web driver, Ink live UI, Allure 3 + CTRF reporters,
  seeded data-gen and fuzzing, Redis Streams distributed signaling.

### Patch Changes

- Updated dependencies [350ef19]
  - @kraken-e2e/contracts@0.1.0
  - @kraken-e2e/core@0.1.0
  - @kraken-e2e/signaling@0.1.0
  - @kraken-e2e/gherkin@0.1.0
  - @kraken-e2e/config@0.1.0
  - @kraken-e2e/tui@0.1.0
  - @kraken-e2e/reporters@1.0.0
  - @kraken-e2e/doctor@0.1.0
