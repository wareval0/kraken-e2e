import { describe, expect, it } from 'vitest';
import type { InspectedElement } from '../src/inspect/hit-test.ts';

import {
  hitTest,
  identify,
  parseAndroidSource,
  parseIosSource,
  rankLocators,
} from '../src/inspect/hit-test.ts';

// The REAL uiautomator2 format: tags named by class (probed live).
const ANDROID = `<?xml version='1.0'?>
<hierarchy index="0" class="hierarchy" rotation="0" width="1080" height="2400">
  <android.widget.FrameLayout class="android.widget.FrameLayout" text="" bounds="[0,0][1080,2400]" clickable="false"/>
  <android.widget.EditText class="android.widget.EditText" resource-id="com.app:id/email" text="user@x.io" bounds="[100,500][980,620]" clickable="true"/>
  <android.widget.Button class="android.widget.Button" content-desc="button-LOGIN" text="LOGIN" bounds="[100,700][980,820]" clickable="true"/>
  <android.view.View class="android.view.View" text="" bounds="[0,900][1080,1000]" clickable="false"/>
</hierarchy>`;

const IOS = `<?xml version="1.0"?>
<XCUIElementTypeApplication name="Demo" x="0" y="0" width="390" height="844">
  <XCUIElementTypeTextField name="input-email" value="user@x.io" x="20" y="200" width="350" height="44" enabled="true"/>
  <XCUIElementTypeButton name="button-LOGIN" label="LOGIN" x="20" y="300" width="350" height="48" enabled="true"/>
  <XCUIElementTypeStaticText label="plain text" x="20" y="400" width="350" height="20" enabled="true"/>
</XCUIElementTypeApplication>`;

describe('parseAndroidSource', () => {
  it('extracts bounds, ids and clickability', () => {
    const elements = parseAndroidSource(ANDROID);
    expect(elements).toHaveLength(4);
    const login = elements.find((e) => e.a11y === 'button-LOGIN');
    expect(login).toMatchObject({ x: 100, y: 700, width: 880, height: 120, clickable: true });
    expect(elements.find((e) => e.resourceId === 'com.app:id/email')?.text).toBe('user@x.io');
  });
});

describe('parseIosSource', () => {
  it('extracts frames, names and labels', () => {
    const elements = parseIosSource(IOS);
    expect(elements).toHaveLength(4);
    const login = elements.find((e) => e.a11y === 'button-LOGIN');
    expect(login).toMatchObject({ x: 20, y: 300, width: 350, height: 48, text: 'LOGIN' });
  });
});

describe('hitTest', () => {
  it('returns the SMALLEST element containing the point', () => {
    const elements = parseAndroidSource(ANDROID);
    // (500, 760) is inside both the fullscreen frame and the LOGIN button
    expect(hitTest(elements, 500, 760)?.a11y).toBe('button-LOGIN');
    // outside everything but the root frame
    expect(hitTest(elements, 500, 2300)?.className).toBe('android.widget.FrameLayout');
    expect(hitTest(elements, 5000, 5000)).toBeUndefined();
  });
});

describe('rankLocators', () => {
  it('ranks a11y first, then testId, then text; native only as last resort', () => {
    const elements = parseAndroidSource(ANDROID);
    const login = rankLocators(elements.find((e) => e.a11y === 'button-LOGIN') as InspectedElement);
    expect(login[0]?.locator).toEqual({ by: 'a11y', value: 'button-LOGIN' });
    expect(login.at(-1)?.locator.by).toBe('text');

    const email = rankLocators(elements.find((e) => e.resourceId) as InspectedElement);
    expect(email[0]?.locator).toEqual({ by: 'testId', value: 'email' }); // package prefix stripped

    const bare = rankLocators(
      elements.find((e) => e.className === 'android.view.View') as InspectedElement,
    );
    expect(bare[0]?.locator.by).toBe('native');
    expect(bare[0]?.portable).toBe(false);
  });
});

describe('identify', () => {
  it('produces a paste-ready Screen Object snippet for the best candidate', () => {
    const elements = parseIosSource(IOS);
    const hit = identify(elements, 100, 320);
    expect(hit?.candidates[0]?.locator).toEqual({ by: 'a11y', value: 'button-LOGIN' });
    expect(hit?.snippet).toContain(
      'await this.session.tap({ by: \'a11y\', value: "button-LOGIN" });',
    );
    expect(hit?.snippet).toContain('async tapButtonLOGIN');
  });
});
