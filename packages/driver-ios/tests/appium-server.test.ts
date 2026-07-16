/**
 * Live boot of the embedded Appium server with the xcuitest driver discovered
 * through the synthesized project-mode home (ADR-0008; no simulator needed).
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { prepareAppiumHome, startAppiumServer } from '../src/appium-server.ts';

describe('embedded Appium server (ios home)', () => {
  it('synthesizes a lockfile-governed home with xcuitest pinned', () => {
    const home = mkdtempSync(join(tmpdir(), 'kraken-ios-home-'));
    prepareAppiumHome(home, ['appium-xcuitest-driver']);
    const manifest = JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies['appium-xcuitest-driver']).toBe('11.17.1');
    expect(manifest.dependencies['appium']).toBe('3.5.2');
  });

  it('boots, discovers xcuitest, and closes cleanly', async () => {
    const home = mkdtempSync(join(tmpdir(), 'kraken-ios-live-'));
    const logFile = join(home, 'appium.log');
    const server = await startAppiumServer({
      homeDir: home,
      driverPackages: ['appium-xcuitest-driver'],
      logFile,
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/status`);
      expect(response.status).toBe(200);
      expect(readFileSync(logFile, 'utf8')).toContain('xcuitest');
    } finally {
      await server.close();
    }
  }, 60_000);
});
