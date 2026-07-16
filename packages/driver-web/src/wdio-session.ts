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

import { toWebSelector, WEB_KEY_CODES } from './locators.js';

/** The WDIO browser slice this adapter consumes (mock-friendly, type-firewalled). */
export interface WdioBrowserLike {
  $(selector: string): Promise<WdioElementLike>;
  keys(value: string | string[]): Promise<void>;
  url(destination: string): Promise<unknown>;
  takeScreenshot(): Promise<string>;
  getPageSource(): Promise<string>;
  execute(script: string, ...args: readonly unknown[]): Promise<unknown>;
  deleteSession(): Promise<void>;
  // Optional — present on the real WDIO browser, absent in minimal mocks. Used
  // ONLY to look past the top document: into iframes and into other tabs. When
  // absent, resolution stays in the top document of the current window (the
  // historical behaviour), so single-window/single-frame flows are unchanged.
  $$?(selector: string): Promise<readonly WdioElementLike[]>;
  switchFrame?(context: unknown): Promise<void>;
  getWindowHandles?(): Promise<readonly string[]>;
  getWindowHandle?(): Promise<string>;
  switchToWindow?(handle: string): Promise<void>;
  /** Current page URL — lets waitFor notice route changes (loader → redirect). */
  getUrl?(): Promise<string>;
}

export interface WdioElementLike {
  readonly error?: { message?: string };
  elementId?: string | undefined;
  click(): Promise<void>;
  setValue(text: string): Promise<void>;
  getText(): Promise<string>;
  getValue(): Promise<string>;
  isDisplayed(): Promise<boolean>;
  isExisting(): Promise<boolean>;
  scrollIntoView(options?: unknown): Promise<void>;
  waitForDisplayed(options?: {
    timeout?: number;
    interval?: number;
    reverse?: boolean;
  }): Promise<unknown>;
  waitForExist(options?: { timeout?: number; interval?: number }): Promise<unknown>;
}

const DEFAULT_WAIT_MS = 10_000;

/**
 * UserSession adapter over one INDEPENDENT WebdriverIO browser session
 * (ADR-0001 §5.6). All 11 core operations supported; pressKey uses the W3C
 * key actions — hardware-key faithful on web (contract 2.0).
 *
 * Element resolution looks past the top document so real sites work as-is:
 * an element not found there is searched for inside the current window's
 * iframes (a modal/consent/upsell frame, same OR cross origin — WebDriver frame
 * switching is not bound by the same-origin policy) and then in the other open
 * tabs/windows (a link that opened `_blank`). An ACTION (tap/type/…) that finds
 * its target in another tab stays there — the flow moved; a QUERY
 * (isDisplayed/waitFor) is side-effect-free and returns to the entry tab. A
 * frame action runs inside the frame and returns to the top afterwards. All of
 * this only engages when the element is NOT in the current top document, so
 * ordinary single-window pages are unaffected.
 */
export class WebUserSession implements UserSession {
  readonly actorId: string;
  readonly driverId = 'web';
  readonly platform: string;
  readonly capabilities: Readonly<Record<CoreOperation, 'supported' | 'unsupported'>>;
  #disposed = false;
  #screenshots = 0;
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

