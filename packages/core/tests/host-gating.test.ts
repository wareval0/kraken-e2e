/**
 * THE mandated C4b test (ADR-0001 §5.5, team constraint 4b): force the
 * non-Apple branch by injecting a non-darwin HostInfo and assert the gate is
 * actually exercised — a darwin-only driver is disabled with an explicit,
 * actionable error; sibling drivers are unaffected; the driverDisabled event
 * fires for any subscriber (doctor, CLI, future GUI).
 */
import type { HostInfo, KrakenEvent } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { EventBus } from '../src/event-bus.ts';
import { DriverRegistry } from '../src/registry.ts';
import { createFakeDriver, FakeAppWorld } from '../src/testing/fake-driver.ts';

const LINUX_HOST: HostInfo = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0' };
const MAC_HOST: HostInfo = { platform: 'darwin', arch: 'arm64', nodeVersion: '22.19.0' };

function drivers() {
  const world = new FakeAppWorld();
  return {
    android: createFakeDriver({ world, id: 'fake-android', platforms: ['android-fake'] }),
    ios: createFakeDriver({
      world,
      id: 'fake-ios',
      platforms: ['ios-fake'],
      hostRequirements: { platforms: ['darwin'] },
    }),
  };
}

describe('host gating (C4b) — the non-darwin branch, forced', () => {
  it('disables a darwin-only driver on linux/x64 with an explicit message; siblings load', async () => {
    const { android, ios } = drivers();
    const events: KrakenEvent[] = [];
    const bus = new EventBus('test-run');
    bus.subscribe({ id: 'capture', onEvent: (event) => void events.push(event) });

    const registry = await DriverRegistry.create({
      registrations: [android, ios],
      host: LINUX_HOST,
      events: bus,
    });
    await bus.flush();

    // The darwin-only driver is present but hard-disabled…
    const iosStatus = registry.statuses().find((status) => status.state === 'unavailable-on-host');
    expect(iosStatus).toBeDefined();
    if (iosStatus?.state === 'unavailable-on-host') {
      expect(iosStatus.code).toBe('KRK-HOST-FAKE-IOS-UNSUPPORTED');
      expect(iosStatus.reason).toContain('darwin');
      expect(iosStatus.reason).toContain('linux');
      expect(iosStatus.fix).toBeTruthy();
    }

    // …binding an actor to it fails FAST with the explicit code + fix…
    try {
      registry.driverFor('ios-fake');
      expect.unreachable('driverFor must throw on a host-disabled platform');
    } catch (error) {
      expect(KrakenError.is(error)).toBe(true);
      if (KrakenError.is(error)) {
        expect(error.code).toBe('KRK-HOST-FAKE-IOS-UNSUPPORTED');
        expect(error.fix).toBeTruthy();
      }
    }

    // …the sibling driver is untouched…
    expect(registry.driverFor('android-fake').manifest.id).toBe('fake-android');

    // …and the disablement is announced on the event stream.
    const disabled = events.find((event) => event.type === 'driverDisabled');
    expect(disabled).toBeDefined();
    if (disabled?.type === 'driverDisabled') {
      expect(disabled.driverId).toBe('fake-ios');
      expect(disabled.code).toBe('KRK-HOST-FAKE-IOS-UNSUPPORTED');
    }
    const registered = events.filter((event) => event.type === 'driverRegistered');
    expect(registered).toHaveLength(1);
  });

  it('the same driver loads normally on darwin (the gate is the only difference)', async () => {
    const { ios } = drivers();
    const registry = await DriverRegistry.create({ registrations: [ios], host: MAC_HOST });
    expect(registry.driverFor('ios-fake').manifest.id).toBe('fake-ios');
    expect(registry.statuses().every((status) => status.state === 'ready')).toBe(true);
  });
});
