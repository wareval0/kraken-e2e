/**
 * Browser enumeration for `kraken devices` (contract 2.1). Browsers are
 * always 'available' (they spawn per session); the value here is showing the
 * user which browser keys their config can use on this host.
 */
import { existsSync } from 'node:fs';

import type { DeviceTarget } from '@kraken-e2e/contracts';

import { type CommandRunner, spawnRunner } from './doctor.js';

const MAC_BROWSERS: ReadonlyArray<readonly [key: string, name: string, appPath: string]> = [
  ['chrome', 'Chrome', '/Applications/Google Chrome.app'],
  ['firefox', 'Firefox', '/Applications/Firefox.app'],
  ['safari', 'Safari', '/Applications/Safari.app'],
  ['edge', 'Edge', '/Applications/Microsoft Edge.app'],
];

const LINUX_BROWSERS: ReadonlyArray<readonly [key: string, name: string, binary: string]> = [
  ['chrome', 'Chrome', 'google-chrome'],
  ['chrome', 'Chromium', 'chromium'],
  ['firefox', 'Firefox', 'firefox'],
];

export async function listWebTargets(
  run: CommandRunner = spawnRunner,
  fsExists: (path: string) => boolean = existsSync,
): Promise<readonly DeviceTarget[]> {
  const targets: DeviceTarget[] = [];
  if (process.platform === 'darwin') {
    for (const [key, name, appPath] of MAC_BROWSERS) {
      if (!fsExists(appPath)) continue;
      targets.push({
        id: key,
        name,
        platform: 'web',
        kind: 'browser',
        state: 'available',
        actorConfig: { platform: 'web', browser: key },
        ...(key === 'safari' ? { detail: 'max ONE concurrent Safari session per host' } : {}),
      });
    }
    return targets;
  }
  const seen = new Set<string>();
  for (const [key, name, binary] of LINUX_BROWSERS) {
    if (seen.has(key) || run(binary, ['--version']).status !== 0) continue;
    seen.add(key);
    targets.push({
      id: key,
      name,
      platform: 'web',
      kind: 'browser',
      state: 'available',
      actorConfig: { platform: 'web', browser: key },
    });
  }
  return targets;
}
