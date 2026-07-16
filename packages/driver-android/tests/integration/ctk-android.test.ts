/**
 * DEVICE-GATED integration (ADR-0007): the full CTK against the REAL
 * native-demo-app on a REAL Android emulator. Never runs in `pnpm check` —
 * enable with KRAKEN_DEVICE_TESTS=1 (fixture apps must be fetched first:
 * node scripts/fetch-fixture-apps.mjs). Emits the M1 gate artifact
 * parity-reports/parity-report.android.json (ADR-0001 §5.4).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UserSession } from '@kraken-e2e/contracts';
import { createHostContext, systemHostProbe } from '@kraken-e2e/core';
import { describeDriverConformance } from '@kraken-e2e/core/ctk';
import { afterAll, beforeAll, describe } from 'vitest';

import android from '../../src/index.ts';

const DEVICE_TESTS = process.env['KRAKEN_DEVICE_TESTS'] === '1';
const REPO_ROOT = join(import.meta.dirname, '../../../..');
const APK = join(REPO_ROOT, 'fixtures/apps/native-demo-app.apk');
const AVD = process.env['KRAKEN_ANDROID_AVD'] ?? 'Medium_Phone_API_36.0';

const logger = {
  debug: () => {},
  info: (message: string, meta?: object) =>
    process.stderr.write(`[it:android] ${message} ${meta ? JSON.stringify(meta) : ''}\n`),
  warn: (message: string) => process.stderr.write(`[it:android] WARN ${message}\n`),
  error: (message: string) => process.stderr.write(`[it:android] ERROR ${message}\n`),
};

const services = {
  runId: 'it-android',
  logger,
  artifactsDir: join(REPO_ROOT, '.kraken', 'it-artifacts', 'android'),
  abort: new AbortController().signal,
  emit: () => {},
};

describe.skipIf(!DEVICE_TESTS)('driver-android on a real emulator (KRAKEN_DEVICE_TESTS=1)', () => {
  const driver = android({});

  beforeAll(async () => {
    if (!existsSync(APK)) {
      throw new Error(`Fixture APK missing at ${APK} — run: node scripts/fetch-fixture-apps.mjs`);
    }
    const host = createHostContext(systemHostProbe.detect(), REPO_ROOT);
    await driver.start(host, services);
  }, 120_000);

  afterAll(async () => {
    await driver.stop();
  }, 60_000);

  describeDriverConformance({
    name: 'android',
    createSession: () =>
      driver.createSession(
        {
          id: 'ctk-android',
          platform: 'android',
          config: {
            avd: AVD,
            app: APK,
            appPackage: 'com.wdiodemoapp',
            capabilities: { 'appium:appWaitActivity': '*' },
          },
        },
        services,
      ),
    prepare: async (session: UserSession) => {
      // Land on the Forms screen, which holds every fixture element.
      await session.waitFor({ by: 'a11y', value: 'Forms' }, 'visible', { timeoutMs: 30_000 });
      await session.tap({ by: 'a11y', value: 'Forms' });
      await session.waitFor({ by: 'a11y', value: 'Forms-screen' }, 'visible', {
        timeoutMs: 15_000,
      });
    },
    fixture: {
      // ONE strategy on BOTH platforms: accessibility id (the app maps its ids
      // to content-desc on Android and name on iOS — NEVER resource-id here).
      tappable: { by: 'a11y', value: 'switch' },
      typable: { by: 'a11y', value: 'text-input' },
      typableEcho: { by: 'a11y', value: 'input-text-result' },
      readable: {
        target: { by: 'a11y', value: 'switch-text' },
        expected: 'Click to turn the switch ON',
      },
      navigateTo: 'wdio://forms',
    },
    reportPath: join(REPO_ROOT, 'parity-reports', 'parity-report.android.json'),
  });
});
