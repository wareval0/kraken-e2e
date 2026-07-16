import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DriverServices, ResolvedActor } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it, vi } from 'vitest';

import { type WdioBrowserLike, type WdioElementLike, WebUserSession } from '../src/wdio-session.ts';

function mockElement(overrides: Partial<WdioElementLike> = {}): WdioElementLike {
  return {
    elementId: 'el-1',
    click: vi.fn(async () => {}),
    setValue: vi.fn(async () => {}),
    getText: vi.fn(async () => 'hello'),
    getValue: vi.fn(async () => 'typed-value'),
    isDisplayed: vi.fn(async () => true),
    isExisting: vi.fn(async () => true),
    scrollIntoView: vi.fn(async () => {}),
    waitForDisplayed: vi.fn(async () => true),
    waitForExist: vi.fn(async () => true),
    ...overrides,
  };
}

function harness(element: WdioElementLike = mockElement()) {
  const browser: WdioBrowserLike = {
    $: vi.fn(async () => element),
    keys: vi.fn(async () => {}),
    url: vi.fn(async () => undefined),
    takeScreenshot: vi.fn(async () => Buffer.from('png').toString('base64')),
    getPageSource: vi.fn(async () => '<html/>'),
    execute: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => {}),
  };
  const services: DriverServices = {
    runId: 'r',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-web-')),
    abort: new AbortController().signal,
    emit: () => {},
  };
  const actor: ResolvedActor = { id: 'carol', platform: 'web', config: {} };
  return { browser, element, session: new WebUserSession(browser, actor, services) };
}

describe('WebUserSession', () => {
  it('declares the full core surface supported', () => {
    const { session } = harness();
    expect(Object.values(session.capabilities).every((value) => value === 'supported')).toBe(true);
  });

  it('readText falls back to input VALUE when text nodes are empty (form controls)', async () => {
    const input = mockElement({ getText: vi.fn(async () => '') });
    const { session } = harness(input);
    expect(await session.readText({ by: 'testId', value: 'field' })).toBe('typed-value');
  });

  it('evaluate runs a script in the page via browser.execute', async () => {
    const { browser, session } = harness();
    await session.evaluate('return 42', 1, 2);
    expect(browser.execute).toHaveBeenCalledWith('return 42', 1, 2);
  });

  it('pressKey sends WebDriver codepoints; navigate uses url()', async () => {
    const { browser, session } = harness();
    await session.pressKey('enter');
    expect(browser.keys).toHaveBeenCalledWith('');
    await session.navigate('https://example.test/app');
    expect(browser.url).toHaveBeenCalledWith('https://example.test/app');
  });

  it('missing elements map to KRK-SESSION-ELEMENT-NOT-FOUND', async () => {
    const missing = mockElement({
      elementId: undefined,
      error: { message: 'no such element' },
      isExisting: vi.fn(async () => false),
    });
    const { session } = harness(missing);
    await expect(session.tap({ by: 'testId', value: 'ghost' })).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-SESSION-ELEMENT-NOT-FOUND',
    );
  });

  it('screenshot names are session-unique; dispose is idempotent', async () => {
    const { browser, session } = harness();
    const artifact = await session.screenshot();
    expect(artifact.path).toMatch(/web-[0-9a-f]{8}-1\.png$/);
    await session.dispose();
    await session.dispose();
    expect(browser.deleteSession).toHaveBeenCalledOnce();
  });
});

/* ─────────────── looking past the top document (iframes + tabs) ─────────────── */

type Scope = Record<string, WdioElementLike>;
interface WindowState {
  top: Scope;
  frames?: Scope[];
}

/**
 * A stateful WDIO mock with iframes and multiple windows. `$` resolves against
 * whatever context the session has switched into (top document or a frame of
 * the current window); frame handles carry a hidden index so switchFrame can
 * move into them.
 */
function multiHarness(windows: Record<string, WindowState>, start: string) {
  let current = start;
  let frameIndex: number | null = null;
  const missing = (): WdioElementLike =>
    mockElement({
      elementId: undefined,
      error: { message: 'no such element' },
      isExisting: vi.fn(async () => false),
    });

  const browser: WdioBrowserLike = {
    $: vi.fn(async (selector: string) => {
      const win = windows[current] as WindowState;
      const scope = frameIndex === null ? win.top : (win.frames?.[frameIndex] ?? {});
      return scope[selector] ?? missing();
    }),
    $$: vi.fn(async (_selector: string) => {
      const frames = windows[current]?.frames ?? [];
      return frames
        .map(
          (_, i) => mockElement({ elementId: `frame-${i}` }) as WdioElementLike & { __i: number },
        )
        .map((el, i) => Object.assign(el, { __i: i }));
    }),
    switchFrame: vi.fn(async (ctx: unknown) => {
      frameIndex = ctx === null ? null : (ctx as { __i: number }).__i;
    }),
    getWindowHandles: vi.fn(async () => Object.keys(windows)),
    getWindowHandle: vi.fn(async () => current),
    switchToWindow: vi.fn(async (handle: string) => {
      current = handle;
      frameIndex = null;
    }),
    keys: vi.fn(async () => {}),
    url: vi.fn(async () => undefined),
    takeScreenshot: vi.fn(async () => 'x'),
    getPageSource: vi.fn(async () => '<html/>'),
    execute: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => {}),
  };
  const services: DriverServices = {
    runId: 'r',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-web-')),
    abort: new AbortController().signal,
    emit: () => {},
  };
  const actor: ResolvedActor = { id: 'carol', platform: 'web', config: {} };
  return {
    browser,
    session: new WebUserSession(browser, actor, services),
    currentWindow: () => current,
  };
}

