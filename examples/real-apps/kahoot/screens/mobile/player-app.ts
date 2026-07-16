/**
 * The player on the NATIVE Kahoot Android app (no.mobitroll.kahoot.android),
 * already signed in as part of the manual setup (see SETUP.md).
 *
 * The app is Jetpack Compose, which exposes few resource-ids — so the join
 * flow leans on accessibility ids, visible text and the lone EditText per
 * screen (all captured with `npx kraken inspect player`).
 *
 * Notice the rhythm: every tap that follows a screen change is preceded by a
 * `waitFor` on the thing we're about to touch. Kahoot enables its "Enter" and
 * "OK, go!" buttons a beat after the field settles; anchoring on them (rather
 * than tapping blind) is what makes the flow reliable. The driver also grants
 * actions a short grace period, but waiting explicitly reads clearer and gives
 * a precise error when a screen never arrives.
 */
import type { UserSession } from '@kraken-e2e/contracts';

import { a11y, testId, text, ui } from '../../support/locators.js';
import { waitForAny, waitForEmpty, waitForValue } from '../../support/waits.js';

/** The single PIN/nickname edit field each join screen shows. */
const EDIT_FIELD = ui('new UiSelector().className("android.widget.EditText")');
const JOIN = a11y('Join');
const ENTER = text('Enter');
const OK_GO = text('OK, go!');
// Kahoot's nickname input; the same generated id backs the PIN and nickname
// screens, so it may briefly still hold the PIN.
const NICKNAME_FIELD = testId('_r_1_');
// The post-answer wrap-up: a "Continue" button appears on the placement screen
// and again on the stats screen — the SAME id on both.
const CONTINUE = testId('continueButton');

export class PlayerApp {
  private constructor(private readonly session: UserSession) {}

  /** From the app home: join `pin`, register `nickname`, land in the lobby. */
  static async join(session: UserSession, pin: string, nickname: string): Promise<PlayerApp> {
    // Home → the PIN screen.
    await session.waitFor(JOIN, 'visible', { timeoutMs: 60_000 });
    await session.tap(JOIN);

    // Type the PIN, then submit — "Enter" enables once the PIN is entered.
    await session.waitFor(EDIT_FIELD, 'visible', { timeoutMs: 30_000 });
    await session.typeText(EDIT_FIELD, pin);
    await session.waitFor(ENTER, 'visible', { timeoutMs: 15_000 });
    await session.tap(ENTER);

    // Confirm we've LEFT the PIN screen before touching the next field — else a
    // mid-transition poll could still see the (now stale) PIN edit box.
    await session.waitFor(ENTER, 'hidden', { timeoutMs: 15_000 });

    // The nickname screen. Kahoot reuses ONE input component across the PIN and
    // nickname screens (same generated id), so the field can still hold the PIN
    // for a beat. Anchor on that field, wait until it is actually EMPTY, then
    // type — otherwise the nickname is appended to the PIN ("1234567MyName").
    const nicknameField = NICKNAME_FIELD;
    await session.waitFor(nicknameField, 'visible', { timeoutMs: 30_000 });
    await session.tap(nicknameField);
    await waitForEmpty(session, nicknameField, { timeoutMs: 10_000 });
    await session.typeText(nicknameField, nickname);
    // Confirm the field holds EXACTLY the nickname (not the PIN + nickname, and
    // not a half-typed value) before submitting.
    await waitForValue(session, nicknameField, nickname, { timeoutMs: 10_000, exact: true });
    await session.waitFor(OK_GO, 'visible', { timeoutMs: 15_000 });
    await session.tap(OK_GO);

    return new PlayerApp(session);
  }

  /**
   * Tap the answer tile for a shape (e.g. "Diamond").
   *
   * Two realities of the classic mobile answer screen shape this:
   *  - The player device shows ONLY the four colored answer SHAPES — never the
   *    question text (that lives on the host's screen). So we identify by shape,
   *    not by any answer wording.
   *  - Those tiles carry no visible text; the shape name lives in the
   *    accessibility label (content-desc). And the tiles render a few seconds
   *    AFTER the question goes live (a countdown/read delay), so we poll.
   *
   * We try the shape as an accessibility id and as visible text, each exact and
   * "contains" (Kahoot labels vary by version — "Diamond" vs "Blue diamond"),
   * and tap whichever shows first. A generous-but-bounded budget means a wrong
   * label surfaces as a clean failure (with the answer screen captured) instead
   * of an eternal hang.
   */
  async answer(shape: string): Promise<void> {
    const candidates = [
      a11y(shape), // content-desc == "Diamond"
      ui(`new UiSelector().descriptionContains("${shape}")`), // content-desc ~ "…Diamond…"
      text(shape), // visible text == "Diamond"
      ui(`new UiSelector().textContains("${shape}")`), // visible text ~ "…Diamond…"
    ];
    const tile = await waitForAny(this.session, candidates, {
      timeoutMs: 90_000,
    });
    await this.session.tap(tile);
  }

  /**
   * Finish the game from the player's side: after the question closes, the app
   * walks through TWO wrap-up screens — the player's placement, then a stats
   * summary — each with a "Continue" button that shares the SAME id.
   *
   * That shared id is the trap. Tapping "the Continue" twice in a row races the
   * screen transition: if the first screen's button is still up when the second
   * tap fires, the second tap re-hits the FIRST button and the next screen is
   * never dismissed. So we walk the KNOWN number of screens, and for each one
   * wait for its button to appear, tap it, then wait for THAT button to
   * actually leave before moving on. These are WebView screens with variable
   * render timing, so both waits are generous; a screen that never arrives, or
   * a tap that never advances, surfaces as a clean timeout rather than a silent
   * miss.
   */
  async finish(): Promise<void> {
    const WRAP_UP_SCREENS = 2; // placement, then stats
    for (let screen = 0; screen < WRAP_UP_SCREENS; screen += 1) {
      await this.session.waitFor(CONTINUE, 'visible', { timeoutMs: 60_000 });
      await this.session.tap(CONTINUE);
      await this.session.waitFor(CONTINUE, 'hidden', { timeoutMs: 20_000 });
    }
  }
}
