---
"@kraken-e2e/driver-android": minor
"@kraken-e2e/driver-ios": minor
---

The `native` locator strategy now routes bare mobile selectors to the correct
WebdriverIO strategy instead of letting them fall through as CSS. On Android, a
`new UiSelector(…)` / `new UiScrollable(…)` string is sent via `android=`; on
iOS, a `**/…` class chain or a predicate is sent via the matching `-ios`
strategy. Xpath, accessibility (`~`) and already-prefixed selectors are
unchanged. This makes `native` practical for apps built with Jetpack Compose,
Flutter or React Native, which frequently expose no stable ids.
