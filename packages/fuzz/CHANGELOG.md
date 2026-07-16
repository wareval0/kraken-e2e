# @kraken-e2e/fuzz

## 3.1.0

### Patch Changes

- Updated dependencies [9c95718]
  - @kraken-e2e/contracts@3.1.0

## 3.0.0

### Minor Changes

- 809d2e2: `runFuzz` gains `tolerateActionErrors`: allow up to N failed actions without
  aborting the walk — each miss is recorded in `result.errors` and the monkey
  keeps walking. Real UIs flake under a monkey (soft keyboards occlude
  elements, re-renders staleify handles, native alerts pop); a tolerant walk
  stays seed-reproducible because the plan never depends on runtime outcomes.

### Patch Changes

- @kraken-e2e/contracts@3.0.0

## 2.0.0

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
