# @kraken-e2e/cli

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
