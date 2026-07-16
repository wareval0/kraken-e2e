---
"@kraken-e2e/cli": patch
---

Fix `kraken inspect` on web to hit-test the element actually painted on top.
The web mirror now identifies clicks with the browser's own
`document.elementFromPoint` (which honours z-index, overlays, dialogs and
`pointer-events`) instead of picking the smallest element containing the point.
Previously a click over a modal fell through to the content hidden behind it,
because occluded elements are still "visible" per computed style and keep their
boxes. Both identify and tap-through now resolve to the top layer and climb to
the nearest addressable, tappable ancestor.
