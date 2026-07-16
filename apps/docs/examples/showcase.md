# The showcase

`examples/showcase` is a set of five suites written the way a production Kraken installation should be written: Given/When/Then as specification, Page and Screen Objects, seeded fixtures, explicit signal choreography and disciplined monkey testing. Every suite has been run green against real devices; the timings below are from those runs on warm devices.

## Release sign-off — Android + iOS + Web (~40 s)

```bash
kraken run --config kraken.trio.config.ts
```

The flagship. A release ships only when both mobile engineers have signed off and the release manager has recorded the evidence:

```gherkin
Given carol is watching the release board
When alice verifies the forms surface echoes "release 2.0.0 smoke"
And alice signs off the "android" build for "2.0.0"
And bob verifies the gesture carousel renders
And bob signs off the "ios" build for "2.0.0"
Then carol collects 2 sign-offs in publish order within 2m
And carol confirms the sign-offs arrived from "alice" then "bob"
When carol records every collected sign-off on the board
Then carol sees 2 recorded sign-offs on the board
When carol announces the release is published
Then alice receives the publication notice for build "2.0.0" within 30s
And bob receives the publication notice for build "2.0.0" within 30s
```

What it demonstrates: payload-carrying signals chained across three platforms; per-subscriber FIFO consumption asserted in publication order; a one-to-many fan-out (one `release-published`, two independent receivers); and a real web application under test — the release board is a small server-rendered app started by the configuration itself, driven through `testId` locators.

## Account parity — Android + iOS (~52 s)

```bash
kraken run --config kraken.duo.config.ts
```

An account created on Android logs in on iOS. The two actors never exchange credentials: both derive the identical user from the same fixture seed. One screen-object class drives both platforms.

## Web checkout — a public site (~9 s)

```bash
kraken run --config kraken.web.config.ts
```

A complete purchase on saucedemo.com — Sauce Labs' public demonstration store — through textbook Page Objects: login, inventory, cart, checkout, confirmation. Demonstrates Kraken as a single-actor end-to-end tool, and the `native`-selector pattern appropriate for third-party surfaces.

## Android account lifecycle (~23 s)

```bash
kraken run --config kraken.android.config.ts
```

Sign-up followed by login with a generated, schema-validated user. No hardcoded credentials anywhere in the suite.

## Seeded monkey (~14 s)

```bash
kraken run --config kraken.monkey.config.ts
```

Twenty-five seed-derived random interactions against the forms screen, with action-error tolerance, followed by a survival assertion (preceded by dialog recovery) and an explicit reproducibility check of the walk. See [Monkey testing](/best-practices/monkey-testing).

## Reading order

The suite's source is organized to be read: `fixtures/users.ts` (seeded data), `screens/` (the two page-object flavors: portable mobile screens, third-party web pages), `steps/index.ts` (thin, business-language steps), `features/` (one directory per platform combination), and five `kraken.*.config.ts` files that map the same building blocks onto different casts.
