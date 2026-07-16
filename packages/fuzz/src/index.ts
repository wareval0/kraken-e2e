/**
 * @kraken-e2e/fuzz — cross-platform random-event engine (ADR-0001 §5.14).
 *
 * Drives the SAME UserSession contract as scripted scenarios, so one fuzz
 * definition runs on Android, iOS and Web unmodified. Deliberately thin:
 * the caller declares the interaction surface (locator pools); the engine
 * contributes seeded randomness, budget-bounded execution, and a REPLAYABLE
 * trace — same seed, same walk, every time.
 */
import type { SemanticKey, TargetLocator, UserSession } from '@kraken-e2e/contracts';

import { mulberry32, pickIndex, pickWeighted, type Rng, randomText } from './random.js';

export type FuzzActionKind = 'tap' | 'typeText' | 'pressKey' | 'scrollIntoView';

export interface FuzzSurface {
  /** Elements safe to tap. */
  readonly tappable?: readonly TargetLocator[];
  /** Inputs safe to type into. */
  readonly typable?: readonly TargetLocator[];
  /** Elements worth scrolling to. */
  readonly scrollable?: readonly TargetLocator[];
}

export interface FuzzTraceEntry {
  readonly index: number;
  readonly kind: FuzzActionKind;
  readonly target?: TargetLocator;
  readonly text?: string;
  readonly key?: SemanticKey;
}

export interface FuzzOptions {
  readonly session: UserSession;
  readonly surface: FuzzSurface;
  /** Number of random actions (the budget). */
  readonly steps: number;
  /** Reproducibility seed — REQUIRED so every run is replayable by design. */
  readonly seed: number;
  /** Relative action weights (defaults favor taps). */
  readonly weights?: Partial<Record<FuzzActionKind, number>>;
  /** Capture a screenshot when an action fails (default true). */
  readonly screenshotOnFailure?: boolean;
  /**
   * Allow up to N failed actions WITHOUT aborting the walk (default 0 —
   * strict). Real UIs flake under a monkey (keyboards occlude elements,
   * re-renders staleify handles); a tolerant monkey records each miss in
   * `errors` and keeps walking — the walk stays seed-reproducible because
   * the PLAN never depends on runtime outcomes.
   */
  readonly tolerateActionErrors?: number;
  /** Observer hook (progress UIs, signal-aware orchestration). */
  readonly onAction?: (entry: FuzzTraceEntry) => void;
  /** Cooperative cancellation. */
  readonly abort?: AbortSignal;
}

export interface FuzzResult {
  readonly seed: number;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly trace: readonly FuzzTraceEntry[];
  /** Tolerated action failures (only when tolerateActionErrors > 0). */
  readonly errors: ReadonlyArray<{ readonly entry: FuzzTraceEntry; readonly message: string }>;
  readonly failure?: {
    readonly entry: FuzzTraceEntry;
    readonly error: unknown;
    readonly screenshotPath?: string;
  };
}

const DEFAULT_WEIGHTS: Record<FuzzActionKind, number> = {
  tap: 5,
  typeText: 3,
  scrollIntoView: 1,
  pressKey: 1,
};

const SEMANTIC_KEYS: readonly SemanticKey[] = ['enter', 'escape', 'tab'];

function poolFor(surface: FuzzSurface, kind: FuzzActionKind): readonly TargetLocator[] {
  switch (kind) {
    case 'tap':
      return surface.tappable ?? [];
    case 'typeText':
      return surface.typable ?? [];
    case 'scrollIntoView':
      return surface.scrollable ?? [];
    case 'pressKey':
      return [];
  }
}

function planEntry(
  rng: Rng,
  index: number,
  surface: FuzzSurface,
  kinds: ReadonlyArray<readonly [FuzzActionKind, number]>,
): FuzzTraceEntry {
  const kind = pickWeighted(rng, kinds);
  if (kind === 'pressKey') {
    return { index, kind, key: SEMANTIC_KEYS[pickIndex(rng, SEMANTIC_KEYS.length)] as SemanticKey };
  }
  const pool = poolFor(surface, kind);
  const target = pool[pickIndex(rng, pool.length)] as TargetLocator;
  if (kind === 'typeText') {
    return { index, kind, target, text: randomText(rng) };
  }
  return { index, kind, target };
}

async function performEntry(session: UserSession, entry: FuzzTraceEntry): Promise<void> {
  switch (entry.kind) {
    case 'tap':
      await session.tap(entry.target as TargetLocator);
      return;
    case 'typeText':
      await session.typeText(entry.target as TargetLocator, entry.text ?? '');
      return;
    case 'scrollIntoView':
      await session.scrollIntoView(entry.target as TargetLocator);
      return;
    case 'pressKey':
      await session.pressKey(entry.key as SemanticKey);
      return;
  }
}

/** PLAN the walk without a session — pure, instant, unit-testable. */
export function planFuzz(options: Omit<FuzzOptions, 'session'>): readonly FuzzTraceEntry[] {
  const rng = mulberry32(options.seed);
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const kinds = (Object.entries(weights) as Array<[FuzzActionKind, number]>).filter(
    ([kind, weight]) =>
      weight > 0 && (kind === 'pressKey' || poolFor(options.surface, kind).length > 0),
  );
  if (kinds.length === 0) {
    throw new Error('fuzz surface is empty: provide at least one locator pool or weight');
  }
  const entries: FuzzTraceEntry[] = [];
  for (let index = 0; index < options.steps; index += 1) {
    entries.push(planEntry(rng, index, options.surface, kinds));
  }
  return entries;
}

/** Run a seeded random walk. Same seed + same surface → same walk (replay = rerun). */
export async function runFuzz(options: FuzzOptions): Promise<FuzzResult> {
  const trace = planFuzz(options);
  const executed: FuzzTraceEntry[] = [];
  const errors: Array<{ entry: FuzzTraceEntry; message: string }> = [];
  const tolerance = options.tolerateActionErrors ?? 0;
  for (const entry of trace) {
    if (options.abort?.aborted) {
      return { seed: options.seed, status: 'aborted', trace: executed, errors };
    }
    options.onAction?.(entry);
    try {
      await performEntry(options.session, entry);
      executed.push(entry);
    } catch (error) {
      if (errors.length < tolerance) {
        errors.push({ entry, message: error instanceof Error ? error.message : String(error) });
        continue;
      }
      let screenshotPath: string | undefined;
      if (options.screenshotOnFailure !== false) {
        try {
          screenshotPath = (await options.session.screenshot()).path;
        } catch {
          // failure evidence is best-effort — the original error wins
        }
      }
      return {
        seed: options.seed,
        status: 'failed',
        trace: executed,
        errors,
        failure: screenshotPath !== undefined ? { entry, error, screenshotPath } : { entry, error },
      };
    }
  }
  return { seed: options.seed, status: 'completed', trace: executed, errors };
}

/** Re-execute a previously captured trace verbatim (debugging a failure). */
export async function replayTrace(
  session: UserSession,
  trace: readonly FuzzTraceEntry[],
): Promise<void> {
  for (const entry of trace) {
    await performEntry(session, entry);
  }
}

export { mulberry32 } from './random.js';
