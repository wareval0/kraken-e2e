# Real-app suites

Kraken exercised against real, production applications — not demo fixtures.
Each suite is a **self-contained Kraken project**: its own `kraken.config.ts`
(so every command runs with zero flags from its directory), its own secrets,
its own docs. That keeps suites from bleeding into each other as more are
added.

| Suite | Devices | What it proves |
|---|---|---|
| [`kahoot/`](kahoot/) | desktop browser + native Android app | one live quiz, two devices, coordinated by signals |

To add a suite, copy the layout of `kahoot/`:

```
<app>/
  kraken.config.ts     actors + drivers + policies — the zero-flags default
  features/            the behaviour, in Given/When/Then
  steps/index.ts       thin steps → Page/Screen Objects + signal choreography
  screens/             one class per screen the actors touch
  support/locators.ts  locator factories (documents strategy choice per surface)
  .env.example         shared non-secret parameters
  .env.<actor>.example per-actor secrets, wired via the actor's `env` field
  README.md, SETUP.md
```
