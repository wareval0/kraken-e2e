import { describe, expect, it } from 'vitest';

import {
  type ElementNode,
  type InspectedElement,
  identify,
  type LocatorCandidate,
  parseAndroidSource,
  parseIosSource,
  pomSnippet,
  rankLocators,
  rankWebLocators,
  toHitResult,
} from '../src/inspect/hit-test.ts';
import { normalizeWebElement } from '../src/inspect/server.ts';

/**
 * A Kahoot-like dashboard: two cards whose title TextViews SHARE the
 * `titleTextView` resource-id (only the visible text differs), plus a bottom
 * navigation bar whose items all share `navigation_bar_item_*` ids and are
 * told apart only by their child label. This is exactly the case where a
 * resource-id is NOT a usable identifier.
 */
const DASHBOARD = `<?xml version='1.0'?>
<hierarchy class="hierarchy" rotation="0" width="1080" height="2400">
  <android.widget.FrameLayout class="android.widget.FrameLayout" resource-id="pkg:id/root" bounds="[0,0][1080,2400]" clickable="false">
    <android.widget.LinearLayout class="android.widget.LinearLayout" resource-id="pkg:id/card" bounds="[0,100][1080,300]" clickable="true">
      <android.widget.TextView class="android.widget.TextView" resource-id="pkg:id/titleTextView" text="Create your first kahoot" bounds="[40,140][350,234]" clickable="false"/>
    </android.widget.LinearLayout>
    <android.widget.LinearLayout class="android.widget.LinearLayout" resource-id="pkg:id/card" bounds="[0,320][1080,520]" clickable="true">
      <android.widget.TextView class="android.widget.TextView" resource-id="pkg:id/titleTextView" text="Host a kahoot with 3+ participants" bounds="[40,360][346,454]" clickable="false"/>
    </android.widget.LinearLayout>
    <android.widget.FrameLayout class="android.widget.FrameLayout" resource-id="pkg:id/bottom_nav" bounds="[0,2200][1080,2400]" clickable="false">
      <android.view.ViewGroup class="android.view.ViewGroup" resource-id="pkg:id/navigation_bar_item" bounds="[0,2200][270,2400]" clickable="true">
        <android.widget.FrameLayout class="android.widget.FrameLayout" resource-id="pkg:id/navigation_bar_item_icon_container" bounds="[88,2240][182,2334]" clickable="false"/>
        <android.view.ViewGroup class="android.view.ViewGroup" resource-id="pkg:id/navigation_bar_item_labels_group" bounds="[85,2340][185,2375]" clickable="false">
          <android.widget.TextView class="android.widget.TextView" resource-id="pkg:id/nav_label" text="Home" bounds="[95,2345][175,2370]" clickable="false"/>
        </android.view.ViewGroup>
      </android.view.ViewGroup>
      <android.view.ViewGroup class="android.view.ViewGroup" resource-id="pkg:id/navigation_bar_item" bounds="[270,2200][540,2400]" clickable="true">
        <android.widget.FrameLayout class="android.widget.FrameLayout" resource-id="pkg:id/navigation_bar_item_icon_container" bounds="[358,2240][452,2334]" clickable="false"/>
        <android.view.ViewGroup class="android.view.ViewGroup" resource-id="pkg:id/navigation_bar_item_labels_group" bounds="[355,2340][455,2375]" clickable="false">
          <android.widget.TextView class="android.widget.TextView" resource-id="pkg:id/nav_label" text="Discover" bounds="[360,2345][450,2370]" clickable="false"/>
        </android.view.ViewGroup>
      </android.view.ViewGroup>
    </android.widget.FrameLayout>
  </android.widget.FrameLayout>
</hierarchy>`;

const byLocator = (
  candidates: readonly LocatorCandidate[],
  by: string,
  value: string,
): LocatorCandidate | undefined =>
  candidates.find((c) => c.locator.by === by && c.locator.value === value);

