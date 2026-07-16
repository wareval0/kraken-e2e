# Examples

The repository ships several example projects under `examples/`, ordered here from zero-infrastructure to full multi-platform. Each is a complete, runnable Kraken project — configuration, features, steps — and each has been validated end to end on real devices.

| Project | Platforms | Purpose |
|---|---|---|
| `fake-messaging` | three fake platforms, zero devices | The engine end to end on your laptop in under a second: three actors, a signal, a background task — no emulator, simulator or browser required. The recommended first run. |
| `mobile-messaging` | real Android + real iOS | A message composed on the Android emulator arrives on the iOS simulator, carried by a payload signal. |
| `multi-user-android-ios-web` | real Android + iOS + Web | The three-platform relay: Android → Web → iOS, every step using the same portable `a11y` locators. Includes `kraken.swapped.config.ts` — the same feature and steps with the actor↔platform assignment permuted, demonstrating platform matrices. |
| `showcase` | all combinations | Five production-patterned suites — see [The showcase](/examples/showcase). |
| `real-apps/kahoot` | Web host + native Android player | A live Kahoot quiz played across a browser and the native app in one scenario, against the production application — see [Live Kahoot](/examples/kahoot). |

## Running them

From the repository root, after `pnpm install` and fetching the fixture applications:

```bash
node scripts/fetch-fixture-apps.mjs        # downloads the pinned demo app (APK + iOS .app)

cd examples/fake-messaging
node ../../packages/cli/bin/run.js run --plain

cd ../multi-user-android-ios-web
node ../../packages/cli/bin/run.js run                                    # three platforms
node ../../packages/cli/bin/run.js run --config kraken.swapped.config.ts  # permuted matrix
```

Device expectations for the real-device examples: an Android AVD (default `Medium_Phone_API_36.0`, override with `KRAKEN_ANDROID_AVD`), an iOS simulator (defaults `iPhone 16` / `18.6`, override with `KRAKEN_IOS_SIM` / `KRAKEN_IOS_VERSION`), and Chrome. Run `kraken devices` to see what the machine already offers and reuse it.

The mobile examples drive the WebdriverIO *native-demo-app* — an open-source fixture application whose element identifiers are accessibility ids on both platforms, which is what makes single-source cross-platform steps possible.
