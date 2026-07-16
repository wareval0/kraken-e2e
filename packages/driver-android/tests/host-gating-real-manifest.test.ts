/**
 * The android counterpart of the real-manifest C4b parameterization: android
 * declares NO host requirements — it must load on every OS (the property that
 * lets a Linux/Windows student run Android+Web while iOS reports itself off).
 */
import type { HostInfo } from '@kraken-e2e/contracts';
import { DriverRegistry } from '@kraken-e2e/core';
import { describe, expect, it } from 'vitest';

import android from '../src/index.ts';
import { manifest } from '../src/manifest.ts';

describe('driver-android REAL manifest host gating (C4b)', () => {
  it('declares no host requirements (Android automation is cross-OS)', () => {
    expect(manifest.hostRequirements).toBeUndefined();
  });

  it.each([
    { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' },
    { platform: 'win32', arch: 'x64', nodeVersion: '24.0.0' },
    { platform: 'darwin', arch: 'arm64', nodeVersion: '22.19.0' },
  ] satisfies HostInfo[])('loads ready on $platform', async (host) => {
    const registry = await DriverRegistry.create({ registrations: [android()], host });
    expect(registry.driverFor('android').manifest.id).toBe('android');
  });
});
