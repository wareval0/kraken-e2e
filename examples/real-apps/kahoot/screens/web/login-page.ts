/**
 * kahoot.com sign-in, from the marketing home to the signed-in dashboard.
 *
 * The session already opens on KAHOOT_HOME_URL (the `baseUrl` in
 * kraken.config.ts), so this page starts from the landing and ends when the
 * dashboard container is visible. Two production realities it absorbs:
 *
 *  - the OneTrust cookie banner shows on the marketing site AND again on the
 *    login domain — accepted by its canonical id, then we wait for its
 *    click-blocking overlay to clear;
 *  - the page has TWO "Log in" texts (the card heading and the submit button),
 *    so submission uses the button's stable functional-selector hook.
 */
import type { UserSession } from '@kraken-e2e/contracts';

import { css, text } from '../../support/locators.js';

const COOKIES_ACCEPT = css('#onetrust-accept-btn-handler');
const COOKIES_OVERLAY = css('.onetrust-pc-dark-filter');
const USERNAME = css('[data-functional-selector="username-input-field__input"]');
const PASSWORD = css('[data-functional-selector="password-input-field__input"]');
const SIGN_IN = css('[data-functional-selector="sign-in-button"]');
const DASHBOARD = css('[data-functional-selector="main-content-container"]');

export class LoginPage {
  constructor(private readonly session: UserSession) {}

  /** From the landing page to the signed-in dashboard. */
  async signIn(email: string, password: string): Promise<void> {
    await this.acceptCookiesIfAsked();

    await this.session.waitFor(text('Log in'), 'visible', { timeoutMs: 30_000 });
    await this.tapPastCookies(text('Log in'));

    await this.acceptCookiesIfAsked(); // the login domain asks again

    await this.session.waitFor(USERNAME, 'visible', { timeoutMs: 30_000 });
    await this.session.typeText(USERNAME, email);
    await this.session.typeText(PASSWORD, password);

    // The cookie sheet can render LATE — after the form is already filled — and
    // then intercept the submit. Clear it if present, and submit through a
    // retry that re-clears and taps again if a late sheet still gets in the way.
    await this.tapPastCookies(SIGN_IN);

    await this.session.waitFor(DASHBOARD, 'visible', { timeoutMs: 60_000 });
  }

  /** Accept the OneTrust banner when shown; wait out its blocking overlay.
   *  This runs before every guarded tap, so the "is it there?" probe is kept
   *  SHORT: the sheet, when it comes, renders within a second or two — a long
   *  wait here would just tax every call (and every retry) when no sheet is
   *  present. A sheet that slips in later still gets caught by the tap retry. */
  private async acceptCookiesIfAsked(): Promise<void> {
    try {
      await this.session.waitFor(COOKIES_ACCEPT, 'visible', { timeoutMs: 3_000 });
      await this.session.tap(COOKIES_ACCEPT);
    } catch {
      return; // already accepted (or this page hasn't asked yet)
    }
    try {
      await this.session.waitFor(COOKIES_OVERLAY, 'hidden', { timeoutMs: 3_000 });
    } catch {
      // overlay lingered — the resilient taps absorb it
    }
  }

  /** Tap a target, dismissing the cookie sheet if it (late-)intercepts the click. */
  private async tapPastCookies(target: Parameters<UserSession['tap']>[0]): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.acceptCookiesIfAsked();
        await this.session.tap(target);
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
        await this.acceptCookiesIfAsked();
      }
    }
  }
}
