/**
 * Page Object for the Release Board (the local app WE own) — note the
 * contrast with the saucedemo pages: here every locator is the portable
 * `testId` strategy, because the app was built with test ids from day one.
 */
import type { UserSession } from '@kraken-e2e/contracts';

const testId = (value: string) => ({ by: 'testId', value }) as const;

export class ReleaseBoardPage {
  private constructor(private readonly session: UserSession) {}

  static async open(session: UserSession, url: string): Promise<ReleaseBoardPage> {
    await session.navigate(url);
    await session.waitFor(testId('board-title'), 'visible', { timeoutMs: 15_000 });
    return new ReleaseBoardPage(session);
  }

  async recordSignoff(entry: { platform: string; by: string; build: string }): Promise<void> {
    await this.session.typeText(testId('signoff-platform'), entry.platform);
    await this.session.typeText(testId('signoff-by'), entry.by);
    await this.session.typeText(testId('signoff-build'), entry.build);
    await this.session.tap(testId('signoff-submit'));
    // form POST → 303 → server-rendered reload
    await this.session.waitFor(testId('board-title'), 'visible', { timeoutMs: 15_000 });
  }

  async signoffCount(): Promise<number> {
    const text = await this.session.readText(testId('signoff-count'));
    return Number(/(\d+)/.exec(text)?.[1] ?? Number.NaN);
  }

  async entryText(index: number): Promise<string> {
    return this.session.readText(testId(`entry-${index}`));
  }
}
