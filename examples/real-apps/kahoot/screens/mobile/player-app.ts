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
import { waitForAny, waitForValue } from '../../support/waits.js';

/** The single PIN/nickname edit field each join screen shows. */
const EDIT_FIELD = ui('new UiSelector().className("android.widget.EditText")');
const JOIN = a11y('Join');
const ENTER = text('Enter');
const OK_GO = text('OK, go!');
// The post-answer wrap-up: a "Continue" button on the placement screen, then a
// second one on the stats screen — same test id on both.
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

    // The nickname screen. Its field keeps a stable generated test id, but we
    // fall back to "the lone edit field" so a test-id churn can't strand us.
    const nicknameField = await waitForAny(session, [testId('_r_1_'), EDIT_FIELD], {
      timeoutMs: 30_000,
    });
    await session.tap(nicknameField);
    await session.typeText(nicknameField, nickname);
    // Confirm the nickname actually landed in the field before submitting — the
    // app's input handling can lag typeText, and a too-early "OK, go!" tap would
    // register a half-typed name.
    await waitForValue(session, nicknameField, nickname, { timeoutMs: 10_000 });
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
   * shows the player's placement, then a stats screen — each with its OWN
   * "Continue" button that shares the SAME test id. Tap through both.
   *
   * The shared id is a trap: a "did the button go away?" check can't tell
   * "the tap advanced to the next screen's Continue" from "the tap was swallowed
   * and the same Continue is still here" (Kahoot's Compose buttons can render a
   * frame before they're tappable — this suite hits that elsewhere too). So the
   * two taps could silently collapse onto one screen. The guard against a
   * false pass is the FINAL assertion: the wrap-up is done only when NO Continue
   * remains. If one lingers, a tap didn't land — and this fails loudly, with the
   * screen captured, instead of green-lighting a game that never ended.
   */
  async finish(): Promise<void> {
    // Placement screen → Continue.
    await this.session.waitFor(CONTINUE, 'visible', { timeoutMs: 60_000 });
    await this.session.tap(CONTINUE);
    // Let the placement button clear before the next tap so we don't re-tap it;
    // a cross-fade that keeps a Continue on screen is fine — the next wait
    // re-finds a visible one.
    await this.session.waitFor(CONTINUE, 'hidden', { timeoutMs: 4_000 }).catch(() => {});
    // Stats screen → Continue again.
    await this.session.waitFor(CONTINUE, 'visible', { timeoutMs: 60_000 });
    await this.session.tap(CONTINUE);
    // The player has truly left the game only when no Continue is left.
    await this.session.waitFor(CONTINUE, 'hidden', { timeoutMs: 30_000 });
  }
}
