# @kraken-e2e/data-gen

## 3.1.0

## 3.0.0

## 2.0.0

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

## 0.1.0

### Minor Changes

- 350ef19: Kraken 3.0 first public alpha: multi-user/multi-device E2E testing with
  signal-synchronized choreography across real Android, iOS and Web in one BDD
  scenario. Verified mobile parity (machine-checked gate), embedded Appium
  servers, WDIO-native web driver, Ink live UI, Allure 3 + CTRF reporters,
  seeded data-gen and fuzzing, Redis Streams distributed signaling.
