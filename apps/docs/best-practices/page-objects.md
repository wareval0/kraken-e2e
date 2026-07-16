# Page & Screen Objects

The Page Object pattern keeps locators and UI mechanics out of step definitions: each page (web) or screen (mobile) is modeled as a class whose methods express user intentions. Steps become one-line delegations, and a UI change is absorbed in exactly one place. Kraken's showcase suites apply the pattern in three variants worth distinguishing.

## The shape

A page object wraps a `UserSession`, exposes intention-revealing methods, and provides a static factory that navigates to the page and waits until it is genuinely ready:

```typescript
import type { UserSession } from '@kraken-e2e/contracts';
import { openByDeepLink } from './navigation.js';

const a11y = (value: string) => ({ by: 'a11y', value }) as const;

export class LoginScreen {
  private constructor(private readonly session: UserSession) {}

  static async open(session: UserSession): Promise<LoginScreen> {
    await openByDeepLink(session, 'wdio://login', { by: 'a11y', value: 'Login-screen' });
    return new LoginScreen(session);
  }

  async logInAs(user: User): Promise<void> {
    await this.session.tap(a11y('button-login-container'));
    await this.session.waitFor(a11y('button-LOGIN'), 'visible', { timeoutMs: 10_000 });
    await this.session.typeText(a11y('input-email'), user.email);
    await this.session.typeText(a11y('input-password'), user.password);
    await this.session.tap(a11y('button-LOGIN'));
  }
}
```

The step that uses it stays declarative:

```typescript
When('{actor} logs in with the shared QA account', async ({ actor }) => {
  const screen = await LoginScreen.open(actor.session);
  await screen.logInAs(qaUser());
});
```

## One screen class, two mobile platforms

Because the session contract and locator strategies are portable, a screen object built on `a11y` locators drives Android **and** iOS unchanged — the class above runs against both in the showcase's account-parity suite. This halves the page-object layer for any application that assigns accessibility identifiers consistently.

## Own application vs third-party site

Locator strategy choice is a design signal:

- **Applications you own** should expose stable test identifiers, and their page objects should use the portable strategies (`testId`, `a11y`). The showcase's release-board page uses `{ by: 'testId', value: 'signoff-submit' }` against markup written with `data-testid` attributes.
- **Third-party surfaces** rarely offer portable hooks; their page objects use the `native` escape hatch (`{ by: 'native', value: '[data-test="checkout"]' }` on saucedemo.com). Keeping raw selectors confined to page objects preserves the rest of the suite's portability.

The contrast is itself an argument to put test identifiers in applications from the first commit.

## Hand over navigation explicitly

When an action navigates, return the next page object rather than leaving the caller to guess:

```typescript
async checkout(): Promise<CheckoutPage> {
  await this.session.tap(css('[data-test="checkout"]'));
  return CheckoutPage.expect(this.session);
}
```

`expect(session)` factories (wait for the page's marker, then construct) keep every arrival synchronized with reality.

## Stabilize entry points

Mobile deep links can race the application's first render. The showcase routes every screen entry through one helper that retries the navigation once if the screen marker does not settle — a single, documented place for a real-world accommodation instead of scattered waits:

```typescript
export async function openByDeepLink(session, link, marker) {
  await session.navigate(link);
  try {
    await session.waitFor(marker, 'visible', { timeoutMs: 12_000 });
  } catch {
    await session.navigate(link);
    await session.waitFor(marker, 'visible', { timeoutMs: 15_000 });
  }
}
```
