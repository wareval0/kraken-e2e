/**
 * Element hit-testing for `kraken inspect`: parse a session's page source
 * (Android uiautomator XML or iOS XCUI XML) into an element TREE with screen
 * bounds, find the smallest element containing a point, and rank the portable
 * Kraken locators that address it — preferring locators that identify exactly
 * ONE element on the screen.
 *
 * Pure functions over the source string — no driver knowledge, fully
 * unit-testable.
 */

export interface InspectedElement {
  /** Bounding box in device pixels (Android) or points (iOS). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly className: string;
  readonly a11y?: string;
  readonly resourceId?: string;
  readonly text?: string;
  /** iOS secondary text (the `value` when a distinct `label` is also present).
   *  The text locator matches `label OR value`, so uniqueness must count both. */
  readonly altText?: string;
  /** The raw value the device's accessibility-id selector matches (iOS `name`,
   *  which may echo the visible label). `a11y` is only set when it is a real
   *  identifier, but uniqueness/index math must count what `~value` actually
   *  matches on the device — that is this field. */
  readonly a11yMatch?: string;
  /** HTML id attribute (web only) — addressable via a native `#id` selector. */
  readonly htmlId?: string;
  /** Best stable CSS hook when there is no test id (web only): a
   *  [data-functional-selector=…] or name-based selector. */
  readonly cssHook?: string;
  /** Web only: this element lives inside a (same-origin) iframe. It can be
   *  identified but not tapped — Kraken has no cross-frame tap yet. */
  readonly frame?: boolean;
  readonly clickable?: boolean;
}

/**
 * An element plus its place in the tree. The parser wires `parent`/`children`
 * so the ranker can climb to the clickable container of a tap and look inside
 * it for a child label that uniquely identifies the item — essential on
 * Android, where a `resource-id` (`titleTextView`, `navigation_bar_item_…`) is
 * routinely shared across every row or tab.
 */
export interface ElementNode extends InspectedElement {
  readonly children: ElementNode[];
  parent?: ElementNode;
}

export interface LocatorCandidate {
  /** The Kraken TargetLocator, ready to paste. */
  readonly locator: { by: string; value: string; exact?: boolean };
  /** Why this candidate ranks where it does. */
  readonly rationale: string;
  readonly portable: boolean;
  /** Whether this locator matches exactly one element on the screen. Undefined
   *  when uniqueness was not evaluated (e.g. web, or no screen context). */
  readonly unique?: boolean;
  /** How many elements this locator matches on the current screen. */
  readonly matchCount?: number;
  /** A ready-to-paste Screen Object method for THIS candidate. */
  readonly snippet?: string;
}

export interface HitResult {
  readonly element: InspectedElement;
  readonly candidates: readonly LocatorCandidate[];
  /** A ready-to-paste Screen Object method using the best candidate. */
  readonly snippet: string;
}

const ATTR = (tag: string, name: string): string | undefined => {
  // Anchor the name on the left so a hyphenated superstring cannot match
  // (`\bclickable=` would otherwise also hit `long-clickable=`).
  const match = new RegExp(`(?<![-\\w])${name}="([^"]*)"`).exec(tag);
  const value = match?.[1];
  return value !== undefined && value !== '' ? decodeXml(value) : undefined;
};

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Short resource id: `pkg:id/name` → `name`, used for the portable testId. */
function shortId(resourceId: string): string {
  const marker = resourceId.indexOf(':id/');
  return marker >= 0 ? resourceId.slice(marker + 4) : resourceId;
}

// ---------------------------------------------------------------------------
// Parsing (source → tree)
// ---------------------------------------------------------------------------

/**
 * Walks open/self-closing/close tags with a stack so nesting is preserved.
 * `elementOf` returns the InspectedElement for a bounded tag, or null for a
 * structural wrapper (e.g. `<hierarchy>`) that has no bounds. Bounded nodes are
 * both wired into the tree and collected into a flat, document-order list for
 * hit-testing; structural wrappers keep the stack balanced without appearing.
 */
