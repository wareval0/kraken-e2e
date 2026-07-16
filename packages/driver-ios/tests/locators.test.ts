import { describe, expect, it } from 'vitest';

import { toIosSelector } from '../src/locators.ts';

describe('toIosSelector (ADR-0002 D1 mapping)', () => {
  it('maps testId and a11y to accessibility id', () => {
    expect(toIosSelector({ by: 'testId', value: 'composer' })).toBe('~composer');
    expect(toIosSelector({ by: 'a11y', value: 'send-button' })).toBe('~send-button');
  });

  it('maps text to label/value predicates (contains vs exact), escaped', () => {
    expect(toIosSelector({ by: 'text', value: 'Send' })).toBe(
      '-ios predicate string:label CONTAINS "Send" OR value CONTAINS "Send"',
    );
    expect(toIosSelector({ by: 'text', value: 'Send', exact: true })).toContain('label == "Send"');
    expect(toIosSelector({ by: 'text', value: 'say "hi"' })).toContain('say \\"hi\\"');
  });

  it('passes native selectors through raw', () => {
    // A bare class chain is routed to the -ios class chain strategy (WDIO does
    // not auto-detect it), while xpath and ~ accessibility pass through raw.
    expect(
      toIosSelector({ by: 'native', value: '**/XCUIElementTypeButton[`label == "OK"`]' }),
    ).toBe('-ios class chain:**/XCUIElementTypeButton[`label == "OK"`]');
    expect(toIosSelector({ by: 'native', value: '//XCUIElementTypeButton' })).toBe(
      '//XCUIElementTypeButton',
    );
  });
});
