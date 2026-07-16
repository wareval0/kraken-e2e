/**
 * Screen Object for the native-demo-app Login/Sign-up screen (the mobile
 * flavor of Fowler's Page Object): locators and UI mechanics live HERE, in
 * intention-revealing methods; steps stay one line of business language.
 *
 * One class drives BOTH Android and iOS: every locator is a portable
 * accessibility id, verified live on both platforms.
 */
import type { UserSession } from '@kraken-e2e/contracts';
import type { User } from '../../fixtures/users.js';
import { openByDeepLink } from './navigation.js';

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

export class LoginScreen {
  private constructor(private readonly session: UserSession) {}

  static async open(session: UserSession): Promise<LoginScreen> {
    await openByDeepLink(session, 'wdio://login', { by: 'a11y', value: 'Login-screen' });
    return new LoginScreen(session);
  }

  async signUpAs(user: User): Promise<void> {
    await this.session.tap(a11y('button-sign-up-container'));
    await this.session.waitFor(a11y('input-repeat-password'), 'visible', { timeoutMs: 10_000 });
    await this.session.typeText(a11y('input-email'), user.email);
    await this.session.typeText(a11y('input-password'), user.password);
    await this.session.typeText(a11y('input-repeat-password'), user.password);
    await this.session.tap(a11y('button-SIGN UP'));
  }

  async logInAs(user: User): Promise<void> {
    await this.session.tap(a11y('button-login-container'));
    await this.session.waitFor(a11y('button-LOGIN'), 'visible', { timeoutMs: 10_000 });
    await this.session.typeText(a11y('input-email'), user.email);
    await this.session.typeText(a11y('input-password'), user.password);
    await this.session.tap(a11y('button-LOGIN'));
  }

  /**
   * The app confirms with a native dialog — grounded live: login says
   * "Success / You are logged in!", sign-up says "Signed Up!"; both appear
   * ~1-1.5s after the tap and both carry an OK button, so THAT is the
   * stable anchor.
   */
  async confirmSuccessDialog(): Promise<void> {
    await this.session.waitFor({ by: 'text', value: 'OK', exact: true }, 'visible', {
      timeoutMs: 10_000,
    });
    await this.session.tap({ by: 'text', value: 'OK', exact: true });
  }
}
