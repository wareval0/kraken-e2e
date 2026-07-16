# Cross-device live Kahoot

A quiz **host** in a real desktop browser and a **player** on the installed
native Kahoot Android app play one live game together. This is the
web + native-mobile interoperability story on a production app: real sign-in,
real upsell modals, real loaders and countdowns, a real game PIN.

```
host (web: kahoot.com → play.kahoot.it)      player (android: no.mobitroll.kahoot.android)
  sign in, read quiz id off the Library
  launch live, classic mode
  read PIN ────────────── game-pin ──────────▶  join with PIN + nickname
  start round ◀────── player-in-lobby ────────  (waiting in the lobby)
              ─────── question-live ──────────▶  answer "Diamond"
  advance to results ◀──── answered ──────────
  (host's finish line)                          see placement → Continue → stats → Continue
```

## Run it

```bash
# one-time setup: SETUP.md (account, app sign-in, env files)
npx kraken run                # the whole scenario — no flags needed
npx kraken run --dry-run      # compile + deadlock analysis only
npx kraken inspect host       # click-to-identify selectors on the browser
npx kraken inspect player     # …or on the Android device
```

If the Android emulator is not running, Kraken boots the configured AVD by
itself. Every step leaves a screenshot under `.kraken/runs/<id>/` (the
`screenshots: 'per-step'` policy in `kraken.config.ts`) — a visual timeline of
the run.

## How it's built — the parts worth copying

- **Nothing hardcoded.** The quiz id is read off the Library page at run time
  (`LibraryPage.quizIdOf`), so renaming, re-creating or switching accounts
  never breaks the suite. `session.evaluate` is the sanctioned web escape
  hatch for reading data the portable ops don't expose.
- **Secrets are layered.** Shared non-secret parameters live in `.env`
  (loaded into `process.env` before the config is evaluated); the host's
  credentials live in `.env.host`, wired to that one actor via its `env`
  field; the player's nickname is plain inline `data` in the config. Steps
  read all of it from `actor.data` — never from the repo.
- **Steps are one line each.** The Gherkin names the business action; the
  Page/Screen Object owns the mechanics; signals own the cross-device order.
- **Every hop waits on the NEXT screen's anchor** (the classic-mode tile, the
  game PIN), not on sleeps. Kahoot's loaders and countdowns are absorbed by
  the driver: its waitFor polls fast and extends its budget when the page
  navigates mid-wait.
- **Cross-device sync anchors on the receiver's own truth.** A signal is a
  hand-off, not a guarantee the other side is ready: the player's "I'm in"
  can beat Kahoot's server-side registration. So the host doesn't start on the
  signal alone — it waits until a participant actually appears in *its own*
  lobby (starting empty pops a "no participants" dialog that would exclude the
  player). Wait on the state you depend on, not just the message that it's coming.
- **Selectors were captured with `kraken inspect`**, which ranks candidates by
  page-wide uniqueness — `support/locators.ts` documents which strategy fits
  which surface.

## When Kahoot changes something

Run `npx kraken inspect host` (or `player`), click the element, and paste the
recommended locator into the ONE Screen Object that owns it. The
`data-functional-selector` hooks Kahoot ships have proven stable; visible text
is the fallback.
