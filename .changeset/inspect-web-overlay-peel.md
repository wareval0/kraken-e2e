---
"@kraken-e2e/cli": patch
---

Make `kraken inspect` on web identify the element you actually see, not a
transparent overlay on top of it. Many cards and list rows lay an empty,
transparent click-capture `<div>` over their content; `elementFromPoint`
returned that overlay, so a click on a card's title reported the generic
overlay (and tapped the card centre) instead of the title. The inspector now
peels such see-through spacer elements — by temporarily disabling their
`pointer-events` and re-hit-testing — to reveal the visible element beneath,
while keeping genuine controls (buttons, links, icon-only `<button>`s,
stretched-link `<a>`s, SVG shapes, ARIA-labelled/focusable elements) and opaque
modals untouched. It also pierces open shadow DOM (common in cookie/consent
sheets and web components), which previously blocked identification and
tap-through.