describe('tree parsing', () => {
  it('wires parent/children so a label knows its tappable container', () => {
    const nodes = parseAndroidSource(DASHBOARD);
    const home = nodes.find((n) => n.text === 'Home') as ElementNode;
    expect(home).toBeDefined();
    // climb: label → labels_group → navigation_bar_item (the clickable item)
    const item = home.parent?.parent as ElementNode;
    expect(item.resourceId).toBe('pkg:id/navigation_bar_item');
    expect(item.clickable).toBe(true);
  });

  it('keeps the flat list to bounded elements only (no <hierarchy> wrapper)', () => {
    const nodes = parseAndroidSource(DASHBOARD);
    expect(nodes.every((n) => n.width > 0 && n.height > 0)).toBe(true);
    expect(nodes.some((n) => n.className === 'hierarchy')).toBe(false);
  });
});

describe('uniqueness-aware ranking (Android)', () => {
  it('recommends the unique visible text over a shared resource-id', () => {
    const nodes = parseAndroidSource(DASHBOARD);
    const hit = identify(nodes, 200, 180, 'android'); // inside the first title
    const best = hit?.candidates[0];
    expect(best?.locator).toEqual({ by: 'text', value: 'Create your first kahoot', exact: true });
    expect(best?.unique).toBe(true);

    // the shared resource-id is still shown, but demoted and flagged non-unique
    const shared = byLocator(hit?.candidates ?? [], 'testId', 'titleTextView');
    expect(shared?.unique).toBe(false);
    expect(shared?.matchCount).toBe(2);
    // …and it ranks below the unique text
    const bestIndex = 0;
    const sharedIndex = hit?.candidates.indexOf(shared as LocatorCandidate) ?? -1;
    expect(sharedIndex).toBeGreaterThan(bestIndex);
  });

  it('names a bottom-nav item by its child label when the item id repeats', () => {
    const nodes = parseAndroidSource(DASHBOARD);
    // click the ICON container of the first tab — it has no text of its own
    const hit = identify(nodes, 135, 2287, 'android');
    const best = hit?.candidates[0];
    expect(best?.locator).toEqual({ by: 'text', value: 'Home', exact: true });
    expect(best?.unique).toBe(true);
    expect(hit?.snippet).toContain(
      'await this.session.tap({ by: \'text\', value: "Home", exact: true });',
    );
    expect(hit?.snippet).toContain('async tapHome');
  });

  it('falls back to an indexed UiSelector when nothing is unique', () => {
    const ICONS = `<hierarchy width="200" height="100">
      <android.widget.ImageButton class="android.widget.ImageButton" resource-id="pkg:id/fav" bounds="[0,0][100,100]" clickable="true"/>
      <android.widget.ImageButton class="android.widget.ImageButton" resource-id="pkg:id/fav" bounds="[100,0][200,100]" clickable="true"/>
    </hierarchy>`;
    const nodes = parseAndroidSource(ICONS);
    const hit = identify(nodes, 150, 50, 'android'); // the second icon
    const best = hit?.candidates[0];
    expect(best?.locator.by).toBe('native');
    expect(best?.locator.value).toBe('new UiSelector().resourceId("pkg:id/fav").instance(1)');
    expect(best?.unique).toBe(true);
    // the raw shared id is present but flagged
    expect(byLocator(hit?.candidates ?? [], 'testId', 'fav')?.unique).toBe(false);
  });
});

