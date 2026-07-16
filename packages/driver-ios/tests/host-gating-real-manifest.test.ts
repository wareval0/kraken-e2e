/**
 * THE PHASE 2 EXIT CRITERION for C4b (ADR-0001 §5.5/§7): the mandated
 * non-darwin test parameterized over the REAL shipped manifest — a typo in
 * hostRequirements ('darwn') would fail HERE, not silently gate nothing.
 */
import type { HostInfo } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { DriverRegistry } from '@kraken-e2e/core';
import { describe, expect, it } from 'vitest';

import ios from '../src/index.ts';
import { manifest } from '../src/manifest.ts';

const LINUX: HostInfo = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' };
const WINDOWS: HostInfo = { platform: 'win32', arch: 'x64', nodeVersion: '24.0.0' };
const MAC: HostInfo = { platform: 'darwin', arch: 'arm64', nodeVersion: '22.19.0' };

describe('driver-ios REAL manifest host gating (C4b, real-manifest parameterization)', () => {
  it('the shipped manifest declares darwin-only with an Apple-restriction fix', () => {
    expect(manifest.hostRequirements?.platforms).toEqual(['darwin']);
    expect(manifest.disabledFix).toContain('Apple platform restriction');
  });

  it.each([
    LINUX,
    WINDOWS,
  ])('is hard-disabled on $platform with the explicit code', async (host) => {
    const registry = await DriverRegistry.create({ registrations: [ios()], host });
    const status = registry.statuses()[0];
    expect(status?.state).toBe('unavailable-on-host');
    try {
      registry.driverFor('ios');
      expect.unreachable('must throw');
    } catch (error) {
      expect(KrakenError.is(error) && error.code).toBe('KRK-HOST-IOS-UNSUPPORTED');
      expect(KrakenError.is(error) && error.fix).toContain('Apple platform restriction');
    }
  });

  it('loads ready on darwin (the gate is the ONLY difference)', async () => {
    const registry = await DriverRegistry.create({ registrations: [ios()], host: MAC });
    expect(registry.driverFor('ios').manifest.id).toBe('ios');
  });

  it('the /manifest subpath export matches the entry manifest (pre-gate integrity)', async () => {
    const subpath = (await import('../src/manifest.ts')).default;
    expect(subpath).toEqual(ios().manifest);
  });
});
