---
"@kraken-e2e/cli": minor
---

New command `kraken inspect <actor>`: mirrors a live actor session in the
browser and turns clicks on the mirror into element identification — the
element's identifier, the ranked portable Kraken locators that address it
(accessibility id first, then test id, then text, with a raw class selector
only as a flagged last resort), and a ready-to-paste Screen Object method.
Includes deep-link/URL navigation and a tap-through mode. Built entirely on
the portable session contract (screenshot + source + tap + navigate), so it
works with any driver.
