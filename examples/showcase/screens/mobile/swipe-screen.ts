/**
 * Screen Object for the native-demo-app Swipe screen (gesture-surface audit).
 */
import type { UserSession } from '@kraken-e2e/contracts';

import { openByDeepLink } from './navigation.js';

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

export class SwipeScreen {
  private constructor(private readonly session: UserSession) {}

  static async open(session: UserSession): Promise<SwipeScreen> {
    await openByDeepLink(session, 'wdio://swipe', { by: 'a11y', value: 'Swipe-screen' });
    return new SwipeScreen(session);
  }

  async isCarouselCardShown(): Promise<boolean> {
    await this.session.waitFor(a11y('card'), 'visible', { timeoutMs: 10_000 });
    return this.session.isDisplayed(a11y('card'));
  }
}
