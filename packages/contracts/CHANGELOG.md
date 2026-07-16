# @kraken-e2e/contracts

## 3.1.0

### Minor Changes

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

- @kraken-e2e/signaling@3.1.0

## 3.0.0

### Patch Changes

- @kraken-e2e/signaling@3.0.0

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

- @kraken-e2e/signaling@2.0.0

## 0.1.1

### Patch Changes

- Updated dependencies
  - @kraken-e2e/signaling@0.1.1

## 0.1.0

### Minor Changes

- 350ef19: Kraken 3.0 first public alpha: multi-user/multi-device E2E testing with
  signal-synchronized choreography across real Android, iOS and Web in one BDD
  scenario. Verified mobile parity (machine-checked gate), embedded Appium
  servers, WDIO-native web driver, Ink live UI, Allure 3 + CTRF reporters,
  seeded data-gen and fuzzing, Redis Streams distributed signaling.

### Patch Changes

- Updated dependencies [350ef19]
  - @kraken-e2e/signaling@0.1.0
