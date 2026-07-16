---
"@kraken-e2e/driver-web": patch
---

Web sessions now run with classic WebDriver by default (opt out via
capabilities). WebdriverIO defaults to BiDi for Chrome/Edge/Firefox, but BiDi's
`browsingContext` calls (used to enumerate frames and tabs, and for screenshots)
intermittently hang on heavy single-page apps and can take the process down.
Classic WebDriver is stable, covers every Kraken operation including the new
frame/tab-aware element resolution, and matches what `kraken inspect` already
used.