  async #exists(element: WdioElementLike): Promise<boolean> {
    if (element.error) return false;
    if (element.elementId !== undefined) return true;
    return element.isExisting();
  }

  /** Run `action` against `iframe`, in the frame's context, restoring the top. */
  async #tryInFrames<T>(
    selector: string,
    action: (element: WdioElementLike) => Promise<T>,
  ): Promise<{ hit: true; value: T } | { hit: false }> {
    if (!this.browser.$$ || !this.browser.switchFrame) return { hit: false };
    let frames: readonly WdioElementLike[];
    try {
      frames = await this.browser.$$('iframe');
    } catch {
      return { hit: false };
    }
    for (const frame of frames) {
      let element: WdioElementLike | undefined;
      // SEARCH ONLY inside the tolerant guard — a stale/inaccessible frame is
      // skipped. The action must NOT be here, or a real failure (e.g. click
      // intercepted) would be swallowed and misreported as "not found".
      try {
        await this.browser.switchFrame(frame);
        const candidate = await this.browser.$(selector);
        if (await this.#exists(candidate)) element = candidate;
      } catch {
        await this.browser.switchFrame(null).catch(() => {});
        continue;
      }
      if (element) {
        try {
          return { hit: true, value: await action(element) };
        } finally {
          await this.browser.switchFrame(null).catch(() => {});
        }
      }
      await this.browser.switchFrame(null).catch(() => {});
    }
    return { hit: false };
  }

  /**
   * Find the element and run `action` — searching the current top document,
   * then this window's iframes, then other tabs/windows. Throws
   * KRK-SESSION-ELEMENT-NOT-FOUND if it is nowhere.
   *
   * When the element is found in ANOTHER tab, an ACTION stays there (the flow
   * moved); a `query` (isDisplayed/waitFor) restores the entry tab so a probe
   * has no side effect. Any not-found or mid-search error also restores the
   * entry tab, so a failed lookup never leaves the session on a stray window.
   */
  async #withElement<T>(
    target: TargetLocator,
    action: (element: WdioElementLike) => Promise<T>,
    query = false,
  ): Promise<T> {
    const selector = toWebSelector(target);
    const canSwitch = Boolean(
      this.browser.getWindowHandles && this.browser.getWindowHandle && this.browser.switchToWindow,
    );
    const entry = canSwitch ? await this.browser.getWindowHandle?.() : undefined;
    let stayed = false;
    try {
      const top = await this.browser.$(selector);
      if (await this.#exists(top)) return await action(top);

      const inFrame = await this.#tryInFrames(selector, action);
      if (inFrame.hit) return inFrame.value;

      // Other tabs/windows (e.g. a play view opened in a new tab).
      if (canSwitch) {
        const handles = await (
          this.browser.getWindowHandles as NonNullable<WdioBrowserLike['getWindowHandles']>
        )();
        if (handles.length > 1) {
          for (const handle of handles) {
            if (handle === entry) continue;
            await (this.browser.switchToWindow as NonNullable<WdioBrowserLike['switchToWindow']>)(
              handle,
            );
            const element = await this.browser.$(selector);
            if (await this.#exists(element)) {
              stayed = !query;
              return await action(element);
            }
            const inOtherFrame = await this.#tryInFrames(selector, action);
            if (inOtherFrame.hit) {
              stayed = !query;
              return inOtherFrame.value;
            }
          }
        }
      }

      throw new KrakenError(
        'KRK-SESSION-ELEMENT-NOT-FOUND',
        `Actor "${this.actorId}" (web) found no element for ${target.by}="${target.value}".`,
        {
          data: { selector, target: { ...target } },
          fix:
            target.by === 'testId'
              ? 'Check the data-testid attribute in the page, or use { by: "native" } with a raw CSS/XPath selector.'
              : undefined,
        },
      );
    } finally {
      // Restore the entry tab unless a successful action deliberately moved us.
      if (
        !stayed &&
        entry !== undefined &&
        this.browser.switchToWindow &&
        this.browser.getWindowHandle
      ) {
        const now = await this.browser.getWindowHandle().catch(() => entry);
        if (now !== entry) await this.browser.switchToWindow(entry).catch(() => {});
      }
    }
  }

  async tap(target: TargetLocator): Promise<void> {
    await this.#withElement(target, (element) => element.click());
  }

  async typeText(target: TargetLocator, text: string): Promise<void> {
    await this.#withElement(target, (element) => element.setValue(text));
  }

  async readText(target: TargetLocator): Promise<string> {
    return this.#withElement(target, async (element) => {
      // Form controls carry their content in `value`, not text nodes.
      const text = await element.getText();
      if (text.length > 0) return text;
      try {
        return (await element.getValue()) ?? '';
      } catch {
        return text;
      }
    });
  }

  /** Whether the element exists (and is displayed) anywhere reachable. A pure
   *  query: it never leaves the session switched to another tab. */
  async #probe(target: TargetLocator): Promise<{ found: boolean; displayed: boolean }> {
    try {
      const displayed = await this.#withElement(target, (element) => element.isDisplayed(), true);
      return { found: true, displayed };
    } catch (cause) {
      if (KrakenError.is(cause) && cause.code === 'KRK-SESSION-ELEMENT-NOT-FOUND') {
        return { found: false, displayed: false };
      }
      throw cause;
    }
  }

  /** Cheap presence probe against the CURRENT top document only. */
  async #probeTop(selector: string): Promise<{ found: boolean; displayed: boolean }> {
    const element = await this.browser.$(selector);
    if (!(await this.#exists(element))) return { found: false, displayed: false };
    return { found: true, displayed: await element.isDisplayed() };
  }

  /**
   * Wait until the element reaches `state`, tuned for real single-page apps:
   *
   *  - POLL CHEAP, SEARCH DEEP ON A CADENCE. For 'visible'/'attached', every
   *    poll checks the current top document (one round-trip); the deep sweep
   *    across iframes and other tabs runs on the first and then every third
   *    poll — so a heavy page never reduces the effective poll rate to a
   *    handful of attempts per timeout. A 'hidden' wait always sweeps deep:
   *    its conclusion is about ABSENCE, which a top-only miss cannot confirm.
   *    (Deep results carry first-match semantics: "hidden" means the first
   *    element the sweep finds is not displayed, or none exists anywhere.)
   *  - ROUTE CHANGES RESET THE CLOCK (capped). Loaders, countdowns and
   *    redirects routinely stand between an action and the screen it leads to.
   *    When the page's origin+path changes mid-wait (hash/query churn is
   *    ignored), the remaining budget is topped back up to the full timeout —
   *    bounded by a hard cap of 3× the timeout so a redirect loop can never
   *    wait forever.
   *  - A CLOSED TAB IS SURVIVABLE. If the current window vanished mid-wait
   *    (the app closed its own tab), the session hops to a surviving window
   *    and keeps waiting instead of surfacing a raw "no such window".
   */
  async waitFor(target: TargetLocator, state: WaitState, opts?: SessionWaitOptions): Promise<void> {
    const timeout = opts?.timeoutMs ?? DEFAULT_WAIT_MS;
    const interval = opts?.pollMs ?? 100;
    const selector = toWebSelector(target);
    const startedAt = Date.now();
    let deadline = startedAt + timeout;
    const hardCap = startedAt + timeout * 3;
    let lastRoute: string | undefined;
    let attempt = 0;

    const routeOf = (url: string): string => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return url;
      }
    };

    for (;;) {
      attempt += 1;

      // Route-change detection (optional capability; absent in minimal mocks).
      if (this.browser.getUrl) {
        const url = await this.browser.getUrl().catch(() => undefined);
        if (url !== undefined) {
          const route = routeOf(url);
          if (lastRoute !== undefined && route !== lastRoute) {
            const extended = Math.min(Math.max(deadline, Date.now() + timeout), hardCap);
            if (extended > deadline) {
              this.services.logger.debug('waitFor: route changed — extending the wait budget', {
                route,
                remainingMs: extended - Date.now(),
              });
              deadline = extended;
            }
          }
          lastRoute = route;
        }
      }

      let found = false;
      let displayed = false;
      let wentDeep = false;
      try {
        if (state === 'hidden') {
          wentDeep = true;
          ({ found, displayed } = await this.#probe(target));
        } else {
          ({ found, displayed } = await this.#probeTop(selector));
          if (!found && attempt % 3 === 1) {
            wentDeep = true;
            ({ found, displayed } = await this.#probe(target));
          }
        }
      } catch (cause) {
        // The current window may have been closed by the app itself. Hop to a
        // surviving one and treat this poll as a miss; rethrow anything else.
        if (!(await this.#recoverWindow(cause))) throw cause;
      }

      const satisfied =
        state === 'attached' ? found : state === 'visible' ? displayed : !displayed && wentDeep;
      if (satisfied) return;

      if (Date.now() >= deadline) {
        // Authoritative deep check before giving up — skipped when this very
        // attempt already swept deep (its result IS authoritative).
        const last = wentDeep ? { found, displayed } : await this.#probe(target);
        const finalSatisfied =
          state === 'attached'
            ? last.found
            : state === 'visible'
              ? last.displayed
              : !last.displayed;
        if (finalSatisfied) return;
        throw new KrakenError(
          'KRK-SESSION-WAIT-TIMEOUT',
          `Actor "${this.actorId}" (web) waited ${Math.round(Date.now() - startedAt)}ms for ${target.by}="${target.value}" to be ${state}.`,
          { data: { selector } },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  /** If `cause` looks like a dead-window error and another window survives,
   *  switch to it and report recovery. */
  async #recoverWindow(cause: unknown): Promise<boolean> {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/no such window|web view not found|target window already closed/i.test(message)) {
      return false;
    }
    if (!this.browser.getWindowHandles || !this.browser.switchToWindow) return false;
    try {
      const [handle] = await this.browser.getWindowHandles();
      if (handle === undefined) return false;
      await this.browser.switchToWindow(handle);
      this.services.logger.debug('waitFor: current window closed — hopped to a surviving one');
      return true;
    } catch {
      return false;
    }
  }

  async isDisplayed(target: TargetLocator): Promise<boolean> {
    return (await this.#probe(target)).displayed;
  }

  async scrollIntoView(target: TargetLocator): Promise<void> {
    await this.#withElement(target, (element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
  }

  async pressKey(key: SemanticKey): Promise<void> {
    await this.browser.keys(WEB_KEY_CODES[key]);
  }

  async navigate(destination: string): Promise<void> {
    await this.browser.url(destination);
  }

  async screenshot(): Promise<ArtifactRef> {
    this.#screenshots += 1;
    const base64 = await this.browser.takeScreenshot();
    const dir = join(this.services.artifactsDir, this.actorId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `web-${this.#sessionTag}-${this.#screenshots}.png`);
    writeFileSync(path, Buffer.from(base64, 'base64'));
    return { kind: 'screenshot', path };
  }

  async source(): Promise<string> {
    return this.browser.getPageSource();
  }

  async evaluate(script: string, ...args: readonly unknown[]): Promise<unknown> {
    return this.browser.execute(script, ...args);
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
      `native("${String(kind)}") is not exposed by driver-web yet (planned: ADR-0009).`,
    );
  }
}