describe('iOS smart ranking', () => {
  it('uses the accessibility id when it is unique, and an indexed class chain when it is not', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton name="button-LOGIN" label="LOGIN" x="20" y="300" width="350" height="48" enabled="true"/>
      <XCUIElementTypeCell name="row" label="A" x="0" y="400" width="390" height="60" enabled="true"/>
      <XCUIElementTypeCell name="row" label="B" x="0" y="460" width="390" height="60" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);

    const login = identify(nodes, 100, 320, 'ios');
    expect(login?.candidates[0]?.locator).toEqual({ by: 'a11y', value: 'button-LOGIN' });
    expect(login?.candidates[0]?.unique).toBe(true);

    // The two cells share name "row"; label "A" is unique so it wins, and the
    // shared name is flagged non-unique.
    const rowA = identify(nodes, 100, 430, 'ios');
    expect(rowA?.candidates[0]?.locator).toEqual({ by: 'text', value: 'A', exact: true });
    expect(byLocator(rowA?.candidates ?? [], 'a11y', 'row')?.unique).toBe(false);
  });

  it('offers an indexed class chain when name AND label both repeat', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeCell name="row" label="Item" x="0" y="100" width="390" height="60" enabled="true"/>
      <XCUIElementTypeCell name="row" label="Item" x="0" y="160" width="390" height="60" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);
    const second = identify(nodes, 100, 190, 'ios'); // the second identical cell
    const best = second?.candidates[0];
    expect(best?.locator).toEqual({
      by: 'native',
      value: '**/XCUIElementTypeCell[`name == "row"`][2]',
    });
    expect(best?.unique).toBe(true);
  });
});

describe('toHitResult', () => {
  it('attaches a snippet to every candidate and defaults to the best', () => {
    const nodes = parseAndroidSource(DASHBOARD);
    const hit = identify(nodes, 200, 180, 'android');
    expect(hit?.candidates.every((c) => typeof c.snippet === 'string')).toBe(true);
    expect(hit?.snippet).toBe(hit?.candidates[0]?.snippet);
  });

  it('is a thin wrapper over rankLocators for web (no uniqueness context)', () => {
    const el = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      className: 'button',
      a11y: 'Save',
    };
    const result = toHitResult(el, rankLocators(el));
    expect(result.candidates[0]?.locator).toEqual({ by: 'a11y', value: 'Save' });
    expect(result.candidates[0]?.snippet).toContain('async tapSave');
  });

  it('returns a plain, JSON-serializable element (no parent/children cycle)', () => {
    const nodes = parseAndroidSource(DASHBOARD);
    const hit = identify(nodes, 200, 180, 'android');
    // The API sends this over HTTP; a cyclic tree node would throw here.
    expect(() => JSON.stringify(hit)).not.toThrow();
    expect(hit?.element).not.toHaveProperty('children');
    expect(hit?.element).not.toHaveProperty('parent');
  });
});

