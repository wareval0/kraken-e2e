---
"@kraken-e2e/cli": patch
---

`kraken inspect` now ranks WEB locators by uniqueness, like the mobile path
already does. It counts, in the page, how many elements each candidate matches,
so a locator that resolves to exactly one element is recommended and an
ambiguous one is demoted and flagged (for example, a `text: "Log in"` shared by
a login card's heading and its submit button now loses to the button's unique
`data-functional-selector`). This stops the inspector from suggesting a selector
that matches the wrong element.
