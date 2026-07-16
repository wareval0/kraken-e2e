import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { findConfigPath, loadConfig } from '../src/loader.ts';
import { defineConfig, validateConfig } from '../src/schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');

describe('loadConfig', () => {
  it('loads and validates a TS config via jiti, resolving features and root', async () => {
    const config = await loadConfig({ configPath: join(fixtures, 'kraken.config.ts') });
    expect(Object.keys(config.actors)).toEqual(['alice', 'bob']);
    expect(config.actors['alice']?.['avd']).toBe('Pixel_8');
    expect(config.features).toEqual(['scenarios/**/*.feature']);
    expect(config.projectRoot).toBe(fixtures);
    expect(config.steps).toBe('./steps/index.ts');
  });

  it('walks up from nested directories to find the config (project-root anchor)', () => {
    expect(findConfigPath(join(fixtures, 'nested/deep'))).toBe(join(fixtures, 'kraken.config.ts'));
  });

  it('fails with KRK-CONFIG-NOT-FOUND and a fix when no config exists', async () => {
    await expect(loadConfig({ cwd: '/tmp' })).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-CONFIG-NOT-FOUND',
    );
  });
});

describe('validateConfig', () => {
  it('accepts the defineConfig shape and rejects structural garbage with field paths', () => {
    const valid = defineConfig({
      actors: { alice: { platform: 'fake' } },
      drivers: ['@kraken-e2e/driver-fake', ['@kraken-e2e/driver-other', { opt: 1 }]],
    });
    expect(() => validateConfig(valid, 'x')).not.toThrow();

    expect(() => validateConfig({ actors: {}, drivers: [] }, 'x')).toThrow(/No actors declared/);
    expect(() => validateConfig({ actors: { a: {} }, drivers: [] }, 'x')).toThrow(/platform/);
    expect(() => validateConfig({ drivers: [] }, 'x')).toThrow(/actors/);
  });
});
