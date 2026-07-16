import type { SemanticKey, TargetLocator } from '@kraken-e2e/contracts';

/**
 * Portable locator strategies → WebdriverIO web selectors (ADR-0002 D1
 * mapping: testId → data-testid, a11y → aria-label, text → an XPath over any
 * element's text).
 *
 * The text strategy is deliberately NOT WebdriverIO's `=text`/`*=text`: those
 * are LINK-TEXT selectors and match `<a>` elements only — a `text` locator
 * aimed at a `<button>Start</button>` or a `<div>Kraken e2e</div>` silently
 * finds nothing (a real-world footgun this replaced). The XPath below matches
 * the INNERMOST element whose whitespace-normalised text equals (or contains)
 * the value: the innermost condition keeps a wrapping container from shadowing
 * the actual label, and clicking the label bubbles to its control.
 */
export function toWebSelector(target: TargetLocator): string {
  switch (target.by) {
    case 'testId':
      return `[data-testid="${cssEscape(target.value)}"]`;
    case 'text': {
      const literal = xpathLiteral(target.value);
      const match = target.exact
        ? `normalize-space(.)=${literal}`
        : `contains(normalize-space(.), ${literal})`;
      return `//*[${match} and not(.//*[${match}]) and not(self::script) and not(self::style)]`;
    }
    case 'a11y':
      return `[aria-label="${cssEscape(target.value)}"]`;
    case 'native':
      // Explicitly non-portable: any raw CSS/XPath/WDIO selector.
      return target.value;
  }
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Quote a value as an XPath string literal, whichever quotes it contains. */
function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat("${value.replace(/"/g, `", '"', "`)}")`;
}

/**
 * WebDriver key codepoints (the W3C 'keys' action semantics) — hardware-key
 * faithful on web, same set as the mobile drivers (contract 2.0).
 */
export const WEB_KEY_CODES: Readonly<Record<SemanticKey, string>> = {
  enter: '\uE007', // WebDriver Enter
  escape: '\uE00C', // WebDriver Escape
  tab: '\uE004', // WebDriver Tab
};
