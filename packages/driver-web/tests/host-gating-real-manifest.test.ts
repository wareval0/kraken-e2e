/**
 * The web half of the real-manifest C4b parameterization: web declares NO
 * host requirements — every OS loads it.
 */
import type { HostInfo } from '@kraken-e2e/contracts';
import { DriverRegistry } from '@kraken-e2e/core';
import { describe, expect, it } from 'vitest';

import web from '../src/index.ts';
import { manifest } from '../src/manifest.ts';

describe('driver-web REAL manifest host gating (C4b)', () => {
  it('declares no host requirements and the /manifest matches the entry', async () => {
    expect(manifest.hostRequirements).toBeUndefined();
    expect((await import('../src/manifest.ts')).default).toEqual(web().manifest);
  });

  it.each([
    { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' },
    { platform: 'win32', arch: 'x64', nodeVersion: '24.0.0' },
    { platform: 'darwin', arch: 'arm64', nodeVersion: '22.19.0' },
  ] satisfies HostInfo[])('loads ready on $platform', async (host) => {
    const registry = await DriverRegistry.create({ registrations: [web()], host });
    expect(registry.driverFor('web').manifest.id).toBe('web');
  });
});
