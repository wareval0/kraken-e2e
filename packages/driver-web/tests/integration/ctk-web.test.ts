/**
 * DEVICE-GATED integration (ADR-0009): the full CTK against a REAL browser
 * (Chrome headless by default — override with KRAKEN_WEB_BROWSER). Enable
 * with KRAKEN_DEVICE_TESTS=1. Emits parity-reports/parity-report.web.json.
 * The web report is PUBLISHED alongside the mobile ones; the M1 parity GATE
 * itself stays mobile-only (C3 — see ADR-0009).
 */
import { join } from 'node:path';

import type { UserSession } from '@kraken-e2e/contracts';
import { describeDriverConformance } from '@kraken-e2e/core/ctk';
import { afterAll, describe } from 'vitest';

import web from '../../src/index.ts';
import { startFixtureServer } from './fixture-page.ts';

const DEVICE_TESTS = process.env['KRAKEN_DEVICE_TESTS'] === '1';
const REPO_ROOT = join(import.meta.dirname, '../../../..');
const BROWSER = process.env['KRAKEN_WEB_BROWSER'] ?? 'chrome';

const services = {
  runId: 'it-web',
  logger: {
    debug: () => {},
    info: (message: string, meta?: object) =>
      process.stderr.write(`[it:web] ${message} ${meta ? JSON.stringify(meta) : ''}\n`),
    warn: (message: string) => process.stderr.write(`[it:web] WARN ${message}\n`),
    error: (message: string) => process.stderr.write(`[it:web] ERROR ${message}\n`),
  },
  artifactsDir: join(REPO_ROOT, '.kraken', 'it-artifacts', 'web'),
  abort: new AbortController().signal,
  emit: () => {},
};

// Collection-time server start (top-level await): describeDriverConformance
// needs the fixture URL when the suite is DECLARED, not when hooks run.
const fixture = DEVICE_TESTS ? await startFixtureServer() : undefined;

describe.skipIf(!DEVICE_TESTS)('driver-web on a real browser (KRAKEN_DEVICE_TESTS=1)', () => {
  const driver = web({ browser: BROWSER, headless: true });

  afterAll(async () => {
    await driver.stop();
    await fixture?.close();
  });

  describeDriverConformance({
    name: 'web',
    createSession: () =>
      driver.createSession({ id: 'ctk-web', platform: 'web', config: {} }, services),
    prepare: async (session: UserSession) => {
      await session.navigate(fixture?.url ?? 'about:blank');
      await session.waitFor({ by: 'testId', value: 'title' }, 'visible', { timeoutMs: 10_000 });
    },
    fixture: {
      tappable: { by: 'testId', value: 'switch' },
      typable: { by: 'testId', value: 'text-input' },
      typableEcho: { by: 'testId', value: 'input-text-result' },
      readable: {
        target: { by: 'testId', value: 'switch-text' },
        expected: 'Click to turn the switch ON',
      },
      ...(fixture ? { navigateTo: fixture.url } : {}),
    },
    reportPath: join(REPO_ROOT, 'parity-reports', 'parity-report.web.json'),
  });
});
