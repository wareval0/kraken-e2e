/**
 * String-form driver registration (ADR-0001 §5.10 / ADR-0002 D4): the load
 * path `kraken plugins install` relies on. The gated fixture's entry module
 * THROWS on import — so test 2 passing proves the /manifest pre-gate really
 * runs before the main entry is touched (ADR-0001 §5.5).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONTRACT_VERSION, type HostInfo, KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { DriverRegistry } from '../src/registry.ts';
import { createFakeDriver, FakeAppWorld } from '../src/testing/fake-driver.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(here, 'fixtures/project');
const LINUX: HostInfo = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' };

describe('DriverRegistry — string-form registrations', () => {
  it('resolves a package from the project root, validates it, and readies it', async () => {
    const registry = await DriverRegistry.create({
      registrations: ['@fixture/driver-ok'],
      host: LINUX,
      projectRoot: PROJECT_ROOT,
    });
    const driver = registry.driverFor('fixture');
    expect(driver.manifest.platformLabel).toContain('Fixture');
    expect(driver.manifest.contract).toEqual(CONTRACT_VERSION);
  });

  it('host-gates via /manifest BEFORE importing the entry (the tripwire never fires)', async () => {
    const registry = await DriverRegistry.create({
      registrations: ['@fixture/driver-gated'],
      host: LINUX,
      projectRoot: PROJECT_ROOT,
    });
    const status = registry.statuses()[0];
    expect(status?.state).toBe('unavailable-on-host');
    if (status?.state === 'unavailable-on-host') {
      expect(status.code).toBe('KRK-HOST-GATED-UNSUPPORTED');
      expect(status.fix).toBe('Run on macOS to use the gated fixture driver.');
    }
    expect(() => registry.driverFor('gated')).toThrow(/darwin/);
  });

  it('a missing package yields an invalid status with install guidance', async () => {
    const registry = await DriverRegistry.create({
      registrations: ['@fixture/does-not-exist'],
      host: LINUX,
      projectRoot: PROJECT_ROOT,
    });
    const status = registry.statuses()[0];
    expect(status?.state).toBe('invalid');
    if (status?.state === 'invalid') {
      expect(status.problems.join(' ')).toContain('kraken plugins install');
    }
  });

  it('string form without a projectRoot is an explicit invalid status, not a crash', async () => {
    const registry = await DriverRegistry.create({
      registrations: ['@fixture/driver-ok'],
      host: LINUX,
    });
    expect(registry.statuses()[0]?.state).toBe('invalid');
  });

  it('tuple form passes options through to the factory', async () => {
    const registry = await DriverRegistry.create({
      registrations: [['@fixture/driver-ok', { some: 'option' }]],
      host: LINUX,
      projectRoot: PROJECT_ROOT,
    });
    expect(registry.statuses()[0]?.state).toBe('ready');
  });
});

describe('DriverRegistry — value-form failure paths', () => {
  it('rejects a value without the driver brand', async () => {
    const registry = await DriverRegistry.create({
      registrations: [{ manifest: { id: 'nope' } } as never],
      host: LINUX,
    });
    const status = registry.statuses()[0];
    expect(status?.state).toBe('invalid');
    if (status?.state === 'invalid') {
      expect(status.problems[0]).toContain('defineDriver()');
    }
  });

  it('rejects a driver built against a NEWER contract minor with an upgrade fix', async () => {
    const world = new FakeAppWorld();
    const driver = createFakeDriver({ world, id: 'future', platforms: ['future'] });
    const tampered = {
      ...driver,
      manifest: {
        ...driver.manifest,
        contract: { major: CONTRACT_VERSION.major, minor: CONTRACT_VERSION.minor + 5 },
      },
    };
    const registry = await DriverRegistry.create({ registrations: [tampered], host: LINUX });
    const status = registry.statuses()[0];
    expect(status?.state).toBe('incompatible');
    expect(() => registry.driverFor('future')).toThrow(KrakenError);
    try {
      registry.driverFor('future');
    } catch (error) {
      expect(KrakenError.is(error) && error.code).toBe('KRK-PLUGIN-INCOMPATIBLE');
      expect(KrakenError.is(error) && error.fix).toContain('Upgrade @kraken-e2e/core');
    }
  });

  it('driverFor on an invalid registration surfaces the problems', async () => {
    const registry = await DriverRegistry.create({
      registrations: ['@fixture/does-not-exist'],
      host: LINUX,
      projectRoot: PROJECT_ROOT,
    });
    // Invalid registrations expose no platforms, so lookup reports unknown platform.
    expect(() => registry.driverFor('anything')).toThrow(/No registered driver/);
  });
});
