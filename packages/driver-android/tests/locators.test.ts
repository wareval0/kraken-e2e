import { describe, expect, it } from 'vitest';

import { keyCodeFor, toAndroidSelector } from '../src/locators.ts';

describe('toAndroidSelector (ADR-0002 D1 mapping)', () => {
  it('maps unqualified testId to a resource-id regex matching classic AND bare (Compose) ids', () => {
    expect(toAndroidSelector({ by: 'testId', value: 'composer' })).toBe(
      'android=new UiSelector().resourceIdMatches("(.*:id/)?composer")',
    );
  });

  it('regex-escapes an unqualified testId so a Compose tag matches literally', () => {
    // `Modifier.testTag("item.title")` → resource-id "item.title"; the dot must
    // not match any character.
    expect(toAndroidSelector({ by: 'testId', value: 'item.title' })).toBe(
      'android=new UiSelector().resourceIdMatches("(.*:id/)?item\\\\.title")',
    );
  });

  it('uses qualified resource ids verbatim', () => {
    expect(toAndroidSelector({ by: 'testId', value: 'com.app:id/send' })).toBe(
      'android=new UiSelector().resourceId("com.app:id/send")',
    );
  });

  it('maps text (contains vs exact) and a11y (content-desc)', () => {
    expect(toAndroidSelector({ by: 'text', value: 'Send' })).toContain('textContains("Send")');
    expect(toAndroidSelector({ by: 'text', value: 'Send', exact: true })).toContain(
      '.text("Send")',
    );
    expect(toAndroidSelector({ by: 'a11y', value: 'send-button' })).toBe('~send-button');
  });

  it('escapes quotes/backslashes and passes native selectors through raw', () => {
    expect(toAndroidSelector({ by: 'text', value: 'say "hi"' })).toContain('say \\"hi\\"');
    expect(toAndroidSelector({ by: 'native', value: '//android.widget.Button[2]' })).toBe(
      '//android.widget.Button[2]',
    );
  });

  it('maps every semantic key to a real Android keycode (back is gone — contract 2.0)', () => {
    expect(keyCodeFor('enter')).toBe(66);
    expect(keyCodeFor('escape')).toBe(111);
    expect(keyCodeFor('tab')).toBe(61);
    // @ts-expect-error 'back' left SemanticKey (Android-only concept, ADR-0002 amendment)
    expect(() => keyCodeFor('back')).toThrow();
  });
});
