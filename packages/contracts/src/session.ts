/**
 * The core session surface (ADR-0001 §5.4 Option C, exact list fixed by
 * ADR-0002 D1): locator-driven, stateless operations every platform can offer,
 * plus a typed native escape hatch. This surface grows ONLY through the parity
 * gate (RFC + CTK case + passing Android AND iOS implementations).
 */

/** Portable locator strategies; `native` is explicitly non-portable and CTK-exempt. */
export type TargetLocator =
  | { readonly by: 'testId'; readonly value: string }
  | { readonly by: 'text'; readonly value: string; readonly exact?: boolean }
  | { readonly by: 'a11y'; readonly value: string }
  | { readonly by: 'native'; readonly value: string };

/**
 * Cross-platform semantic keys — FAITHFUL on both mobile platforms (contract
 * 2.0, ratified 2026-07-04): Android via system keycodes, iOS via HID
 * keyboard events (live-verified). Android's BACK is deliberately NOT here:
 * it is an Android platform concept, not a key anywhere else (live-tested:
 * iOS ignores even the HID 'AC Back' consumer event) — reach it via native()
 * or a future Android-specific capability.
 */
export type SemanticKey = 'enter' | 'escape' | 'tab';

export type WaitState = 'visible' | 'hidden' | 'attached';

export interface SessionWaitOptions {
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

export interface ArtifactRef {
  readonly kind: 'screenshot' | 'log' | 'video' | 'source';
  readonly path: string;
}

/** The operations the parity report is generated over (ADR-0002 D1). */
export const CORE_OPERATIONS = [
  'tap',
  'typeText',
  'readText',
  'waitFor',
  'isDisplayed',
  'scrollIntoView',
  'pressKey',
  'navigate',
  'screenshot',
  'source',
  'dispose',
] as const;

export type CoreOperation = (typeof CORE_OPERATIONS)[number];

/**
 * Typed escape hatch registry. Driver packages augment it via declaration
 * merging (zero core→driver imports — ADR-0001 §5.4):
 *
 *   declare module '@kraken-e2e/contracts' {
 *     interface KrakenNativeSessions { web: WebdriverIO.Browser }
 *   }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmentation registry by design
export interface KrakenNativeSessions {}

export interface UserSession {
  readonly actorId: string;
  readonly driverId: string;
  readonly platform: string;
  /** Feeds the parity report; an unsupported op throws KRK-SESSION-OP-UNSUPPORTED. */
  readonly capabilities: Readonly<Record<CoreOperation, 'supported' | 'unsupported'>>;

  tap(target: TargetLocator): Promise<void>;
  typeText(target: TargetLocator, text: string): Promise<void>;
  readText(target: TargetLocator): Promise<string>;
  waitFor(target: TargetLocator, state: WaitState, opts?: SessionWaitOptions): Promise<void>;
  isDisplayed(target: TargetLocator): Promise<boolean>;
  /** Intent-level (bring element into view) — not a raw gesture (ADR-0002 D1). */
  scrollIntoView(target: TargetLocator): Promise<void>;
  pressKey(key: SemanticKey): Promise<void>;
  /** URL (web) or deep link (mobile). */
  navigate(destination: string): Promise<void>;
  /** Path ref, never bytes. */
  screenshot(): Promise<ArtifactRef>;
  /** DOM / view-hierarchy dump. */
  source(): Promise<string>;
  /** Idempotent — SIGINT teardown may call it more than once. */
  dispose(): Promise<void>;

  /** Typed platform-native session (declaration merging; throws if kind mismatches). */
  native<K extends keyof KrakenNativeSessions>(kind: K): KrakenNativeSessions[K];

  /**
   * OPTIONAL (contract 2.2): evaluate a script in the session's runtime and
   * return its result. Web sessions run JavaScript in the page; native mobile
   * sessions do not implement this (it is undefined there). Powers tools like
   * the web inspector that need live DOM geometry.
   */
  evaluate?(script: string, ...args: readonly unknown[]): Promise<unknown>;
}