function buildTree(
  source: string,
  elementOf: (tag: string) => InspectedElement | null,
): ElementNode[] {
  // Comments and CDATA are opaque — a tag-shaped substring inside them is not
  // a real element.
  const clean = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const flat: ElementNode[] = [];
  const stack: { node: ElementNode | null; name: string }[] = [];
  // Quote-aware: attribute values are double-quoted and may contain a literal
  // '>' (iOS labels like "See all > Deals" — libxml2 does not escape '>'), so
  // the tag terminator is the first '>' OUTSIDE quotes. Consuming each quoted
  // attribute explicitly prevents the tag from being truncated mid-value.
  const tagRe = /<\/?[A-Za-z][\w.:$-]*(?:\s+[\w:.-]+(?:="[^"]*")?)*\s*\/?>/g;
  for (let m = tagRe.exec(clean); m !== null; m = tagRe.exec(clean)) {
    const tag = m[0];
    const name = /^<\/?([A-Za-z][\w.:$-]*)/.exec(tag)?.[1] ?? '';
    if (tag.startsWith('</')) {
      // Pop to the matching open tag so one stray tag cannot cascade.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]?.name === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const selfClosing = tag.endsWith('/>');
    const base = elementOf(tag);
    let node: ElementNode | null = null;
    if (base) {
      node = { ...base, children: [] };
      let parent: ElementNode | null = null;
      for (let i = stack.length - 1; i >= 0; i--) {
        const candidate = stack[i]?.node;
        if (candidate) {
          parent = candidate;
          break;
        }
      }
      if (parent) {
        node.parent = parent;
        parent.children.push(node);
      }
      flat.push(node);
    }
    if (!selfClosing) stack.push({ node, name });
  }
  return flat;
}

/**
 * Android (uiautomator2): tags are NAMED BY CLASS —
 * <android.widget.Button class=".." resource-id=".." content-desc=".."
 *  text=".." bounds="[x1,y1][x2,y2]" clickable="true"/> — so any element tag
 * carrying a bounds attribute counts (the legacy <node> dump format matches
 * the same way).
 */
function androidElement(tag: string): InspectedElement | null {
  const bounds = /bounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/.exec(tag);
  if (!bounds) return null;
  const x1 = Number(bounds[1]);
  const y1 = Number(bounds[2]);
  const x2 = Number(bounds[3]);
  const y2 = Number(bounds[4]);
  const a11y = ATTR(tag, 'content-desc');
  const resourceId = ATTR(tag, 'resource-id');
  const text = ATTR(tag, 'text');
  // Degenerate (zero/negative area) nodes are kept — they never win hit-testing
  // (the inside-check fails for zero width/height) but they ARE counted by the
  // device's own XPath/UiAutomator engines, so keeping them makes positional
  // and instance selectors index over the same universe the driver enumerates.
  return {
    x: x1,
    y: y1,
    width: Math.max(0, x2 - x1),
    height: Math.max(0, y2 - y1),
    className: ATTR(tag, 'class') ?? 'node',
    ...(a11y !== undefined ? { a11y } : {}),
    ...(resourceId !== undefined ? { resourceId } : {}),
    ...(text !== undefined ? { text } : {}),
    clickable: ATTR(tag, 'clickable') === 'true',
  };
}

/** iOS: <XCUIElementTypeButton name=".." label=".." value=".." x=".." y=".." width=".." height=".." …/> */
function iosElement(tag: string): InspectedElement | null {
  if (!/^<XCUIElementType/.test(tag)) return null;
  const x = Number(ATTR(tag, 'x') ?? Number.NaN);
  const y = Number(ATTR(tag, 'y') ?? Number.NaN);
  const width = Number(ATTR(tag, 'width') ?? Number.NaN);
  const height = Number(ATTR(tag, 'height') ?? Number.NaN);
  if ([x, y, width, height].some(Number.isNaN)) return null;
  const name = ATTR(tag, 'name');
  const label = ATTR(tag, 'label');
  const value = ATTR(tag, 'value');
  const text = label ?? value;
  // Appium's `name` is the accessibilityIdentifier only when one is set;
  // otherwise it mirrors the visible label/value. Treat it as an a11y id only
  // when it differs from the visible text — a label echoed into `name` is not a
  // stable identifier and must not be recommended above the (equivalent) text.
  const a11y = name !== undefined && name !== label && name !== value ? name : undefined;
  // The text locator matches `label OR value`; keep the distinct `value` so
  // uniqueness counts both fields the predicate will match.
  const altText = label !== undefined && value !== undefined && value !== label ? value : undefined;
  return {
    x,
    y,
    // Degenerate nodes are kept (see androidElement) to align positional indices.
    width: Math.max(0, width),
    height: Math.max(0, height),
    className: /<(XCUIElementType\w+)/.exec(tag)?.[1] ?? 'XCUIElement',
    ...(a11y !== undefined ? { a11y } : {}),
    // The raw name is retained for uniqueness/index math even when it echoes the
    // label (and is therefore NOT recommended as an a11y id) — `~name` /
    // `name == "x"` still match it on the device.
    ...(name !== undefined ? { a11yMatch: name } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(altText !== undefined ? { altText } : {}),
    clickable: ATTR(tag, 'enabled') !== 'false',
  };
}

export function parseAndroidSource(source: string): ElementNode[] {
  return buildTree(source, androidElement);
}

export function parseIosSource(source: string): ElementNode[] {
  return buildTree(source, iosElement);
}

export function parseSource(
  platformHint: 'android' | 'ios' | 'auto',
  source: string,
): ElementNode[] {
  if (platformHint === 'android') return parseAndroidSource(source);
  if (platformHint === 'ios') return parseIosSource(source);
  return source.includes('<XCUIElementType') ? parseIosSource(source) : parseAndroidSource(source);
}

// ---------------------------------------------------------------------------
// Hit-testing
// ---------------------------------------------------------------------------

/** The smallest element containing (x, y); clickable elements win ties. */
export function hitTest(
  elements: readonly InspectedElement[],
  x: number,
  y: number,
): InspectedElement | undefined {
  let best: InspectedElement | undefined;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const element of elements) {
    const inside =
      x >= element.x &&
      x < element.x + element.width &&
      y >= element.y &&
      y < element.y + element.height;
    if (!inside) continue;
    const area = element.width * element.height;
    if (area < bestArea || (area === bestArea && element.clickable && !best?.clickable)) {
      best = element;
      bestArea = area;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface RankOptions {
  /** All elements on the screen — enables uniqueness scoring. */
  readonly all?: readonly InspectedElement[];
  readonly platform?: 'android' | 'ios' | 'web' | 'auto';
}

/**
 * Rank the locator strategies that address an element, best first. With a
 * screen context (`all`) on a native platform, locators are ranked by
 * UNIQUENESS: a portable id that matches exactly one element wins, a shared id
 * (a repeated `resource-id`) is demoted and flagged, and when nothing is unique
 * the ranker disambiguates via the tappable container's child label or a native
 * indexed selector. Without a context it falls back to the simple strategy
 * order (used for web and for bare unit tests).
 */
export function rankLocators(element: InspectedElement, opts?: RankOptions): LocatorCandidate[] {
  if (opts?.all && (opts.platform === 'android' || opts.platform === 'ios')) {
    return smartRank(element as ElementNode, opts.all, opts.platform);
  }
  return basicRank(element);
}

/** Simple strategy-order ranking (no uniqueness) — web and context-free callers. */
function basicRank(element: InspectedElement): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  if (element.a11y) {
    candidates.push({
      locator: { by: 'a11y', value: element.a11y },
      rationale: 'accessibility id — portable across Android, iOS and Web',
      portable: true,
    });
  }
  if (element.resourceId) {
    candidates.push({
      locator: { by: 'testId', value: shortId(element.resourceId) },
      rationale: 'resource-id — portable when the same test id exists on other platforms',
      portable: true,
    });
  }
  if (element.text) {
    candidates.push({
      locator: { by: 'text', value: element.text, exact: true },
      rationale: 'visible text — portable but breaks under copy changes and localization',
      portable: true,
    });
  }
  if (element.cssHook) {
    candidates.push({
      locator: { by: 'native', value: element.cssHook },
      rationale: 'attribute selector (functional-selector / name) — stable, web-only (native CSS)',
      portable: false,
    });
  }
  if (element.htmlId) {
    candidates.push({
      locator: { by: 'native', value: `#${element.htmlId}` },
      rationale: 'HTML id — stable but web-only (a native CSS selector, not portable)',
      portable: false,
    });
  }
  if (candidates.length === 0) {
    candidates.push({
      locator: { by: 'native', value: `//${element.className}` },
      rationale:
        'no stable identifier on this element — last-resort class selector; prefer adding a test id to the app',
      portable: false,
    });
  }
  return candidates;
}

/** How many elements on the page each of the chosen element's candidate values
 *  matches — computed in the browser (see WEB_HIT_SCRIPT). Undefined ⇒ unknown,
 *  treated as unique. */
export interface WebCounts {
  readonly a11y?: number;
  readonly testId?: number;
  readonly text?: number;
  readonly cssHook?: number;
  readonly htmlId?: number;
}

/**
 * Uniqueness-aware ranking for WEB. Same principle as the mobile ranker: a
 * locator that matches exactly ONE element on the page wins, and one that
 * matches several (a `text` shared by a heading and a button, say) is demoted
 * and flagged — so the inspector never recommends an ambiguous selector.
 */
export function rankWebLocators(element: InspectedElement, counts: WebCounts): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  const add = (
    locator: LocatorCandidate['locator'],
    portable: boolean,
    count: number | undefined,
    rationale: string,
  ): void => {
    const n = count ?? 1;
    out.push({ locator, portable, unique: n === 1, matchCount: n, rationale });
  };
  if (element.a11y)
    add({ by: 'a11y', value: element.a11y }, true, counts.a11y, 'aria-label (accessibility id)');
  if (element.resourceId)
    add({ by: 'testId', value: element.resourceId }, true, counts.testId, 'data-testid');
  if (element.text)
    add(
      { by: 'text', value: element.text, exact: true },
      true,
      counts.text,
      'visible text — portable, but breaks under copy/localization changes',
    );
  if (element.cssHook)
    add(
      { by: 'native', value: element.cssHook },
      false,
      counts.cssHook,
      'attribute selector (functional-selector / name) — stable, web-only (native CSS)',
    );
  if (element.htmlId)
    add(
      { by: 'native', value: `#${element.htmlId}` },
      false,
      counts.htmlId,
      'HTML id — stable but web-only (a native CSS selector, not portable)',
    );
  if (out.length === 0)
    add(
      { by: 'native', value: `//${element.className}` },
      false,
      1,
      'no stable identifier on this element — last-resort class selector; prefer adding a test id',
    );
  return sortCandidates(out);
}

const escapeForUiSelector = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** iOS class-chain predicate string: like a UiSelector string but the backtick
 *  is the predicate delimiter, so it must be escaped too. */
const escapeForClassChain = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/"/g, '\\"');

/** Quote a value for an XPath attribute test, choosing a delimiter it lacks. */
function xpathLiteral(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `concat("${value.replace(/"/g, '", \'"\', "')}")`;
}

/** Nearest clickable element at or above `el` (Android/iOS tappable container). */
function clickableAncestor(el: ElementNode): ElementNode | undefined {
  let node: ElementNode | undefined = el;
  for (let i = 0; node && i < 8; i++) {
    // A zero-area container is not a real tap target — keep climbing.
    if (node.clickable && node.width > 0 && node.height > 0) return node;
    node = node.parent;
  }
  return undefined;
}

/** Count of elements for which `pred` holds. */
function countMatches(
  all: readonly InspectedElement[],
  pred: (e: InspectedElement) => boolean,
): number {
  let n = 0;
  for (const e of all) if (pred(e)) n++;
  return n;
}

/** 0-based index of `el` among elements matching `pred`, in document order; -1 if absent. */
function matchIndex(
  all: readonly InspectedElement[],
  pred: (e: InspectedElement) => boolean,
  el: InspectedElement,
): number {
  let k = 0;
  for (const e of all) {
    if (pred(e)) {
      if (e === el) return k;
      k++;
    }
  }
  return -1;
}

/**
 * The uniquely-identifying value of a VISIBLE descendant of `scope`, via `get`,
 * closest to a leaf (smallest box). Used to name a tappable container by its
 * child label ("Home", "Create your first kahoot") when the container itself
 * has no unique id. `count` reports how many elements the value matches ON THE
 * DEVICE (which may differ from a naive field compare — see `a11yMatch`).
 */
function uniqueDescendantValue(
  scope: ElementNode,
  get: (e: ElementNode) => string | undefined,
  count: (value: string) => number,
): string | undefined {
  const found: { value: string; area: number }[] = [];
  const walk = (node: ElementNode): void => {
    // Only CHOOSE visible (positive-area) nodes — a collapsed/off-screen child
    // must never be recommended over the visible label — but keep descending so
    // a visible grandchild is still reachable.
    if (node.width > 0 && node.height > 0) {
      const value = get(node);
      if (value !== undefined && count(value) === 1) {
        found.push({ value, area: node.width * node.height });
      }
    }
    for (const child of node.children) walk(child);
  };
  for (const child of scope.children) walk(child);
  found.sort((a, b) => a.area - b.area);
  return found[0]?.value;
}

/** Uniqueness-aware native ranking with tree-based disambiguation. */
function smartRank(
  element: ElementNode,
  all: readonly InspectedElement[],
  platform: 'android' | 'ios',
): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  // The device's accessibility-id selector matches the raw name (`a11yMatch`),
  // which may echo a label we chose not to recommend — count over that, not the
  // filtered `a11y`, so a shared name is never falsely reported unique.
  const nameKey = (e: InspectedElement): string | undefined => e.a11yMatch ?? e.a11y;
  const a11yCount = (v: string): number => countMatches(all, (e) => nameKey(e) === v);
  const ridCount = (v: string): number => countMatches(all, (e) => e.resourceId === v);
  // A text locator matches `label OR value` on iOS, so count both fields.
  const textCount = (v: string): number =>
    countMatches(all, (e) => e.text === v || e.altText === v);

  // A positional xpath by class. iOS page source has no `class` attribute — the
  // type IS the element name (and never contains the `$`/`.` that motivated the
  // @class predicate) — so address it as an element step there; Android carries
  // a real `class` attribute, addressed via a predicate so inner-class `$`/`.`
  // names still resolve.
  const classXPath = (oneBasedIndex: number): string =>
    platform === 'ios'
      ? `(//${element.className})[${oneBasedIndex}]`
      : `(//*[@class=${xpathLiteral(element.className)}])[${oneBasedIndex}]`;
  const classXPathSingle = (): string =>
    platform === 'ios'
      ? `//${element.className}`
      : `//*[@class=${xpathLiteral(element.className)}]`;

  const portableA11y = (value: string, rationale: string): void => {
    const n = a11yCount(value);
    out.push({
      locator: { by: 'a11y', value },
      rationale,
      portable: true,
      unique: n === 1,
      matchCount: n,
    });
  };
  const portableTestId = (resourceId: string, rationale: string): void => {
    const n = ridCount(resourceId);
    out.push({
      locator: { by: 'testId', value: shortId(resourceId) },
      rationale,
      portable: true,
      unique: n === 1,
      matchCount: n,
    });
  };
  const portableText = (value: string, rationale: string): void => {
    const n = textCount(value);
    out.push({
      locator: { by: 'text', value, exact: true },
      rationale,
      portable: true,
      unique: n === 1,
      matchCount: n,
    });
  };

  // 1. The element's own identifiers.
  if (element.a11y)
    portableA11y(element.a11y, 'accessibility id / content-desc — portable across platforms');
  if (element.resourceId)
    portableTestId(
      element.resourceId,
      'resource-id — portable when the same test id exists on other platforms',
    );
  if (element.text)
    portableText(
      element.text,
      'visible text — portable but breaks under copy changes and localization',
    );

  const hasUniquePortable = out.some((c) => c.portable && c.unique);

  // 2. Nothing on the element is unique → widen the search.
  if (!hasUniquePortable) {
    const container = clickableAncestor(element);
    if (container && container !== element) {
      if (container.a11y)
        portableA11y(container.a11y, 'accessibility id of the tappable container');
      if (container.resourceId)
        portableTestId(container.resourceId, 'resource-id of the tappable container');
      if (container.text) portableText(container.text, 'text of the tappable container');
    }
    // A child label that uniquely names the tappable item.
    const scope = container ?? element;
    const childText = uniqueDescendantValue(scope, (e) => e.text, textCount);
    if (childText !== undefined)
      out.push({
        locator: { by: 'text', value: childText, exact: true },
        rationale: 'text of a child label — uniquely identifies this item',
        portable: true,
        unique: true,
        matchCount: 1,
      });
    const childA11y = uniqueDescendantValue(scope, (e) => e.a11y, a11yCount);
    if (childA11y !== undefined)
      out.push({
        locator: { by: 'a11y', value: childA11y },
        rationale: 'accessibility id of a child — uniquely identifies this item',
        portable: true,
        unique: true,
        matchCount: 1,
      });

    // 3. Native, index-based disambiguators — unique by construction. Built
    //    per platform from the id that actually exists, and the index is
    //    counted with the SAME predicate the emitted selector enforces so the
    //    `[n]`/`.instance(n)` lands on the clicked element.
    if (platform === 'android' && element.resourceId) {
      const idx = matchIndex(all, (e) => e.resourceId === element.resourceId, element);
      if (idx >= 0)
        out.push({
          locator: {
            by: 'native',
            value: `new UiSelector().resourceId("${escapeForUiSelector(element.resourceId)}").instance(${idx})`,
          },
          rationale: 'indexed UiSelector — unique but order-dependent; prefer a stable id',
          portable: false,
          unique: true,
          matchCount: 1,
        });
    }
    // Android content-desc index — the only stable anchor for Flutter/Compose
    // elements that expose a (repeated) content-desc but no resource-id or text.
    if (platform === 'android' && element.a11y) {
      const idx = matchIndex(all, (e) => nameKey(e) === element.a11y, element);
      if (idx >= 0)
        out.push({
          locator: {
            by: 'native',
            value: `new UiSelector().description("${escapeForUiSelector(element.a11y)}").instance(${idx})`,
          },
          rationale:
            'indexed content-desc UiSelector — unique but order-dependent; prefer a stable id',
          portable: false,
          unique: true,
          matchCount: 1,
        });
    }
    if (platform === 'ios' && element.a11y) {
      // The class chain constrains BOTH type and name; count over the raw
      // device name (`a11yMatch`) — the `name == "x"` predicate matches labels
      // echoed into `name` that were dropped from `a11y`.
      const idx = matchIndex(
        all,
        (e) => nameKey(e) === element.a11y && e.className === element.className,
        element,
      );
      if (idx >= 0)
        out.push({
          locator: {
            by: 'native',
            value: `**/${element.className}[\`name == "${escapeForClassChain(element.a11y)}"\`][${idx + 1}]`,
          },
          rationale: 'indexed class chain — unique but order-dependent; prefer a stable id',
          portable: false,
          unique: true,
          matchCount: 1,
        });
    }
    // Positional xpath by class — last-resort unique.
    const classIdx = matchIndex(all, (e) => e.className === element.className, element);
    if (classIdx >= 0)
      out.push({
        locator: { by: 'native', value: classXPath(classIdx + 1) },
        rationale: 'positional xpath — unique but very brittle; add a test id to the app',
        portable: false,
        unique: true,
        matchCount: 1,
      });
  }

  // 4. No identifier at all → a class selector, indexed only if the class repeats.
  if (out.length === 0) {
    const classCount = countMatches(all, (e) => e.className === element.className);
    const value =
      classCount <= 1
        ? classXPathSingle()
        : classXPath(matchIndex(all, (e) => e.className === element.className, element) + 1);
    out.push({
      locator: { by: 'native', value },
      rationale:
        'no stable identifier on this element — last-resort class selector; prefer adding a test id to the app',
      portable: false,
      unique: classCount <= 1,
      matchCount: classCount,
    });
  }

  return sortCandidates(out);
}

/** Unique first, then portable, then by strategy (a11y > testId > text > native); de-duplicated. */
function sortCandidates(candidates: LocatorCandidate[]): LocatorCandidate[] {
  const strategyRank = (by: string): number =>
    by === 'a11y' ? 0 : by === 'testId' ? 1 : by === 'text' ? 2 : 3;
  const sorted = [...candidates].sort((a, b) => {
    const ua = a.unique ? 0 : 1;
    const ub = b.unique ? 0 : 1;
    if (ua !== ub) return ua - ub;
    const pa = a.portable ? 0 : 1;
    const pb = b.portable ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return strategyRank(a.locator.by) - strategyRank(b.locator.by);
  });
  const seen = new Set<string>();
  const deduped: LocatorCandidate[] = [];
  for (const candidate of sorted) {
    const key = `${candidate.locator.by}|${candidate.locator.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Snippets & assembly
// ---------------------------------------------------------------------------

/** A ready-to-paste Screen Object method for a candidate. */
export function pomSnippet(element: InspectedElement, best: LocatorCandidate): string {
  // Name the method after the human-readable value, not a raw native selector.
  const nameSource =
    best.locator.by === 'native'
      ? (element.a11y ??
        // Truthy check, not `!== undefined`: web element fields arrive as `null`
        // (WebDriver serializes `undefined` → `null` over the wire).
        (element.resourceId ? shortId(element.resourceId) : undefined) ??
        element.text ??
        'element')
      : best.locator.value;
  const methodBase = nameSource
    .replace(/[^a-zA-Z0-9]+(\w)/g, (_, c: string) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
  const method = methodBase.charAt(0).toLowerCase() + methodBase.slice(1) || 'element';
  const locatorLiteral = best.locator.exact
    ? `{ by: '${best.locator.by}', value: ${JSON.stringify(best.locator.value)}, exact: true }`
    : `{ by: '${best.locator.by}', value: ${JSON.stringify(best.locator.value)} }`;
  return [
    `// In your Screen/Page Object:`,
    `async tap${method.charAt(0).toUpperCase()}${method.slice(1)}(): Promise<void> {`,
    `  await this.session.tap(${locatorLiteral});`,
    `}`,
  ].join('\n');
}

/**
 * A plain, serializable copy of an element — WITHOUT the `parent`/`children`
 * tree links, which form a cycle that would make `JSON.stringify` throw when
 * the result is sent over the inspector's HTTP API.
 */
function plainElement(element: InspectedElement): InspectedElement {
  return {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    className: element.className,
    ...(element.a11y !== undefined ? { a11y: element.a11y } : {}),
    ...(element.resourceId !== undefined ? { resourceId: element.resourceId } : {}),
    ...(element.text !== undefined ? { text: element.text } : {}),
    ...(element.altText !== undefined ? { altText: element.altText } : {}),
    ...(element.a11yMatch !== undefined ? { a11yMatch: element.a11yMatch } : {}),
    ...(element.htmlId !== undefined ? { htmlId: element.htmlId } : {}),
    ...(element.cssHook !== undefined ? { cssHook: element.cssHook } : {}),
    ...(element.frame !== undefined ? { frame: element.frame } : {}),
    ...(element.clickable !== undefined ? { clickable: element.clickable } : {}),
  };
}

/** Attach a per-candidate snippet and pick the best candidate's as the default. */
export function toHitResult(
  element: InspectedElement,
  candidates: readonly LocatorCandidate[],
): HitResult {
  const flat = plainElement(element);
  const withSnippets = candidates.map((candidate) => ({
    ...candidate,
    snippet: pomSnippet(flat, candidate),
  }));
  const first = withSnippets[0] as LocatorCandidate;
  return { element: flat, candidates: withSnippets, snippet: first.snippet as string };
}

export function identify(
  elements: readonly InspectedElement[],
  x: number,
  y: number,
  platform?: 'android' | 'ios' | 'web' | 'auto',
): HitResult | undefined {
  const element = hitTest(elements, x, y);
  if (!element) return undefined;
  const candidates = rankLocators(
    element,
    platform === 'android' || platform === 'ios' ? { all: elements, platform } : undefined,
  );
  return toHitResult(element, candidates);
}
