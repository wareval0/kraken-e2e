import { describe, expect, it } from 'vitest';

import { listIosTargets } from '../src/devices.ts';

const SIMCTL = {
  devices: {
    'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
      { udid: 'AAA', name: 'iPhone 17', state: 'Booted', isAvailable: true },
      { udid: 'BBB', name: 'iPhone 17 Pro', state: 'Shutdown', isAvailable: true },
      { udid: 'CCC', name: 'Broken sim', state: 'Shutdown', isAvailable: false },
    ],
    'com.apple.CoreSimulator.SimRuntime.iOS-18-6': [
      { udid: 'DDD', name: 'iPhone 16', state: 'Shutdown', isAvailable: true },
    ],
    'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
      { udid: 'EEE', name: 'Apple Watch', state: 'Shutdown', isAvailable: true },
    ],
  },
};

describe.skipIf(process.platform !== 'darwin')('listIosTargets', () => {
  it('booted sims first with udid pins; shutdown ones with name+version pins; skips unavailable and non-iOS', async () => {
    const targets = await listIosTargets(() => ({ status: 0, stdout: JSON.stringify(SIMCTL) }));
    expect(targets).toHaveLength(3);
    expect(targets[0]).toMatchObject({
      name: 'iPhone 17 (iOS 26.5)',
      state: 'running',
      actorConfig: { platform: 'ios', udid: 'AAA' },
    });
    // ADR-0008 D6: available sims pin BOTH name and version
    expect(targets[1]?.actorConfig).toMatchObject({
      deviceName: 'iPhone 17 Pro',
      platformVersion: '26.5',
    });
    expect(targets.some((t) => t.name.includes('Watch') || t.name.includes('Broken'))).toBe(false);
  });

  it('returns [] when simctl fails or emits garbage', async () => {
    expect(await listIosTargets(() => ({ status: 1, stdout: '' }))).toEqual([]);
    expect(await listIosTargets(() => ({ status: 0, stdout: 'not-json' }))).toEqual([]);
  });
});
