/**
 * The signed-in Library: find a kahoot by name and read its QUIZ ID off the
 * page. The id is what the live-game URL needs — extracting it here is what
 * keeps the suite free of hardcoded links: rename-proof, account-proof.
 *
 * Kahoot's library cards carry `data-testid="kahoot-ui-library-card__<id>…"`
 * on every part (title, overlay, action menu — captured with `kraken
 * inspect`), so the id is read with a tiny in-page script via
 * `session.evaluate` — the web escape hatch for DATA the portable ops don't
 * expose. The script groups card parts by the UUID in the test id and matches
 * the requested name against each card's text, so it keeps working whichever
 * part carries the visible title.
 */
import type { UserSession } from '@kraken-e2e/contracts';

import { css, text } from '../../support/locators.js';

// Any part of any library card — the readiness anchor for the grid.
const ANY_CARD = css('[data-testid^="kahoot-ui-library-card__"]');
// Kahoot's post-login upsell popup (an iframe) appears a beat AFTER the
// dashboard renders and swallows clicks; its close (×) lives inside the frame.
const UPSELL_CLOSE = css('[ipm-action="closeDialog"]');

/** Returns the matching card's uuid, or the list of card names for the error. */
const FIND_QUIZ_ID = `
const want = (arguments[0] || '').replace(/\\s+/g, ' ').trim();
const cards = new Map(); // uuid -> combined text of every part
for (const el of document.querySelectorAll('[data-testid^="kahoot-ui-library-card__"]')) {
  const match = /^kahoot-ui-library-card__([0-9a-fA-F-]{36})/.exec(el.getAttribute('data-testid') || '');
  if (!match) continue;
  const uuid = match[1];
  const textContent = (el.textContent || '') + ' ' + (el.getAttribute('title') || '');
  cards.set(uuid, (cards.get(uuid) || '') + ' ' + textContent);
}
const names = [];
for (const [uuid, combined] of cards) {
  const normalized = combined.replace(/\\s+/g, ' ').trim();
  if (normalized.includes(want)) return { id: uuid };
  names.push(normalized.slice(0, 60));
}
return { names: names };
`;

export class LibraryPage {
  constructor(private readonly session: UserSession) {}

  /** Open the Library and return the quiz id of the kahoot named `name`. */
  async quizIdOf(name: string): Promise<string> {
    await this.dismissUpsellIfShown();

    await this.session.waitFor(text('Library'), 'visible', {
      timeoutMs: 30_000,
    });
    await this.tapResilient(text('Library'));

    // The grid is ready when any card renders; then read the id off the page.
    await this.session.waitFor(ANY_CARD, 'visible', { timeoutMs: 45_000 });
    const result = (await this.session.evaluate?.(FIND_QUIZ_ID, name)) as {
      id?: string;
      names?: string[];
    } | null;
    if (!result?.id) {
      const seen = result?.names?.filter(Boolean).join('; ') || '(none)';
      throw new Error(
        `Library: no card matched "${name}". Cards on screen: ${seen}. ` +
          'Check the kahoot name, or re-capture with `npx kraken inspect host`.',
      );
    }
    return result.id;
  }

  /** Close the late upsell popup when present (Escape closes the dialog too). */
  private async dismissUpsellIfShown(): Promise<void> {
    try {
      await this.session.waitFor(UPSELL_CLOSE, 'visible', { timeoutMs: 8_000 });
      await this.session.tap(UPSELL_CLOSE);
    } catch {
      try {
        await this.session.pressKey('escape');
      } catch {
        // nothing to close
      }
    }
  }

  /** Tap; when the late upsell iframe intercepts the click, close it and retry.
   *  The popup can render a beat late (or twice), so retry a few times before
   *  giving up — each interception is logged by WebdriverIO but recovered here. */
  private async tapResilient(target: Parameters<UserSession['tap']>[0]): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.dismissUpsellIfShown();
        await this.session.tap(target);
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        await this.dismissUpsellIfShown();
      }
    }
  }
}
