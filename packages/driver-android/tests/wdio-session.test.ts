import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DriverServices, ResolvedActor } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  AndroidUserSession,
  type WdioBrowserLike,
  type WdioElementLike,
} from '../src/wdio-session.ts';

function mockElement(overrides: Partial<WdioElementLike> = {}): WdioElementLike {
  return {
    elementId: 'el-1',
    click: vi.fn(async () => {}),
    setValue: vi.fn(async () => {}),
    getText: vi.fn(async () => 'hello'),
    isDisplayed: vi.fn(async () => true),
    isExisting: vi.fn(async () => true),
    waitForDisplayed: vi.fn(async () => true),
    waitForExist: vi.fn(async () => true),
    ...overrides,
  };
}

function harness(element: WdioElementLike = mockElement()) {
  const browser: WdioBrowserLike = {
    $: vi.fn(async () => element),
    execute: vi.fn(async () => undefined),
    takeScreenshot: vi.fn(async () => Buffer.from('png-bytes').toString('base64')),
    getPageSource: vi.fn(async () => '<hierarchy/>'),
    deleteSession: vi.fn(async () => {}),
  };
  const services: DriverServices = {
    runId: 'r',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-android-')),
    abort: new AbortController().signal,
    emit: () => {},
  };
  const actor: ResolvedActor = { id: 'alice', platform: 'android', config: {} };
  return { browser, session: new AndroidUserSession(browser, actor, services, 'com.app') };
}

describe('AndroidUserSession', () => {
  it('declares full support for the core surface (parity claim proven by CTK)', () => {
    const { session } = harness();
    expect(Object.values(session.capabilities).every((value) => value === 'supported')).toBe(true);
  });

  it('taps/types/reads through mapped UiAutomator2 selectors', async () => {
    const element = mockElement();
    const { browser, session } = harness(element);
    await session.tap({ by: 'testId', value: 'send' });
    await session.typeText({ by: 'testId', value: 'composer' }, 'hola');
    expect(await session.readText({ by: 'testId', value: 'composer' })).toBe('hello');
    expect(element.click).toHaveBeenCalledOnce();
    expect(element.setValue).toHaveBeenCalledWith('hola');
    expect(browser.$).toHaveBeenCalledWith(
      'android=new UiSelector().resourceIdMatches("(.*:id/)?send")',
    );
  });

  it('missing elements become KRK-SESSION-ELEMENT-NOT-FOUND with the selector in data', async () => {
    const missing = mockElement({
      elementId: undefined,
      error: { message: 'no such element' },
      isExisting: vi.fn(async () => false),
      // A truly-absent element also never comes into existence within the wait.
      waitForExist: vi.fn(async () => {
        throw new Error('still not existing');
      }),
    });
    const { session } = harness(missing);
    try {
      await session.tap({ by: 'testId', value: 'ghost' });
      expect.unreachable('must throw');
    } catch (error) {
      expect(KrakenError.is(error) && error.code).toBe('KRK-SESSION-ELEMENT-NOT-FOUND');
      expect(KrakenError.is(error) && error.data?.['selector']).toContain('ghost');
    }
  });

  it('an ACTION tolerates a render race: waits for a late-mounting target, then acts', async () => {
    // Not present on the first look, but waitForExist resolves — i.e. it
    // mounts a beat later (a button that enables after input, a screen
    // mid-transition). The action must succeed, not throw NOT-FOUND.
    const late = mockElement({
      elementId: undefined,
      isExisting: vi.fn(async () => false),
      waitForExist: vi.fn(async () => true),
    });
    const ready = mockElement();
    let call = 0;
    const browser: WdioBrowserLike = {
      // First $ returns the not-yet-there element; the re-fetch after the wait
      // returns the now-mounted one.
      $: vi.fn(async () => (call++ === 0 ? late : ready)),
      execute: vi.fn(async () => undefined),
      takeScreenshot: vi.fn(async () => 'x'),
      getPageSource: vi.fn(async () => '<hierarchy/>'),
      deleteSession: vi.fn(async () => {}),
    };
    const services: DriverServices = {
      runId: 'r',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-android-')),
      abort: new AbortController().signal,
      emit: () => {},
    };
    const session = new AndroidUserSession(
      browser,
      { id: 'alice', platform: 'android', config: {} },
      services,
      'com.app',
    );
    await session.tap({ by: 'text', value: 'Enter', exact: true });
    expect(late.waitForExist).toHaveBeenCalled();
    expect(ready.click).toHaveBeenCalledOnce();
  });

  it('waitFor maps states to waitForDisplayed/waitForExist and wraps timeouts', async () => {
    const element = mockElement({
      waitForDisplayed: vi.fn(async (options) => {
        if (options?.reverse) return true;
        throw new Error('still not displayed');
      }),
    });
    const { session } = harness(element);
    await session.waitFor({ by: 'testId', value: 'x' }, 'hidden', { timeoutMs: 50 });
    await expect(
      session.waitFor({ by: 'testId', value: 'x' }, 'visible', { timeoutMs: 50 }),
    ).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-SESSION-WAIT-TIMEOUT',
    );
    await session.waitFor({ by: 'testId', value: 'x' }, 'attached', { timeoutMs: 50 });
    expect(element.waitForExist).toHaveBeenCalled();
  });

  it('pressKey sends Android keycodes; navigate deep-links with the app package', async () => {
    const { browser, session } = harness();
    await session.pressKey('escape');
    expect(browser.execute).toHaveBeenCalledWith('mobile: pressKey', { keycode: 111 });
    await session.navigate('app://chat/42');
    expect(browser.execute).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'app://chat/42',
      package: 'com.app',
    });
  });

  it('screenshot writes a per-actor png and returns the ref', async () => {
    const { session } = harness();
    const artifact = await session.screenshot();
    expect(artifact.kind).toBe('screenshot');
    expect(artifact.path).toContain('alice');
    expect(artifact.path).toMatch(/android-[0-9a-f]{8}-1\.png$/);
  });

  it('dispose is idempotent and swallows dead-session errors', async () => {
    const browserFail: WdioBrowserLike = {
      ...harness().browser,
      deleteSession: vi.fn(async () => {
        throw new Error('session already gone');
      }),
    };
    const services: DriverServices = {
      runId: 'r',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-android-')),
      abort: new AbortController().signal,
      emit: () => {},
    };
    const session = new AndroidUserSession(
      browserFail,
      { id: 'a', platform: 'android', config: {} },
      services,
      undefined,
    );
    await session.dispose();
    await session.dispose(); // second call is a no-op
    expect(browserFail.deleteSession).toHaveBeenCalledOnce();
  });
});
