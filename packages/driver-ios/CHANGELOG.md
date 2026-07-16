# @kraken-e2e/driver-ios

## 3.1.0

### Minor Changes

- 9c95718: The `native` locator strategy now routes bare mobile selectors to the correct
  WebdriverIO strategy instead of letting them fall through as CSS. On Android, a
  `new UiSelector(…)` / `new UiScrollable(…)` string is sent via `android=`; on
  iOS, a `**/…` class chain or a predicate is sent via the matching `-ios`
  strategy. Xpath, accessibility (`~`) and already-prefixed selectors are
  unchanged. This makes `native` practical for apps built with Jetpack Compose,
  Flutter or React Native, which frequently expose no stable ids.

### Patch Changes

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
