/**
 * DEVICE-GATED integration (ADR-0008): the full CTK against the REAL
 * native-demo-app on a REAL iOS simulator. Enable with KRAKEN_DEVICE_TESTS=1
 * (fixtures first: node scripts/fetch-fixture-apps.mjs). First session may
 * xcodebuild WebDriverAgent (minutes). Emits the M1 gate artifact
 * parity-reports/parity-report.ios.json (ADR-0001 §5.4).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { UserSession } from '@kraken-e2e/contracts';
import { createHostContext, systemHostProbe } from '@kraken-e2e/core';
import { describeDriverConformance } from '@kraken-e2e/core/ctk';
import { afterAll, beforeAll, describe } from 'vitest';

import ios from '../../src/index.ts';

const DEVICE_TESTS = process.env['KRAKEN_DEVICE_TESTS'] === '1';
const REPO_ROOT = join(import.meta.dirname, '../../../..');
const APP = join(REPO_ROOT, 'fixtures/apps/wdiodemoapp.app');
const DEVICE_NAME = process.env['KRAKEN_IOS_SIM'] ?? 'iPhone 16';
// PIN the runtime too: without platformVersion, xcuitest targets the NEWEST
// runtime and silently CREATES appiumTest-* simulators when no exact
// deviceName match exists there — a boot-storm across the CTK's 11 sessions
// (observed live on this machine; recorded in ADR-0008).
const PLATFORM_VERSION = process.env['KRAKEN_IOS_VERSION'] ?? '18.6';

const logger = {
  debug: () => {},
  info: (message: string, meta?: object) =>
    process.stderr.write(`[it:ios] ${message} ${meta ? JSON.stringify(meta) : ''}\n`),
  warn: (message: string) => process.stderr.write(`[it:ios] WARN ${message}\n`),
  error: (message: string) => process.stderr.write(`[it:ios] ERROR ${message}\n`),
};

const services = {
  runId: 'it-ios',
  logger,
  artifactsDir: join(REPO_ROOT, '.kraken', 'it-artifacts', 'ios'),
  abort: new AbortController().signal,
  emit: () => {},
};

describe.skipIf(!DEVICE_TESTS)('driver-ios on a real simulator (KRAKEN_DEVICE_TESTS=1)', () => {
  const driver = ios({});

  beforeAll(async () => {
    if (!existsSync(APP)) {
      throw new Error(`Fixture app missing at ${APP} — run: node scripts/fetch-fixture-apps.mjs`);
    }
    const host = createHostContext(systemHostProbe.detect(), REPO_ROOT);
    await driver.start(host, services);
  }, 120_000);

  afterAll(async () => {
    await driver.stop();
  }, 120_000);

  describeDriverConformance({
    name: 'ios',
    createSession: () =>
      driver.createSession(
        {
          id: 'ctk-ios',
          platform: 'ios',
          config: {
            deviceName: DEVICE_NAME,
            platformVersion: PLATFORM_VERSION,
            app: APP,
            bundleId: 'org.wdiodemoapp',
          },
        },
        services,
      ),
    prepare: async (session: UserSession) => {
      await session.waitFor({ by: 'a11y', value: 'Forms' }, 'visible', { timeoutMs: 30_000 });
      await session.tap({ by: 'a11y', value: 'Forms' });
      await session.waitFor({ by: 'a11y', value: 'Forms-screen' }, 'visible', {
        timeoutMs: 15_000,
      });
    },
    fixture: {
      tappable: { by: 'a11y', value: 'switch' },
      typable: { by: 'a11y', value: 'text-input' },
      typableEcho: { by: 'a11y', value: 'input-text-result' },
      readable: {
        target: { by: 'a11y', value: 'switch-text' },
        expected: 'Click to turn the switch ON',
      },
      navigateTo: 'wdio://forms',
    },
    reportPath: join(REPO_ROOT, 'parity-reports', 'parity-report.ios.json'),
  });
});
