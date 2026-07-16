import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { KrakenError } from '@kraken-e2e/contracts';
import { createJiti } from 'jiti';

import { type KrakenConfig, type ResolvedKrakenConfig, validateConfig } from './schema.js';

const CONFIG_BASENAMES = [
  'kraken.config.ts',
  'kraken.config.mts',
  'kraken.config.js',
  'kraken.config.mjs',
];

export function findConfigPath(cwd: string): string | undefined {
  // The config anchors the project root: walk up like tsconfig/eslint do.
  let dir = resolve(cwd);
  for (;;) {
    for (const basename of CONFIG_BASENAMES) {
      const candidate = join(dir, basename);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads a project `.env` (and optional `.env.local`) into `process.env` before
 * the config evaluates, so credentials and per-environment values live in an
 * untracked file rather than in the config or the shell. Real environment
 * variables always WIN — the file only fills what is not already set — so CI
 * secrets and one-off overrides take precedence. `.env.local` overrides `.env`.
 * Keep these files out of version control.
 */
export function loadEnvFiles(projectRoot: string): void {
  // Higher-priority file FIRST (non-override semantics): real env wins,
  // then .env.local, then .env.
  for (const basename of ['.env.local', '.env']) {
    const path = join(projectRoot, basename);
    if (!existsSync(path)) continue;
    let parsed: NodeJS.Dict<string>;
    try {
      parsed = parseEnv(readFileSync(path, 'utf8'));
    } catch {
      continue; // a malformed env file must never crash a run
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined && typeof value === 'string') {
        process.env[key] = value;
      }
    }
  }
}

/**
 * Loads kraken.config.ts via jiti (the same TS-config engine ESLint/Nuxt use —
 * ADR-0001 §5.10). The config file is the composition root: drivers arrive as
 * VALUES from typed factory imports.
 */
export async function loadConfig(options: {
  cwd?: string;
  configPath?: string;
}): Promise<ResolvedKrakenConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath
    ? isAbsolute(options.configPath)
      ? options.configPath
      : resolve(cwd, options.configPath)
    : findConfigPath(cwd);
  if (!configPath || !existsSync(configPath)) {
    throw new KrakenError(
      'KRK-CONFIG-NOT-FOUND',
      `No kraken.config.{ts,mts,js,mjs} found from ${cwd} upwards.`,
      { fix: 'Create one with defineConfig() — see the Kraken README quickstart.' },
    );
  }

  // Load the project's .env before the config file reads process.env.
  loadEnvFiles(dirname(configPath));

  const jiti = createJiti(configPath);
  let moduleExports: { default?: unknown };
  try {
    moduleExports = (await jiti.import(configPath)) as { default?: unknown };
  } catch (cause) {
    throw new KrakenError(
      'KRK-CONFIG-INVALID',
      `Failed to load ${configPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const raw = moduleExports.default ?? moduleExports;
  const config: KrakenConfig = validateConfig(raw, configPath);

  const features =
    config.features === undefined
      ? ['features/**/*.feature']
      : typeof config.features === 'string'
        ? [config.features]
        : [...config.features];

  return { ...config, features, projectRoot: dirname(configPath), configPath };
}
