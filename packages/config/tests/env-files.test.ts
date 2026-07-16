import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadEnvFiles } from '../src/loader.ts';

const touched: string[] = [];
afterEach(() => {
  for (const key of touched) delete process.env[key];
  touched.length = 0;
});

describe('loadEnvFiles', () => {
  it('loads .env keys that are not already set, and lets .env.local override .env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-env-'));
    writeFileSync(join(dir, '.env'), 'KRAKEN_TEST_A=from-env\nKRAKEN_TEST_B=base\n');
    writeFileSync(join(dir, '.env.local'), 'KRAKEN_TEST_B=local\n');
    touched.push('KRAKEN_TEST_A', 'KRAKEN_TEST_B');
    loadEnvFiles(dir);
    expect(process.env['KRAKEN_TEST_A']).toBe('from-env');
    expect(process.env['KRAKEN_TEST_B']).toBe('local'); // .env.local wins
  });

  it('never overrides a real environment variable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-env-'));
    writeFileSync(join(dir, '.env'), 'KRAKEN_TEST_C=from-file\n');
    process.env['KRAKEN_TEST_C'] = 'from-shell';
    touched.push('KRAKEN_TEST_C');
    loadEnvFiles(dir);
    expect(process.env['KRAKEN_TEST_C']).toBe('from-shell');
  });

  it('is a no-op when there is no env file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-env-'));
    expect(() => loadEnvFiles(dir)).not.toThrow();
  });
});
