import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DriverServices, ResolvedActor } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it, vi } from 'vitest';

import { IosUserSession, type WdioBrowserLike, type WdioElementLike } from '../src/wdio-session.ts';

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
    takeScreenshot: vi.fn(async () => Buffer.from('png').toString('base64')),
    getPageSource: vi.fn(async () => '<XCUIElementTypeApplication/>'),
    deleteSession: vi.fn(async () => {}),
  };
  const services: DriverServices = {
    runId: 'r',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-ios-')),
    abort: new AbortController().signal,
    emit: () => {},
  };
  const actor: ResolvedActor = { id: 'bob', platform: 'ios', config: {} };
  return { browser, session: new IosUserSession(browser, actor, services) };
}

describe('IosUserSession', () => {
  it('declares the FULL core surface supported (pressKey via HID — contract 2.0)', () => {
    const { session } = harness();
    expect(Object.values(session.capabilities).every((value) => value === 'supported')).toBe(true);
  });

  it('pressKey injects device-level HID keyboard events (the live-verified mechanism)', async () => {
    const { browser, session } = harness();
    await session.pressKey('enter');
    expect(browser.execute).toHaveBeenCalledWith('mobile: performIoHidEvent', {
      page: 0x07,
      usage: 0x28,
      durationSeconds: 0.005,
    });
    await session.pressKey('escape');
    expect(browser.execute).toHaveBeenCalledWith('mobile: performIoHidEvent', {
      page: 0x07,
      usage: 0x29,
      durationSeconds: 0.005,
    });
  });

  it('taps/types/reads through accessibility-id selectors', async () => {
    const element = mockElement();
    const { browser, session } = harness(element);
    await session.tap({ by: 'testId', value: 'send' });
    await session.typeText({ by: 'a11y', value: 'composer' }, 'hola');
    expect(browser.$).toHaveBeenCalledWith('~send');
    expect(browser.$).toHaveBeenCalledWith('~composer');
    expect(element.setValue).toHaveBeenCalledWith('hola');
  });

  it('scrollIntoView drives mobile: scroll with the element id', async () => {
    const { browser, session } = harness();
    await session.scrollIntoView({ by: 'testId', value: 'row-40' });
    expect(browser.execute).toHaveBeenCalledWith('mobile: scroll', {
      elementId: 'el-1',
      toVisible: true,
    });
  });

  it('missing elements and wait timeouts map to the canonical KRK codes', async () => {
    const missing = mockElement({
      elementId: undefined,
      error: { message: 'not found' },
      isExisting: vi.fn(async () => false),
      waitForDisplayed: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    const { session } = harness(missing);
    await expect(session.readText({ by: 'testId', value: 'ghost' })).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-SESSION-ELEMENT-NOT-FOUND',
    );
    await expect(
      session.waitFor({ by: 'testId', value: 'ghost' }, 'visible', { timeoutMs: 30 }),
    ).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-SESSION-WAIT-TIMEOUT',
    );
    expect(await session.isDisplayed({ by: 'testId', value: 'ghost' })).toBe(false);
  });

  it('screenshot writes per-actor pngs; dispose is idempotent', async () => {
    const { browser, session } = harness();
    const artifact = await session.screenshot();
    expect(artifact.path).toMatch(/ios-[0-9a-f]{8}-1\.png$/);
    await session.dispose();
    await session.dispose();
    expect(browser.deleteSession).toHaveBeenCalledOnce();
  });
});
