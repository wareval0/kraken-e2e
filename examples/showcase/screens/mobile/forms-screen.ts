/**
 * Screen Object for the native-demo-app Forms screen — the smoke-test surface
 * (text echo, switch, dropdown, active/inactive buttons). Portable a11y
 * locators: the same class drives Android and iOS.
 */
import type { UserSession } from '@kraken-e2e/contracts';

import { openByDeepLink } from './navigation.js';

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

export class FormsScreen {
  private constructor(private readonly session: UserSession) {}

  static async open(session: UserSession): Promise<FormsScreen> {
    await openByDeepLink(session, 'wdio://forms', { by: 'a11y', value: 'Forms-screen' });
    return new FormsScreen(session);
  }

  async typeAndReadEcho(text: string): Promise<string> {
    await this.session.typeText(a11y('text-input'), text);
    return this.session.readText(a11y('input-text-result'));
  }

  async toggleSwitch(): Promise<string> {
    await this.session.tap(a11y('switch'));
    return this.session.readText(a11y('switch-text'));
  }

  async isActiveButtonShown(): Promise<boolean> {
    return this.session.isDisplayed(a11y('button-Active'));
  }
}
