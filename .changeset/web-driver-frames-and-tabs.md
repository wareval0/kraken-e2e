---
"@kraken-e2e/driver-web": minor
"@kraken-e2e/cli": patch
---

Web element resolution now looks past the top document, so real sites work
without special-casing: an element not found there is searched for inside the
current window's iframes (a consent/upsell/embed frame — WebDriver frame
switching is not bound by the same-origin policy) and then in the other open
tabs/windows (a link that opened a new tab). An action taps/types where the
element actually is and, for a new tab, the flow follows it there; a query
(isDisplayed/waitFor) is side-effect-free. Single-window, single-frame pages are
unaffected — the extra lookups only engage when the element is not in the
current top document.

Because tapping now crosses frames, `kraken inspect` no longer refuses to tap an
element it identified inside an iframe.
