import { describe, expect, it } from 'vitest';

import { listAndroidTargets, resolveDeviceSelection } from '../src/devices.ts';

function runner(responses: Record<string, { status: number; stdout: string }>) {
  return (cmd: string, args: readonly string[]) => {
    const key = [cmd.split('/').pop(), ...args].join(' ');
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) return response;
    }
    return { status: 1, stdout: '' };
  };
}

describe('listAndroidTargets', () => {
  it('reports connected devices/emulators as running with udid pins, AVDs as available', async () => {
    const targets = await listAndroidTargets(
      runner({
        'devices -l': {
          status: 0,
          stdout:
            'List of devices attached\n' +
            'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a\n' +
            'R58M123ABC             device product:beyond1lte model:SM_G973F device:beyond1\n',
        },
        'emu avd name': { status: 0, stdout: 'Medium_Phone_API_36.0\nOK\n' },
        '-list-avds': { status: 0, stdout: 'Medium_Phone_API_36.0\nPixel_9_API_35\n' },
      }),
    );
    const running = targets.filter((t) => t.state === 'running');
    expect(running).toHaveLength(2);
    expect(running[0]).toMatchObject({
      id: 'emulator-5554',
      name: 'Medium_Phone_API_36.0',
      kind: 'emulator',
      actorConfig: { platform: 'android', udid: 'emulator-5554' },
    });
    expect(running[1]).toMatchObject({ id: 'R58M123ABC', kind: 'device' });
    // the RUNNING AVD is not re-listed as available; the other one is
    const available = targets.filter((t) => t.state === 'available');
    expect(available).toHaveLength(1);
    expect(available[0]).toMatchObject({
      name: 'Pixel_9_API_35',
      actorConfig: { platform: 'android', avd: 'Pixel_9_API_35' },
    });
  });

  it('returns [] gracefully when the SDK tools are missing', async () => {
    expect(await listAndroidTargets(() => ({ status: 1, stdout: '' }))).toEqual([]);
  });
});

describe('resolveDeviceSelection', () => {
  const targets = [
    {
      id: 'emulator-5554',
      name: 'Medium_Phone_API_36.0',
      platform: 'android',
      kind: 'emulator',
      state: 'running',
      actorConfig: { platform: 'android', udid: 'emulator-5554' },
    },
    {
      id: 'Pixel_9_API_35',
      name: 'Pixel_9_API_35',
      platform: 'android',
      kind: 'emulator',
      state: 'available',
      actorConfig: { platform: 'android', avd: 'Pixel_9_API_35' },
    },
  ] as const;

  it('a connected configured udid wins untouched', () => {
    expect(
      resolveDeviceSelection({ udid: 'emulator-5554' }, targets, { adbOk: true, emulatorOk: true }),
    ).toEqual({
      udid: 'emulator-5554',
    });
  });

  it('a disconnected udid falls back to the configured avd (boot it)', () => {
    const selection = resolveDeviceSelection(
      { udid: 'emulator-9999', avd: 'Pixel_9_API_35' },
      targets,
      {
        adbOk: true,
        emulatorOk: true,
      },
    );
    expect(selection.avd).toBe('Pixel_9_API_35');
    expect(selection.udid).toBeUndefined();
    expect(selection.note).toContain('not connected');
  });

  it('a disconnected udid with no avd uses another running device', () => {
    const selection = resolveDeviceSelection({ udid: 'emulator-9999' }, targets, {
      adbOk: true,
      emulatorOk: true,
    });
    expect(selection.udid).toBe('emulator-5554');
    expect(selection.note).toContain('emulator-5554');
  });

  it('an avd already running as an emulator is reused by udid pin', () => {
    const selection = resolveDeviceSelection({ avd: 'Medium_Phone_API_36.0' }, targets, {
      adbOk: true,
      emulatorOk: true,
    });
    expect(selection.udid).toBe('emulator-5554');
    expect(selection.note).toContain('reusing');
  });

  it('nothing configured: uses the running device; with none, boots the first AVD', () => {
    expect(resolveDeviceSelection({}, targets, { adbOk: true, emulatorOk: true }).udid).toBe(
      'emulator-5554',
    );
    const onlyAvds = targets.filter((t) => t.state === 'available');
    expect(resolveDeviceSelection({}, onlyAvds, { adbOk: true, emulatorOk: true }).avd).toBe(
      'Pixel_9_API_35',
    );
  });

  it('nothing anywhere throws KRK-DRV-ANDROID-NO-DEVICE with a fix', () => {
    expect(() => resolveDeviceSelection({}, [], { adbOk: true, emulatorOk: true })).toThrowError(
      /KRK|Android/,
    );
    try {
      resolveDeviceSelection({ udid: 'emulator-9999' }, [], { adbOk: true, emulatorOk: true });
    } catch (error) {
      expect((error as { code: string }).code).toBe('KRK-DRV-ANDROID-NO-DEVICE');
      expect((error as { fix?: string }).fix).toBeTruthy();
    }
  });

  it('passes config through untouched when enumeration itself failed (no adb)', () => {
    expect(
      resolveDeviceSelection({ udid: 'emulator-5554', avd: 'X' }, [], {
        adbOk: false,
        emulatorOk: false,
      }),
    ).toEqual({
      udid: 'emulator-5554',
      avd: 'X',
    });
    expect(resolveDeviceSelection({}, [], { adbOk: false, emulatorOk: false })).toEqual({});
  });
});
