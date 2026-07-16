---
"@kraken-e2e/contracts": minor
"@kraken-e2e/driver-web": minor
"@kraken-e2e/config": minor
"@kraken-e2e/gherkin": minor
"@kraken-e2e/core": minor
"@kraken-e2e/cli": minor
---

Web element inspection and per-actor data (contract 2.2, additive).

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
