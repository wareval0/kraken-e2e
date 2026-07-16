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

import { IOS_HID_KEY_USAGES, toIosSelector } from './locators.js';

/** Same narrow WDIO slice as driver-android (kept per-driver: contracts-only edges). */
export interface WdioBrowserLike {
  $(selector: string): Promise<WdioElementLike>;
  execute(script: string, args?: unknown): Promise<unknown>;
  takeScreenshot(): Promise<string>;
  getPageSource(): Promise<string>;
  deleteSession(): Promise<void>;
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

/**
 * UserSession adapter for XCUITest. All 11 core operations are supported —
 * pressKey included, via device-level HID keyboard events (contract 2.0):
 * the M1 gate first BLOCKED on a pressKey asymmetry, the mandated research
 * found the faithful mechanism, and SemanticKey was redefined (back removed —
 * an Android-only concept). Governance working as designed (ADR-0001 §5.4).
 */
export class IosUserSession implements UserSession {
  readonly actorId: string;
  readonly driverId = 'ios';
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
  ) {
    this.actorId = actor.id;
    this.platform = actor.platform;
    this.capabilities = Object.fromEntries(
      CORE_OPERATIONS.map((op) => [op, 'supported']),
    ) as Record<CoreOperation, 'supported' | 'unsupported'>;
  }

  async #element(target: TargetLocator): Promise<WdioElementLike> {
    const selector = toIosSelector(target);
    const element = await this.browser.$(selector);
    if (element.error || (element.elementId === undefined && !(await element.isExisting()))) {
      throw new KrakenError(
        'KRK-SESSION-ELEMENT-NOT-FOUND',
        `Actor "${this.actorId}" (ios) found no element for ${target.by}="${target.value}".`,
        {
          data: { selector, target: { ...target } },
          fix:
            target.by === 'testId'
              ? 'Check the accessibility identifier in the app (Appium Inspector helps), or use { by: "native" } with a class chain/predicate.'
              : undefined,
        },
      );
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
    const selector = toIosSelector(target);
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
        `Actor "${this.actorId}" (ios) waited ${timeout}ms for ${target.by}="${target.value}" to be ${state}.`,
        { cause, data: { selector } },
      );
    }
  }

  async isDisplayed(target: TargetLocator): Promise<boolean> {
    const element = await this.browser.$(toIosSelector(target));
    if (element.error || (element.elementId === undefined && !(await element.isExisting()))) {
      return false;
    }
    return element.isDisplayed();
  }

  async scrollIntoView(target: TargetLocator): Promise<void> {
    const element = await this.#element(target);
    await this.browser.execute('mobile: scroll', {
      elementId: element.elementId,
      toVisible: true,
    });
  }

  async pressKey(key: SemanticKey): Promise<void> {
    // FAITHFUL system-key semantics via device-level HID keyboard events
    // (contract 2.0; live-verified on iOS 18.6 — ADR-0008 amendment).
    await this.browser.execute('mobile: performIoHidEvent', {
      page: 0x07,
      usage: IOS_HID_KEY_USAGES[key],
      durationSeconds: 0.005,
    });
  }

  async navigate(destination: string): Promise<void> {
    await this.browser.execute('mobile: deepLink', { url: destination });
  }

  async screenshot(): Promise<ArtifactRef> {
    this.#screenshots += 1;
    const base64 = await this.browser.takeScreenshot();
    const dir = join(this.services.artifactsDir, this.actorId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `ios-${this.#sessionTag}-${this.#screenshots}.png`);
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
      this.services.logger.debug('deleteSession failed during dispose (ignored)', {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  native<K extends never>(kind: K): never {
    throw new KrakenError(
      'KRK-SESSION-OP-UNSUPPORTED',
      `native("${String(kind)}") is not exposed by driver-ios yet (planned: ADR-0008).`,
    );
  }
}
