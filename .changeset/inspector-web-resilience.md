---
"@kraken-e2e/cli": patch
---

`kraken inspect` on web is now robust: the session uses classic WebDriver
(BiDi's browsingContext calls intermittently hung on heavy SPAs, timing out
and crashing the process); every driver call is time-bounded so a slow page
retries instead of hanging; a stray command rejection can no longer take the
process down; the initial capture retries until the mirror appears; and the
mirror is width-capped so the identifier panel keeps its space on wide desktop
layouts. Tap-through no longer freezes the inspector.
