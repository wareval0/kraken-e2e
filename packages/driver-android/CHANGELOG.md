# @kraken-e2e/driver-android

## 3.1.0

### Minor Changes

- 9c95718: The `native` locator strategy now routes bare mobile selectors to the correct
  WebdriverIO strategy instead of letting them fall through as CSS. On Android, a
  `new UiSelector(…)` / `new UiScrollable(…)` string is sent via `android=`; on
  iOS, a `**/…` class chain or a predicate is sent via the matching `-ios`
  strategy. Xpath, accessibility (`~`) and already-prefixed selectors are
  unchanged. This makes `native` practical for apps built with Jetpack Compose,
  Flutter or React Native, which frequently expose no stable ids.
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

### Patch Changes

- Cap `appium:waitForIdleTimeout` in the default Android capabilities so commands
  stay responsive on continuously animated screens. UiAutomator2 blocks each
  command until the UI goes idle; a never-idle screen (Compose recomposition,
  progress rings, transitions) made every find, visibility check and tap stall for
  the full idle window — seconds per command on a busy screen. The cap is
  overridable through the driver factory or actor `capabilities`, and explicit
  `waitFor` polling still absorbs any mid-transition miss.
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
