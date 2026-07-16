/**
 * The live game as the HOST sees it on play.kahoot.it: launch by quiz id,
 * read the join PIN, run the round, verify the ending.
 *
 * The launch navigates straight to the play URL built from the quiz id read
 * off the Library (nothing hardcoded). Every hop waits on the NEXT screen's
 * anchor — Kahoot puts a loader after the ownership check and a countdown
 * before the question, and the driver's waitFor extends its budget when the
 * route changes, so these transitions are absorbed instead of raced.
 *
 * A launch-page detail worth knowing: each game mode has its OWN start button
 * (`start-classic-mode-button` for classic, `start-presentation-button` for
 * the presentation experience, …), so the CTA changes when a tile is picked —
 * the suite anchors on whichever renders after selecting classic.
 */
import type { UserSession } from '@kraken-e2e/contracts';

import { css, text } from '../../support/locators.js';
import { waitForAny } from '../../support/waits.js';

const I_OWN_IT = css('[data-functional-selector="sign-in-button"]'); // its visible text: "I own this kahoot"
const CLASSIC_MODE = css('[data-functional-selector="classic-mode-card"]');
const START_CLASSIC = css('[data-functional-selector="start-classic-mode-button"]');
const START_FALLBACKS = [START_CLASSIC, css('[data-functional-selector^="start-"]'), text('Start')];
const GAME_PIN = css('[data-functional-selector="game-pin"]');
const LOBBY_PAGE = css('[data-functional-selector="lobby-page"]');
const NEXT = css('[data-functional-selector="next-button"]');
const QUESTION_BLOCK = css('[data-functional-selector="game-block"]'); // the live question widget
const START_GAME = css('[data-functional-selector="start-button"]'); // lobby "Start the kahoot"
// Any joined participant. Kahoot lists each as `player-name`; the entry appears
// only once the server has registered a player, so this is the host's own
// proof that "someone is in" — deliberately name-agnostic (Kahoot can rename
// players via its friendly-nickname option, so the shown name need not equal
// what the player typed).
const ANY_PARTICIPANT = css('[data-functional-selector="player-name"]');

export class GameHostPage {
  private constructor(private readonly session: UserSession) {}

  /** Navigate to the game and drive it to the lobby (PIN on screen). */
  static async launch(session: UserSession, quizId: string): Promise<GameHostPage> {
    const page = new GameHostPage(session);
    await session.navigate(`https://play.kahoot.it/v2/?quizId=${encodeURIComponent(quizId)}`);

    // "This kahoot is private" → confirm ownership (we ARE signed in).
    await session.waitFor(I_OWN_IT, 'visible', { timeoutMs: 60_000 });
    await session.tap(I_OWN_IT);

    // A loader redirects to the launch page — the classic tile is its anchor.
    await session.waitFor(CLASSIC_MODE, 'visible', { timeoutMs: 120_000 });
    await session.tap(CLASSIC_MODE);

    // Selecting the tile swaps the CTA to the classic start button.
    const start = await waitForAny(session, START_FALLBACKS, { timeoutMs: 30_000 });
    await session.tap(start);

    // Lobby reached when the PIN renders. A slow launch page occasionally
    // swallows the first Start click — one deliberate retry absorbs it.
    try {
      await session.waitFor(GAME_PIN, 'visible', { timeoutMs: 60_000 });
    } catch {
      const retry = await waitForAny(session, START_FALLBACKS, { timeoutMs: 10_000 });
      await session.tap(retry);
      await session.waitFor(GAME_PIN, 'visible', { timeoutMs: 90_000 });
    }
    return page;
  }

  /** The digits players type to join. */
  async readPin(): Promise<string> {
    const pin = (await this.session.readText(GAME_PIN)).replace(/\s+/g, '');
    if (!/^\d{4,}$/.test(pin)) {
      throw new Error(`Read an implausible game PIN: "${pin}"`);
    }
    return pin;
  }

  /**
   * Begin the question round — but only once the host's OWN lobby actually
   * shows a joined participant.
   *
   * This is the real cross-device sync point. The player's "I'm in" signal can
   * beat Kahoot's server-side registration, so no participant may be listed
   * here yet when the signal arrives. Starting early makes Kahoot pop a "no
   * participants" confirmation dialog (a full-screen overlay) — which both
   * excludes the player AND intercepts the next click. Waiting for the lobby
   * entry closes that race at the source of truth.
   */
  async startRound(): Promise<void> {
    try {
      await this.session.waitFor(ANY_PARTICIPANT, 'visible', { timeoutMs: 120_000 });
    } catch {
      throw new Error(
        'No player appeared in the host lobby within 120s. The player device reported ' +
          'joining, but Kahoot never registered them here — check the PIN, the network, ' +
          'or whether the player joined a different game.',
      );
    }
    await this.session.waitFor(START_GAME, 'visible', { timeoutMs: 30_000 });
    await this.session.tap(START_GAME);
    // Best-effort confirmation that the game left the lobby. Kahoot may keep the
    // lobby route mounted briefly under the intro countdown, so a lingering
    // lobby-page is not a failure here — the downstream question/answer steps
    // surface a genuine stall.
    try {
      await this.session.waitFor(LOBBY_PAGE, 'hidden', { timeoutMs: 30_000 });
    } catch {
      // lobby still showing under the countdown — let the round proceed
    }
  }

  /**
   * From the answered question to the results screen — the host's finish line.
   * "Next" moves the game on, but it renders a moment before it's actionable
   * (the question is still being read), so an early tap silently no-ops and the
   * host never leaves the question. We tap until the question block is gone.
   */
  async advanceToResults(): Promise<void> {
    await this.session.waitFor(NEXT, 'visible', { timeoutMs: 90_000 });
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await this.session.tap(NEXT);
      try {
        await this.session.waitFor(QUESTION_BLOCK, 'hidden', { timeoutMs: 10_000 });
        return; // left the question → the results are showing
      } catch {
        // Still on the question: the tap landed before "Next" was live. Retry.
      }
    }
    throw new Error('Host could not advance past the question — "Next" stayed inert.');
  }
}
