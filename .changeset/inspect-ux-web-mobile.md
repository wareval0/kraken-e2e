---
"@kraken-e2e/cli": patch
---

Fix and polish `kraken inspect` interaction on web and mobile:

- **Web identify no longer crashes.** WebDriver serialises `undefined` → `null`
  over the wire, so web element fields arrived as `null`; the ranker then threw
  `Cannot read properties of null (reading 'indexOf')` on almost every element.
  The evaluated element is now normalised (null → absent) before ranking.
- **Text locators are matchable.** Text is taken from the clicked leaf's own
  text nodes, not a container's concatenated `textContent` (which produced
  unmatchable strings like `"ENEnglish (US)"`); a multi-child container yields
  no text so a stable attribute is recommended instead.
- **Same-origin iframes** are descended into (with correct coordinate mapping,
  including the frame's border/padding) so their contents are identifiable;
  in-frame elements are identify-only (no cross-frame tap).
- **Mobile sessions survive idle.** `appium:newCommandTimeout` is disabled for
  the inspect session, so it is not reaped while you pause between clicks.
- **Tap feedback.** A processing indicator shows on the mirror and clicks are
  ignored while one is in flight, preventing accidental double-taps; the tapped
  locator is confirmed instantly. One screenshot per tap instead of two.
- **`--headless`** (web) runs the browser hidden so tapping doesn't steal focus
  from the mirror.
