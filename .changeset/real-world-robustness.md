---
"@kraken-e2e/driver-android": minor
"@kraken-e2e/driver-web": minor
"@kraken-e2e/config": minor
"@kraken-e2e/core": minor
"@kraken-e2e/cli": minor
---

Real-world robustness, across the board:

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
