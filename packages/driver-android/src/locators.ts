import { KrakenError, type SemanticKey, type TargetLocator } from '@kraken-e2e/contracts';

/**
 * Portable locator strategies → UiAutomator2 selectors (ADR-0002 D1 mapping:
 * testId → resource-id, a11y → content-desc, text → visible text).
 *
 * Unqualified resource ids ("composer") are matched with a regex against the
 * `<package>:id/<value>` convention, so feature files stay package-agnostic.
 */
export function toAndroidSelector(target: TargetLocator): string {
  switch (target.by) {
    case 'testId':
      // A qualified id (`pkg:id/name`) is matched verbatim. An unqualified id
      // matches BOTH the classic `pkg:id/name` shape AND a bare id — Jetpack
      // Compose's `testTagsAsResourceId` exposes `Modifier.testTag("x")` as a
      // resource-id of just `x`, with no package. The value is regex-escaped so
      // a tag with `.`/`(`/`+` (common in Compose/Flutter) is matched literally.
      return target.value.includes(':id/')
        ? `android=new UiSelector().resourceId("${escapeForUiSelector(target.value)}")`
        : `android=new UiSelector().resourceIdMatches("(.*:id/)?${escapeForUiSelector(escapeForRegex(target.value))}")`;
    case 'text':
      return target.exact
        ? `android=new UiSelector().text("${escapeForUiSelector(target.value)}")`
        : `android=new UiSelector().textContains("${escapeForUiSelector(target.value)}")`;
    case 'a11y':
      return `~${target.value}`;
    case 'native': {
      // Explicitly non-portable: any raw WebdriverIO/Appium selector.
      // Route a bare UiAutomator source string through WebdriverIO's
      // `android=` strategy so it is not misread as a CSS selector; xpath,
      // accessibility (`~`) and already-prefixed selectors pass through.
      const value = target.value;
      if (/^\s*new UiSelector\(/.test(value) || /^\s*new UiScrollable\(/.test(value)) {
        return `android=${value}`;
      }
      return value;
    }
  }
}

function escapeForUiSelector(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape regex metacharacters so a value is matched literally inside
 *  `resourceIdMatches(...)` (Compose/Flutter tags may contain `.`, `(`, `+`…). */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Android key codes for the semantic keys (contract 2.0). KEYCODE_BACK (4)
 * is intentionally absent — 'back' left SemanticKey (Android-only concept);
 * it remains reachable via { by: 'native' } flows or native() (ADR-0007).
 */
export const ANDROID_KEY_CODES: Readonly<Record<SemanticKey, number>> = {
  enter: 66, // KEYCODE_ENTER
  escape: 111, // KEYCODE_ESCAPE
  tab: 61, // KEYCODE_TAB
};

export function keyCodeFor(key: SemanticKey): number {
  const code = ANDROID_KEY_CODES[key];
  if (code === undefined) {
    throw new KrakenError(
      'KRK-SESSION-OP-UNSUPPORTED',
      `Unknown semantic key "${key}" for Android.`,
    );
  }
  return code;
}
