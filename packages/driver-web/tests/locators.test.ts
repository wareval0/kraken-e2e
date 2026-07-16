import { describe, expect, it } from 'vitest';

import { toWebSelector, WEB_KEY_CODES } from '../src/locators.ts';

describe('toWebSelector (ADR-0002 D1 mapping)', () => {
  it('maps testId to data-testid and a11y to aria-label (escaped)', () => {
    expect(toWebSelector({ by: 'testId', value: 'composer' })).toBe('[data-testid="composer"]');
    expect(toWebSelector({ by: 'a11y', value: 'send "now"' })).toBe(
      '[aria-label="send \\"now\\""]',
    );
  });

  it('maps text to WDIO native text selectors (exact vs contains)', () => {
    // NOT WDIO's '=text'/'*=text' — those are LINK-TEXT selectors (anchors
    // only); a text locator must match buttons, divs, spans, everything.
    expect(toWebSelector({ by: 'text', value: 'Send' })).toBe(
      '//*[contains(normalize-space(.), "Send") and not(.//*[contains(normalize-space(.), "Send")]) and not(self::script) and not(self::style)]',
    );
    expect(toWebSelector({ by: 'text', value: 'Send', exact: true })).toBe(
      '//*[normalize-space(.)="Send" and not(.//*[normalize-space(.)="Send"]) and not(self::script) and not(self::style)]',
    );
  });

  it('passes native selectors through raw', () => {
    expect(toWebSelector({ by: 'native', value: '#app > button.primary' })).toBe(
      '#app > button.primary',
    );
  });

  it('maps every semantic key to a WebDriver codepoint (contract 2.0)', () => {
    expect(WEB_KEY_CODES.enter).toBe('');
    expect(WEB_KEY_CODES.escape).toBe('');
    expect(WEB_KEY_CODES.tab).toBe('');
  });
});
