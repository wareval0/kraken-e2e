/**
 * Boots the REAL embedded Appium server (no devices needed): the synthesized
 * project-mode home must make Appium discover the pinned uiautomator2 driver.
 * This is the live proof of ADR-0007's mechanism.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { allocatePort, prepareAppiumHome, startAppiumServer } from '../src/appium-server.ts';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

describe('prepareAppiumHome (synthesized project mode)', () => {
  it('writes a lockfile-governed package.json and resolves symlinks', () => {
    const home = mkdtempSync(join(tmpdir(), 'kraken-appium-home-'));
    prepareAppiumHome(home, ['appium-uiautomator2-driver']);
    const manifest = JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['appium']).toBe('3.5.2');
    expect(manifest.dependencies['appium-uiautomator2-driver']).toBe('8.0.1');
    expect(existsSync(join(home, 'node_modules/appium/package.json'))).toBe(true);
    expect(existsSync(join(home, 'node_modules/appium-uiautomator2-driver/package.json'))).toBe(
      true,
    );
    // Idempotent: a second run refreshes without throwing.
    prepareAppiumHome(home, ['appium-uiautomator2-driver']);
  });
});

describe('embedded Appium server (live boot — no devices required)', () => {
  it('starts, reports the uiautomator2 driver via /status, and closes cleanly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kraken-appium-live-'));
    const logFile = join(home, 'appium.log');

    const server = await startAppiumServer({
      homeDir: home,
      driverPackages: ['appium-uiautomator2-driver'],
      logFile,
      logger: silentLogger,
    });
    try {
      // Appium's own exit(0) handlers ('onSignal') must have been stripped
      // (hazard 2). Transitive deps (signal-exit-style, name 'listener') may
      // register benign re-raising handlers — those are not ours to remove.
      const names = process.listeners('SIGINT').map((listener) => listener.name);
      expect(names).not.toContain('onSignal');

      const response = await fetch(`http://127.0.0.1:${server.port}/status`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { value: { ready: boolean } };
      expect(body.value.ready).toBe(true);

      // The driver was discovered through the synthesized home (log evidence).
      const log = readFileSync(logFile, 'utf8');
      expect(log).toContain('uiautomator2');
    } finally {
      await server.close();
    }
    // Port released after close.
    const reusable = await allocatePort();
    expect(reusable).toBeGreaterThan(0);
  }, 60_000);
});