describe('hardening (verification findings)', () => {
  it('reads clickable correctly even when long-clickable precedes it', () => {
    const XML = `<hierarchy width="100" height="100">
      <android.widget.Button class="android.widget.Button" long-clickable="true" clickable="false" bounds="[0,0][100,100]"/>
    </hierarchy>`;
    const nodes = parseAndroidSource(XML);
    expect(nodes[0]?.clickable).toBe(false);
  });

  it('does not truncate a tag on a literal ">" inside an attribute value', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton name="seeAll" label="See all > Deals" x="20" y="100" width="350" height="48" enabled="true"/>
      <XCUIElementTypeButton name="ok" label="OK" x="20" y="200" width="350" height="48" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);
    expect(nodes).toHaveLength(3); // Application + 2 buttons
    expect(nodes.find((n) => n.a11y === 'seeAll')).toBeDefined();
  });

  it('ignores element-shaped markup inside comments', () => {
    const XML = `<hierarchy width="100" height="100">
      <!-- <android.widget.Button class="android.widget.Button" text="GHOST" bounds="[0,0][100,100]" clickable="true"/> -->
      <android.widget.TextView class="android.widget.TextView" text="real" bounds="[0,0][50,50]"/>
    </hierarchy>`;
    const nodes = parseAndroidSource(XML);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.text).toBe('real');
  });

  it('does not present an iOS name that merely echoes the visible label as an a11y id', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton name="Login" label="Login" x="20" y="100" width="350" height="48" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);
    const hit = identify(nodes, 100, 120, 'ios');
    expect(hit?.candidates.every((c) => c.locator.by !== 'a11y')).toBe(true);
    expect(hit?.candidates[0]?.locator).toEqual({ by: 'text', value: 'Login', exact: true });
  });

  it('anchors a repeated Android content-desc (Flutter/Compose) with an indexed UiSelector', () => {
    const XML = `<hierarchy width="1080" height="2400">
      <android.view.View class="android.view.View" content-desc="Delete" bounds="[0,100][100,200]" clickable="true"/>
      <android.view.View class="android.view.View" content-desc="Delete" bounds="[0,300][100,400]" clickable="true"/>
    </hierarchy>`;
    const nodes = parseAndroidSource(XML);
    const hit = identify(nodes, 50, 350, 'android'); // the second one
    expect(hit?.candidates[0]?.locator).toEqual({
      by: 'native',
      value: 'new UiSelector().description("Delete").instance(1)',
    });
    expect(byLocator(hit?.candidates ?? [], 'a11y', 'Delete')?.unique).toBe(false);
  });

  it('uses an @class predicate xpath so inner-class ($) names still resolve', () => {
    const XML = `<hierarchy width="200" height="100">
      <android.widget.Toolbar$NavButtonView class="android.widget.Toolbar$NavButtonView" bounds="[0,0][100,100]" clickable="true"/>
      <android.widget.Toolbar$NavButtonView class="android.widget.Toolbar$NavButtonView" bounds="[100,0][200,100]" clickable="true"/>
    </hierarchy>`;
    const nodes = parseAndroidSource(XML);
    const hit = identify(nodes, 150, 50, 'android'); // the second one
    expect(hit?.candidates[0]?.locator).toEqual({
      by: 'native',
      value: '(//*[@class="android.widget.Toolbar$NavButtonView"])[2]',
    });
  });

  it('counts iOS text uniqueness across label OR value (predicate semantics)', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeStaticText label="Go" x="0" y="100" width="100" height="30" enabled="true"/>
      <XCUIElementTypeButton name="continue" label="Continue" value="Go" x="0" y="200" width="100" height="40" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);
    const hit = identify(nodes, 50, 115, 'ios'); // the StaticText, text "Go"
    // "Go" also matches the button's value → NOT unique, must be flagged.
    expect(byLocator(hit?.candidates ?? [], 'text', 'Go')?.unique).toBe(false);
  });

  it('iOS positional fallback addresses the type as an element step (no @class)', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeStaticText label="Item" x="0" y="100" width="390" height="30" enabled="true"/>
      <XCUIElementTypeStaticText label="Item" x="0" y="140" width="390" height="30" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);
    const hit = identify(nodes, 100, 150, 'ios'); // 2nd identical static text (no name)
    // iOS source has no @class attribute — must use the type as the node test.
    expect(hit?.candidates[0]?.locator).toEqual({
      by: 'native',
      value: '(//XCUIElementTypeStaticText)[2]',
    });
    expect(hit?.candidates[0]?.unique).toBe(true);
  });

  it('flags an iOS name shared via a label echo as non-unique (device ~name semantics)', () => {
    const IOS = `<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
      <XCUIElementTypeButton name="Save" label="Confirm" x="0" y="100" width="100" height="40" enabled="true"/>
      <XCUIElementTypeButton name="Save" label="Save" x="0" y="200" width="100" height="40" enabled="true"/>
    </XCUIElementTypeApplication>`;
    const nodes = parseIosSource(IOS);
    // First button: name "Save" is a real id (differs from its label "Confirm").
    const hit = identify(nodes, 50, 120, 'ios');
    const a11y = byLocator(hit?.candidates ?? [], 'a11y', 'Save');
    // The 2nd button's name ALSO equals "Save" (echoing its label), so ~Save
    // matches two elements — the a11y must be reported non-unique.
    expect(a11y?.unique).toBe(false);
    expect(a11y?.matchCount).toBe(2);
    // and the unique label wins the recommendation
    expect(hit?.candidates[0]?.locator).toEqual({ by: 'text', value: 'Confirm', exact: true });
  });

  it('never recommends an invisible (zero-area) child label over the visible one', () => {
    const XML = `<hierarchy width="1080" height="2400">
      <android.view.ViewGroup class="android.view.ViewGroup" resource-id="pkg:id/item" bounds="[0,100][300,300]" clickable="true">
        <android.widget.TextView class="android.widget.TextView" text="Hidden" bounds="[0,0][0,0]"/>
        <android.widget.TextView class="android.widget.TextView" text="Visible" bounds="[10,110][290,290]"/>
      </android.view.ViewGroup>
      <android.view.ViewGroup class="android.view.ViewGroup" resource-id="pkg:id/item" bounds="[0,320][300,520]" clickable="true">
        <android.widget.TextView class="android.widget.TextView" text="Other" bounds="[10,330][290,510]"/>
      </android.view.ViewGroup>
    </hierarchy>`;
    const nodes = parseAndroidSource(XML);
    const hit = identify(nodes, 5, 105, 'android'); // inside the container, off the visible label
    expect(hit?.candidates[0]?.locator).toEqual({ by: 'text', value: 'Visible', exact: true });
  });
});

