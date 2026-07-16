import type { KrakenDriver } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { z } from 'zod';

/**
 * Config-facing driver registration forms (ADR-0001 §5.10): typed factory
 * VALUES (primary — dependency injection, pnpm-proof), or package-name strings
 * / [name, options] tuples (what `kraken plugins install` appends). Declared
 * structurally here so config depends on contracts only (§5.3); core's
 * DriverRegistry accepts the same union.
 */
export type DriverRegistrationInput =
  | KrakenDriver
  | string
  | readonly [packageName: string, options?: unknown];

export interface ActorConfig {
  /** Platform id this actor binds to ('android' | 'ios' | 'web' | 'fake' | …). */
  readonly platform: string;
  /**
   * Per-actor key/value data exposed to steps as `actor.data` — credentials,
   * per-actor fixtures, custom fields. Not sent to the driver.
   */
  readonly data?: Readonly<Record<string, unknown>>;
  /**
   * Path (relative to the project root) to an env-format file whose keys are
   * merged into `actor.data`. Inline `data` wins over the file. Keep such
   * files out of version control.
   */
  readonly env?: string;
  /** Driver-specific configuration, passed through to createSession. */
  readonly [key: string]: unknown;
}

export interface KrakenConfig {
  /** The CLOSED actor set (ADR-0001 §5.9): steps naming others are dry-run errors. */
  readonly actors: Readonly<Record<string, ActorConfig>>;
  readonly drivers: readonly DriverRegistrationInput[];
  /** Feature file globs, relative to the project root. Default: features glob. */
  readonly features?: string | readonly string[];
  /**
   * Module path (relative to the project root) whose `registry` export is the
   * project's step registry — typically './steps/index.ts', which imports every
   * step file (explicit composition, no directory-scanning magic).
   */
  readonly steps?: string;
  readonly defaults?: {
    /** The one sanctioned config default (ADR-0004 D6): polling-assertion budget. */
    readonly assertionTimeoutMs?: number;
  };
  /**
   * Automatic screenshot policy:
   *  - 'on-failure' (default) — every actor's screenshot + source when a
   *    scenario fails;
   *  - 'per-step' — additionally, the acting actor's screenshot after every
   *    completed step (a visual timeline of the run);
   *  - 'off' — no automatic captures.
   * Steps can always capture explicitly via `actor.session.screenshot()`.
   */
  readonly screenshots?: 'on-failure' | 'per-step' | 'off';
}

export interface ResolvedKrakenConfig extends KrakenConfig {
  readonly features: readonly string[];
  /** Directory the config file lives in — the resolution anchor for everything. */
  readonly projectRoot: string;
  readonly configPath: string;
}

/** Identity + type anchor for kraken.config.ts (autocomplete without imports magic). */
export function defineConfig(config: KrakenConfig): KrakenConfig {
  return config;
}

// zod stays internal (never in a public .d.ts — ADR-0001 §5.3).
const actorSchema = z
  .object({
    platform: z.string().min(1),
    data: z.record(z.string(), z.unknown()).optional(),
    env: z.string().optional(),
  })
  .catchall(z.unknown());

const configSchema = z.object({
  actors: z.record(z.string().min(1), actorSchema),
  drivers: z.array(
    z.union([
      z.string(),
      z.custom<KrakenDriver>(isDriverLike),
      z.tuple([z.string()]).rest(z.unknown()),
    ]),
  ),
  features: z.union([z.string(), z.array(z.string())]).optional(),
  steps: z.string().optional(),
  defaults: z.object({ assertionTimeoutMs: z.number().positive().optional() }).optional(),
  screenshots: z.enum(['on-failure', 'per-step', 'off']).optional(),
});

function isDriverLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[Symbol.for('kraken.driver/v1')] === true
  );
}

export function validateConfig(raw: unknown, configPath: string): KrakenConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new KrakenError(
      'KRK-CONFIG-INVALID',
      `Invalid kraken config at ${configPath}:\n${issues}`,
      { fix: 'Fix the fields above; see defineConfig() types for the expected shape.' },
    );
  }
  if (Object.keys(result.data.actors).length === 0) {
    throw new KrakenError('KRK-CONFIG-INVALID', `No actors declared in ${configPath}.`, {
      fix: "Declare at least one actor: actors: { alice: { platform: 'android' } }.",
    });
  }
  return raw as KrakenConfig;
}