describe('WebUserSession · iframes and tabs', () => {
  it('taps an element that lives inside an iframe, then returns to the top', async () => {
    const button = mockElement();
    const { browser, session } = multiHarness(
      {
        w1: {
          top: {},
          frames: [
            {
              '//*[normalize-space(.)="Continue" and not(.//*[normalize-space(.)="Continue"]) and not(self::script) and not(self::style)]':
                button,
            },
          ],
        },
      },
      'w1',
    );
    await session.tap({ by: 'text', value: 'Continue', exact: true });
    expect(button.click).toHaveBeenCalledOnce();
    // last switchFrame call returns to the top (null)
    expect((browser.switchFrame as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toBeNull();
  });

  it('follows an element into another tab and stays there', async () => {
    const owner = mockElement();
    const { session, currentWindow } = multiHarness(
      {
        w1: { top: {} },
        w2: {
          top: {
            '//*[normalize-space(.)="I own this kahoot" and not(.//*[normalize-space(.)="I own this kahoot"]) and not(self::script) and not(self::style)]':
              owner,
          },
        },
      },
      'w1',
    );
    await session.tap({ by: 'text', value: 'I own this kahoot', exact: true });
    expect(owner.click).toHaveBeenCalledOnce();
    expect(currentWindow()).toBe('w2'); // the flow moved to the new tab
  });

  it('waitFor finds an element in another tab but, as a query, does not move there', async () => {
    const pin = mockElement();
    const { session, currentWindow } = multiHarness(
      { w1: { top: {} }, w2: { top: { '[data-testid="game-pin"]': pin } } },
      'w1',
    );
    // Resolves (found cross-tab) …
    await session.waitFor({ by: 'testId', value: 'game-pin' }, 'visible', {
      timeoutMs: 1000,
      pollMs: 10,
    });
    // … but a probe is side-effect-free: still on the entry tab.
    expect(currentWindow()).toBe('w1');
    // A subsequent ACTION is what moves the flow to the tab that has it.
    await session.tap({ by: 'testId', value: 'game-pin' });
    expect(currentWindow()).toBe('w2');
    expect(pin.click).toHaveBeenCalledOnce();
  });

  it('isDisplayed is a non-mutating query even across tabs', async () => {
    const el = mockElement();
    const { session, currentWindow } = multiHarness(
      { w1: { top: {} }, w2: { top: { '[data-testid="x"]': el } } },
      'w1',
    );
    expect(await session.isDisplayed({ by: 'testId', value: 'x' })).toBe(true);
    expect(currentWindow()).toBe('w1');
  });

  it('restores the original window when the element is nowhere', async () => {
    const { session, currentWindow } = multiHarness({ w1: { top: {} }, w2: { top: {} } }, 'w1');
    await expect(session.tap({ by: 'testId', value: 'ghost' })).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-SESSION-ELEMENT-NOT-FOUND',
    );
    expect(currentWindow()).toBe('w1');
  });
});

describe('WebUserSession · waitFor strategy', () => {
  it('polls the top document cheaply and deep-searches on a cadence (every 3rd)', async () => {
    const { browser, session } = multiHarness({ w1: { top: {}, frames: [{}] } }, 'w1');
    await expect(
      session.waitFor({ by: 'testId', value: 'never' }, 'visible', {
        timeoutMs: 400,
        pollMs: 30,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-SESSION-WAIT-TIMEOUT',
    );
    const polls = (browser.$ as ReturnType<typeof vi.fn>).mock.calls.length;
    const deepSweeps = (browser.$$ as ReturnType<typeof vi.fn>).mock.calls.length;
    // Deep sweeps must be a strict subset of polls — roughly a third plus the
    // final authoritative check, never one per poll.
    expect(deepSweeps).toBeGreaterThan(0);
    expect(deepSweeps).toBeLessThan(polls / 2);
  });

  it('extends the deadline (capped) when the page URL changes mid-wait', async () => {
    const pin = mockElement();
    const windows: Record<string, WindowState> = { w1: { top: {} } };
    const { browser, session } = multiHarness(windows, 'w1');
    let url = 'https://app.test/loading';
    (browser as { getUrl?: () => Promise<string> }).getUrl = vi.fn(async () => url);
    // The app redirects mid-wait (URL change at 150ms) and the destination
    // screen renders AFTER the original 250ms budget (at 350ms) — the route
    // change must top the budget back up so the wait survives to see it.
    setTimeout(() => {
      url = 'https://app.test/lobby';
    }, 150);
    setTimeout(() => {
      windows['w1'] = { top: { '[data-testid="game-pin"]': pin } };
    }, 350);
    await session.waitFor({ by: 'testId', value: 'game-pin' }, 'visible', {
      timeoutMs: 250,
      pollMs: 25,
    });
  });

  it('the hard cap (3× timeout) still bounds a redirect loop', async () => {
    const { browser, session } = multiHarness({ w1: { top: {} } }, 'w1');
    let flip = 0;
    (browser as { getUrl?: () => Promise<string> }).getUrl = vi.fn(
      async () => `https://app.test/${flip++}`, // URL changes on every poll
    );
    const startedAt = Date.now();
    await expect(
      session.waitFor({ by: 'testId', value: 'never' }, 'visible', {
        timeoutMs: 150,
        pollMs: 20,
      }),
    ).rejects.toSatisfy((error: unknown) => KrakenError.is(error));
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(150 * 3 + 400); // capped, not eternal
    expect(elapsed).toBeGreaterThan(150); // but it DID extend past the base timeout
  });
});
