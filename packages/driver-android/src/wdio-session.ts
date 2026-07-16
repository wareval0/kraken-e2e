import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type ArtifactRef,
  CORE_OPERATIONS,
  type CoreOperation,
  type DriverServices,
  KrakenError,
  type ResolvedActor,
  type SemanticKey,
  type SessionWaitOptions,
  type TargetLocator,
  type UserSession,
  type WaitState,
} from '@kraken-e2e/contracts';

import { keyCodeFor, toAndroidSelector } from './locators.js';

/**
 * The slice of a WebdriverIO Browser this adapter consumes — narrow by design
 * so unit tests can mock it and so WDIO types never leak past the driver
 * (ADR-0001 §5.3). The real object comes from webdriverio remote().
 */
export interface WdioBrowserLike {
  $(selector: string): Promise<WdioElementLike>;
  execute(script: string, args?: unknown): Promise<unknown>;
  takeScreenshot(): Promise<string>;
  getPageSource(): Promise<string>;
  deleteSession(): Promise<void>;
  url?(destination: string): Promise<unknown>;
}

export interface WdioElementLike {
  readonly error?: { message?: string };
  elementId?: string | undefined;
  click(): Promise<void>;
  setValue(text: string): Promise<void>;
  getText(): Promise<string>;
  isDisplayed(): Promise<boolean>;
  isExisting(): Promise<boolean>;
  waitForDisplayed(options?: {
    timeout?: number;
    interval?: number;
    reverse?: boolean;
  }): Promise<unknown>;
  waitForExist(options?: { timeout?: number; interval?: number }): Promise<unknown>;
}

const DEFAULT_WAIT_MS = 10_000;
/** Bounded existence wait an ACTION (tap/type/read) gives a not-yet-mounted
 *  target before declaring it missing — absorbs render/transition races. */
const ACTION_EXISTS_MS = 6_000;

/**
 * UserSession adapter over one INDEPENDENT WebdriverIO session (ADR-0001
 * §5.6 — one remote() per actor, never multiremote). All 11 core operations
 * are supported on Android; parity is proven by the CTK, not claimed.
 */
export class AndroidUserSession implements UserSession {
  readonly actorId: string;
  readonly driverId = 'android';
  readonly platform: string;
  readonly capabilities: Readonly<Record<CoreOperation, 'supported' | 'unsupported'>>;
  #disposed = false;
  #screenshots = 0;
  /** Distinguishes artifacts across the run's many sessions (one per scenario). */
  readonly #sessionTag = randomUUID().slice(0, 8);

  constructor(
    private readonly browser: WdioBrowserLike,
    actor: ResolvedActor,
    private readonly services: DriverServices,
    private readonly appPackage: string | undefined,
  ) {
    this.actorId = actor.id;
    this.platform = actor.platform;
    this.capabilities = Object.fromEntries(
      CORE_OPERATIONS.map((op) => [op, 'supported']),
    ) as Record<CoreOperation, 'supported' | 'unsupported'>;
  }

  async #element(target: TargetLocator): Promise<WdioElementLike> {
    const selector = toAndroidSelector(target);
    const element = await this.browser.$(selector);
    if (element.error || (element.elementId === undefined && !(await element.isExisting()))) {
      // Tolerate render races: a tap or type issued a beat before its target
      // mounts (a button that enables after input, a screen mid-transition) is
      // human-normal cadence, not a bug. Give the element a short, bounded
      // existence wait before declaring it missing. This never masks a truly
      // absent element — it still throws after the wait — and never slows
      // queries, since isDisplayed/waitFor don't route through here.
      try {
        await element.waitForExist({ timeout: ACTION_EXISTS_MS, interval: 100 });
        return await this.browser.$(selector);
      } catch {
        throw new KrakenError(
          'KRK-SESSION-ELEMENT-NOT-FOUND',
          `Actor "${this.actorId}" (android) found no element for ${target.by}="${target.value}".`,
          {
            data: { selector, target: { ...target } },
            fix:
              target.by === 'testId'
                ? 'Check the resource-id in the app (Appium Inspector helps), or use { by: "native" } with a raw selector.'
                : undefined,
          },
        );
      }
    }
    return element;
  }

  async tap(target: TargetLocator): Promise<void> {
    await (await this.#element(target)).click();
  }

  async typeText(target: TargetLocator, text: string): Promise<void> {
    await (await this.#element(target)).setValue(text);
  }

  async readText(target: TargetLocator): Promise<string> {
    return (await this.#element(target)).getText();
  }

  async waitFor(target: TargetLocator, state: WaitState, opts?: SessionWaitOptions): Promise<void> {
    const selector = toAndroidSelector(target);
    const element = await this.browser.$(selector);
    const timeout = opts?.timeoutMs ?? DEFAULT_WAIT_MS;
    const interval = opts?.pollMs ?? 100;
    try {
      if (state === 'attached') {
        await element.waitForExist({ timeout, interval });
      } else {
        await element.waitForDisplayed({ timeout, interval, reverse: state === 'hidden' });
      }
    } catch (cause) {
      throw new KrakenError(
        'KRK-SESSION-WAIT-TIMEOUT',
        `Actor "${this.actorId}" (android) waited ${timeout}ms for ${target.by}="${target.value}" to be ${state}.`,
        { cause, data: { selector } },
      );
    }
  }

  async isDisplayed(target: TargetLocator): Promise<boolean> {
    const element = await this.browser.$(toAndroidSelector(target));
    if (element.error || (element.elementId === undefined && !(await element.isExisting()))) {
      return false;
    }
    return element.isDisplayed();
  }

  async scrollIntoView(target: TargetLocator): Promise<void> {
    // UiScrollable drives the platform's own scrolling; falls back to a plain
    // find when the screen has no scrollable container.
    const inner = toAndroidSelector(target).replace(/^android=/, '');
    if (inner.startsWith('new UiSelector')) {
      const scrollSelector = `android=new UiScrollable(new UiSelector().scrollable(true)).scrollIntoView(${inner})`;
      const element = await this.browser.$(scrollSelector);
      if (!element.error) return;
    }
    await this.#element(target);
  }

  async pressKey(key: SemanticKey): Promise<void> {
    await this.browser.execute('mobile: pressKey', { keycode: keyCodeFor(key) });
  }

  async navigate(destination: string): Promise<void> {
    // Deep link into the app under test; plain URLs go to the default handler.
    await this.browser.execute('mobile: deepLink', {
      url: destination,
      ...(this.appPackage !== undefined ? { package: this.appPackage } : {}),
    });
  }

  async screenshot(): Promise<ArtifactRef> {
    this.#screenshots += 1;
    const base64 = await this.browser.takeScreenshot();
    const dir = join(this.services.artifactsDir, this.actorId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `android-${this.#sessionTag}-${this.#screenshots}.png`);
    writeFileSync(path, Buffer.from(base64, 'base64'));
    return { kind: 'screenshot', path };
  }

  async source(): Promise<string> {
    return this.browser.getPageSource();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      await this.browser.deleteSession();
    } catch (cause) {
      // Idempotent by contract: a dead session is a disposed session.
      this.services.logger.debug('deleteSession failed during dispose (ignored)', {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  native<K extends never>(kind: K): never {
    // Phase 2 note: the typed escape hatch (KrakenNativeSessions augmentation
    // exposing the WebdriverIO browser) lands with the step-library work.
    throw new KrakenError(
      'KRK-SESSION-OP-UNSUPPORTED',
      `native("${String(kind)}") is not exposed by driver-android yet (planned: ADR-0007).`,
    );
  }
}
