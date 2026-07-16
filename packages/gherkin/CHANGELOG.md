# @kraken-e2e/gherkin

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

- Updated dependencies [9c95718]
- Updated dependencies [9c95718]
  - @kraken-e2e/core@3.1.0
  - @kraken-e2e/contracts@3.1.0

## 3.0.0

### Patch Changes

- @kraken-e2e/contracts@3.0.0
- @kraken-e2e/core@3.0.0

## 2.0.0

### Patch Changes

- Updated dependencies
  - @kraken-e2e/contracts@2.0.0
  - @kraken-e2e/core@2.0.0

## 0.1.1

### Patch Changes

- @kraken-e2e/contracts@0.1.1
- @kraken-e2e/core@0.1.1

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
