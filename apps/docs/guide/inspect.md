# The inspector

Writing steps against an unfamiliar application means discovering which locator addresses each element. `kraken inspect` makes that interactive: it mirrors a live actor session in your browser, and a click on any element returns its identifier, the ranked Kraken locators that address it, and a ready-to-paste Screen Object method.

```bash
npx kraken inspect alice
```

The command boots a session for the named actor exactly as `kraken run` would — using the same driver, configuration and device — then serves the inspector on a local address it prints. Open that address in a browser.

## Using the inspector

The inspector shows the device screen on the left and results on the right.

- **Click an element on the mirror.** Its bounding box is highlighted, and the panel lists the locators that address it, best first. The top one is tagged **recommended**; each is marked **unique** or **matches N** so you can see at a glance whether a locator identifies exactly one element on the screen. On web the panel merges the identifiers of the exact **leaf** you clicked with those of its tappable container, so a specific hook (a `…--title` test id) is never hidden behind a general container layer.
- **Uniqueness matters more than strategy.** A `resource-id` that a list or a navigation bar repeats across every row is *not* a usable identifier. The inspector detects this and prefers the locator that resolves to exactly one element — usually the visible text or the child label — over a shared id, which it keeps but demotes and flags. When nothing is unique, it offers a disambiguated native selector (an indexed `UiSelector` on Android, an indexed class chain on iOS).
- **Copy with a click.** Clicking a locator copies it and selects it; clicking the Screen Object method copies that.
- **The snippet follows your choice.** The Screen Object method is generated for the recommended locator by default, and regenerates when you click a different candidate — so if you intentionally prefer another identifier, the code updates to match.
- **Navigate.** The address bar sends a deep link (mobile) or URL (web) to the session, so you can walk through the application's screens without leaving the inspector.
- **Tap-through mode.** With this enabled, clicking the mirror also performs the tap on the device, and the mirror refreshes — letting you drive the application forward while collecting locators. On mobile the tap goes through the identified locator (validating it as a side effect). On web the click is dispatched **inside the page** at the exact point: the browser window is never raised or focused (the inspector stays on top), and because the target is hit-tested at dispatch time it works on late-rendered layers such as cookie sheets. The rare handler that insists on trusted events falls back to a locator tap automatically.
- **Refresh** re-captures the screen after an interaction the application performed on its own.

Every result is produced by hit-testing the click against the session's real element tree, so the identifiers are exactly what your steps will use.

## How it works

The inspector is built entirely on the portable session contract — `screenshot`, `source`, `tap`, `navigate` and (on web) `evaluate` — with no driver-specific code. It captures a screenshot and hit-tests the clicked point to find the element there.

- **Mobile** parses the page source into an element **tree** with screen bounds (uiautomator XML on Android, XCUI XML on iOS) and finds the smallest element containing the point. It then ranks locators by uniqueness across the whole screen: if the element's own id is shared (a repeated `resource-id`), it climbs to the tappable container and looks inside it for a child label that names the item uniquely, and only falls back to an indexed native selector when no stable, unique identifier exists. This works for any layout — XML/Java views (which expose `resource-id`, `text`, `content-desc`) and Jetpack Compose or Flutter (which usually expose only `content-desc`/semantics) — and applies equally on iOS.
- **Web** hit-tests inside the live page with the browser's own `document.elementFromPoint`, which honours real stacking order — z-index, overlays, dialogs and `pointer-events`. A click over a modal therefore identifies the modal, not the content painted beneath it. (A geometry-only search cannot do this: an element hidden behind an overlay is still "visible" per computed style and still occupies its box, so it would win a smallest-box search and the click would fall through.) From the topmost element it climbs to the nearest addressable, tappable ancestor, so clicking an icon or text span inside a button resolves to the button.

Because it uses only the public contract, it works with any driver, present or future.

## From click to Screen Object

The generated snippet follows the [Page Object](/best-practices/page-objects) convention, so it drops straight into a Screen Object class:

```ts
// In your Screen/Page Object:
async tapButtonLogin(): Promise<void> {
  await this.session.tap({ by: 'a11y', value: 'button-LOGIN' });
}
```

::: tip
Prefer the topmost candidate. When the inspector can only offer a `native` class selector, that is a signal the application lacks a stable identifier on that element — adding an accessibility id or test id there makes the element addressable portably across platforms and keeps the test resilient to layout changes.
:::

## Notes for web

The inspector runs web sessions with classic WebDriver (not BiDi) for a stable
screenshot/inspect loop, and every driver call is time-bounded — a slow page
surfaces as a retry, never a hang or a crashed process. The first capture of a
heavy page can take a few seconds; the mirror keeps retrying until it appears.
The mirror is width-capped so the identifier panel always has room, even for
wide desktop layouts.

Clicks are hit-tested in the live page, so anything painted on top — a modal,
an overlay, a dialog — is identified correctly instead of the element hidden
behind it. The inspector descends into **same-origin** `<iframe>`s so their
contents are identifiable; a **cross-origin** frame (many third-party pop-ups)
cannot be read by the browser, so the inspector reports the `<iframe>` itself.
Tap-through works either way — the click is dispatched in-page at the point,
and the web driver can also resolve locators across frames and tabs.

Tap-through never raises or focuses the browser window (the click is dispatched
inside the page), so the mirror keeps focus even with a headed browser. Pass
`--headless` if you prefer no browser window at all.

The mobile inspector disables Appium's idle-session reaper for the duration of
the session, so it will not be terminated while you pause between clicks.

Every click shows a **processing** indicator on the mirror and ignores further
clicks until it completes, so a slow-rendering target is never double-tapped —
while deliberate multi-step sequences still work, one click at a time.

## Flags

| Flag | Default | Effect |
|---|---|---|
| `-c, --config <path>` | auto-discovered | Use a specific configuration file. |
| `--port <n>` | OS-assigned | Inspector port. |
| `--host <addr>` | `127.0.0.1` | Bind address. |
| `--headless` | `false` | Web only: run the browser hidden so tapping doesn't steal focus from the mirror. |

The session and the inspector are torn down cleanly when you stop the command with Ctrl-C.
