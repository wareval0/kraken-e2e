# ADR-0009: Web Driver Internals

| | |
|---|---|
| **Status** | **Accepted** (2026-07-05) — CTK 11/11 on real Chrome; flagship 3-platform relay + swapped matrix permutation green |
| **Date** | 2026-07-05 |
| **Deciders** | Claude (Fable 5), implementing ADR-0001 §5.6 (ratified 2026-07-02) |
| **Relates to** | ADR-0001 §5.6 (independent sessions, BiDi progressive enhancement), §5.13 (doctor); ADR-0002 D1 (locators); ADR-0007/0008 (the mobile siblings this deliberately does NOT mirror) |

## Context

`@kraken/driver-web` drives real browsers. Unlike the mobile drivers there is **no Appium in this stack**: WebdriverIO talks to browser drivers directly and manages their binaries (chromedriver/geckodriver/msedgedriver/safaridriver) automatically. That asymmetry of internals — with symmetry of contract — is the point of the driver SPI.

## Decisions

### D1 — WDIO-native sessions, no server to embed

One independent `remote()` per actor (§5.6, D4). `start()`/`stop()` are no-ops: there is no shared server; WDIO spawns and reaps the browser driver per session. BiDi is WDIO 9's default for Chrome/Edge/Firefox (progressive enhancement — nothing in Kraken depends on it); Safari runs classic WebDriver. `webdriverio` loads dynamically inside `createSession()` (§5.5 import safety).

### D2 — Capability policy

Actor config: `browser` ('chrome' | 'firefox' | 'safari' | 'edge' | any raw browserName), `baseUrl` (navigated right after session creation), `headless`, raw `capabilities` merged last. Driver options provide the defaults. Headless is **off by default** — watching three platforms choreograph is the product's demo moment; CTK/CI runs opt in.

### D3 — Locator mapping (ADR-0002 D1) and the cross-platform a11y bridge

`testId` → `[data-testid="…"]`; `a11y` → `[aria-label="…"]`; `text` → WDIO native text selectors (`=` exact, `*=` contains); `native` → raw CSS/XPath/WDIO passthrough. Notably, `{ by: 'a11y' }` resolves to accessibility ids on Android/iOS and `[aria-label]` on web — the flagship example's steps run unmodified on all three platforms through that one strategy.

`readText` falls back from `getText()` to `getValue()` when text nodes are empty (form controls carry content in `value`). `pressKey` → W3C key actions with the WebDriver codepoints (``/``/``) — the contract-2.0 semantic set is hardware-key faithful on web natively.

### D4 — CTK fixture: a page we own

The conformance fixture is a self-contained HTML page served by an in-test `node:http` server (started with collection-time top-level await — the CTK needs the URL when the suite is declared). Roles mirror the mobile fixture: a toggling button, a text input mirroring into a result element (the `typableEcho` read-back), a known label, a below-the-fold element for scroll. LIVE result (2026-07-05): **11/11 supported on Chrome headless in 16s**; `parity-reports/parity-report.web.json` published.

**The parity GATE stays mobile-only (C3).** Web publishes its report alongside the mobile ones for visibility, but ADR-0001 §5.4's zero-diff criterion binds the android↔ios pair; web differences surface as report content, not gate blocks.

### D5 — Safari's one-session limit, surfaced in doctor

`safaridriver` allows ONE concurrent session per host — two simultaneous Safari actors on one Mac cannot work; scenarios mix browsers instead. The doctor check states this on every macOS run and detects safaridriver never having been enabled (`safaridriver --enable`). Chrome/Firefox actors need no enablement.

## Consequences

- First Chrome session on a fresh machine downloads chromedriver (network); subsequent runs hit WDIO's cache. Offline-first classrooms should run one warm-up session.
- `file://` URLs work for self-contained demo pages (the flagship example uses one); apps needing http are served by the test/example itself.
- `native()` for web (raw script execution, CDP access) stays unexposed until a concrete need lands, same policy as mobile.
