/**
 * Page Objects for saucedemo.com — a REAL public site built for automation
 * demos. Textbook Fowler/Selenium POM: each page models what the USER can do
 * there and hands navigation over by returning the next page object.
 *
 * saucedemo is third-party, so its selectors use Kraken's `native` escape
 * hatch (raw CSS). For apps you own, prefer the portable `testId` strategy —
 * the release-board page object next door shows that contrast.
 */
import type { UserSession } from '@kraken-e2e/contracts';

const css = (value: string) => ({ by: 'native', value }) as const;

export class SauceLoginPage {
  private constructor(private readonly session: UserSession) {}

  static async open(session: UserSession): Promise<SauceLoginPage> {
    await session.navigate('https://www.saucedemo.com');
    await session.waitFor(css('#user-name'), 'visible', { timeoutMs: 20_000 });
    return new SauceLoginPage(session);
  }

  async logInAs(username: string, password: string): Promise<InventoryPage> {
    await this.session.typeText(css('#user-name'), username);
    await this.session.typeText(css('#password'), password);
    await this.session.tap(css('#login-button'));
    return InventoryPage.expect(this.session);
  }
}

export class InventoryPage {
  private constructor(private readonly session: UserSession) {}

  static async expect(session: UserSession): Promise<InventoryPage> {
    await session.waitFor(css('.inventory_list'), 'visible', { timeoutMs: 20_000 });
    return new InventoryPage(session);
  }

  /** 'Sauce Labs Backpack' → data-test id 'add-to-cart-sauce-labs-backpack'. */
  async addToCart(productName: string): Promise<void> {
    const slug = productName.toLowerCase().replace(/\s+/g, '-');
    await this.session.tap(css(`[data-test="add-to-cart-${slug}"]`));
  }

  async cartCount(): Promise<number> {
    return Number(await this.session.readText(css('.shopping_cart_badge')));
  }

  async openCart(): Promise<CartPage> {
    await this.session.tap(css('.shopping_cart_link'));
    return CartPage.expect(this.session);
  }
}

export class CartPage {
  private constructor(private readonly session: UserSession) {}

  static async expect(session: UserSession): Promise<CartPage> {
    await session.waitFor(css('.cart_list'), 'visible', { timeoutMs: 15_000 });
    return new CartPage(session);
  }

  async itemNames(): Promise<string> {
    return this.session.readText(css('.inventory_item_name'));
  }

  async checkout(): Promise<CheckoutPage> {
    await this.session.tap(css('[data-test="checkout"]'));
    return CheckoutPage.expect(this.session);
  }
}

export class CheckoutPage {
  private constructor(private readonly session: UserSession) {}

  static async expect(session: UserSession): Promise<CheckoutPage> {
    await session.waitFor(css('[data-test="firstName"]'), 'visible', { timeoutMs: 15_000 });
    return new CheckoutPage(session);
  }

  async fillBuyer(info: {
    firstName: string;
    lastName: string;
    postalCode: string;
  }): Promise<void> {
    await this.session.typeText(css('[data-test="firstName"]'), info.firstName);
    await this.session.typeText(css('[data-test="lastName"]'), info.lastName);
    await this.session.typeText(css('[data-test="postalCode"]'), info.postalCode);
    await this.session.tap(css('[data-test="continue"]'));
  }

  async finish(): Promise<string> {
    await this.session.waitFor(css('[data-test="finish"]'), 'visible', { timeoutMs: 15_000 });
    await this.session.tap(css('[data-test="finish"]'));
    await this.session.waitFor(css('.complete-header'), 'visible', { timeoutMs: 15_000 });
    return this.session.readText(css('.complete-header'));
  }
}
