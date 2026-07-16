import type { TargetLocator } from '@kraken-e2e/contracts';

/**
 * Portable locator strategies → XCUITest selectors (ADR-0002 D1 mapping:
 * testId → accessibility identifier, a11y → accessibility identifier,
 * text → label/value predicate).
 */
export function toIosSelector(target: TargetLocator): string {
  switch (target.by) {
    case 'testId':
    case 'a11y':
      return `~${target.value}`;
    case 'text': {
      const escaped = target.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return target.exact
        ? `-ios predicate string:label == "${escaped}" OR value == "${escaped}"`
        : `-ios predicate string:label CONTAINS "${escaped}" OR value CONTAINS "${escaped}"`;
    }
    case 'native': {
      // Explicitly non-portable: raw class chains, predicates or xpath. Route
      // a bare class chain / predicate through WebdriverIO's iOS strategies so
      // they are not misread as CSS; xpath and `~` pass through.
      const value = target.value;
      if (/^\*\*\//.test(value)) return `-ios class chain:${value}`;
      if (/^(type|name|label|value|visible)\s/.test(value) && !value.startsWith('//')) {
        return `-ios predicate string:${value}`;
      }
      return value;
    }
  }
}

/**
 * HID keyboard usages (page 0x07) for the semantic keys — the FAITHFUL iOS
 * implementation (contract 2.0), live-verified on iOS 18.6: Return commits
 * and dismisses the keyboard, Escape performs UIKit's hardware-Escape cancel,
 * Tab behaves as hardware Tab. Injected device-level via WDA's
 * performIoHidEvent — no hardware-keyboard setting required.
 */
export const IOS_HID_KEY_USAGES: Readonly<
  Record<import('@kraken-e2e/contracts').SemanticKey, number>
> = {
  enter: 0x28, // Keyboard Return
  escape: 0x29, // Keyboard Escape
  tab: 0x2b, // Keyboard Tab
};