describe('web inspect null-safety (WebDriver serializes undefined → null)', () => {
  it('normalizeWebElement drops null/empty fields and keeps the frame flag', () => {
    const el = normalizeWebElement({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      className: 'input',
      a11y: null,
      resourceId: null,
      text: '',
      htmlId: null,
      cssHook: '[data-functional-selector="username-input-field__input"]',
      frame: true,
      clickable: true,
    });
    expect(el.a11y).toBeUndefined();
    expect(el.resourceId).toBeUndefined();
    expect(el.text).toBeUndefined();
    expect(el.cssHook).toBe('[data-functional-selector="username-input-field__input"]');
    expect(el.frame).toBe(true);
    // The whole point: this must be JSON-serializable for the HTTP API.
    expect(() => JSON.stringify(toHitResult(el, rankLocators(el)))).not.toThrow();
  });

  it('rankWebLocators recommends a UNIQUE attribute over an ambiguous shared text', () => {
    // The Kahoot login button: text "Log in" is shared by the card heading and
    // the submit button (matches 2), while its functional-selector is unique.
    const el = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      className: 'button',
      text: 'Log in',
      cssHook: '[data-functional-selector="sign-in-button"]',
    };
    const cands = rankWebLocators(el, { text: 2, cssHook: 1 });
    expect(cands[0]?.locator).toEqual({
      by: 'native',
      value: '[data-functional-selector="sign-in-button"]',
    });
    expect(cands[0]?.unique).toBe(true);
    expect(byLocator(cands, 'text', 'Log in')?.unique).toBe(false);
    expect(byLocator(cands, 'text', 'Log in')?.matchCount).toBe(2);
  });

  it('rankWebLocators keeps a unique portable text ahead of an equally-unique css hook', () => {
    const el = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      className: 'a',
      text: 'Library',
      cssHook: '[data-functional-selector="side-bar-link__library"]',
    };
    const cands = rankWebLocators(el, { text: 1, cssHook: 1 });
    expect(cands[0]?.locator).toEqual({ by: 'text', value: 'Library', exact: true });
  });

  it('pomSnippet does not crash when a native element has a null resource-id', () => {
    // Simulates the raw shape before normalization (fields arrive as null).
    const el = {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      className: 'input',
      resourceId: null,
      text: null,
      cssHook: '[data-functional-selector="x"]',
    } as unknown as InspectedElement;
    const candidate: LocatorCandidate = {
      locator: { by: 'native', value: '[data-functional-selector="x"]' },
      rationale: '',
      portable: false,
    };
    expect(() => pomSnippet(el, candidate)).not.toThrow();
    expect(pomSnippet(el, candidate)).toContain('async tapElement');
  });
});
