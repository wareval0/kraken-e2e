import type { HostContext } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { androidDoctorChecks, type CommandRunner, type FsProbe } from '../src/doctor.ts';

const host = (env: Record<string, string>): HostContext => ({
  platform: 'darwin',
  arch: 'arm64',
  nodeVersion: '22.19.0',
  env,
});

const fakeFs: FsProbe = { exists: (path) => path === '/sdk' };

function runner(table: Record<string, { status: number; stdout: string }>): CommandRunner {
  return (command, args) => {
    const key = `${command.split('/').pop()} ${args.join(' ')}`;
    return table[key] ?? { status: 1, stdout: '' };
  };
}

const find = (id: string, run: CommandRunner, fs: FsProbe = fakeFs) => {
  const check = androidDoctorChecks(run, fs).find((c) => c.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check;
};

describe('androidDoctorChecks', () => {
  it('sdk-home: ok when set+exists; warn on deprecated ANDROID_SDK_ROOT; fail when unset', async () => {
    const ok = await find('android.sdk-home', runner({})).run(host({ ANDROID_HOME: '/sdk' }));
    expect(ok.status).toBe('ok');
    const legacy = await find('android.sdk-home', runner({})).run(
      host({ ANDROID_SDK_ROOT: '/sdk' }),
    );
    expect(legacy.status).toBe('warn');
    expect(legacy.fix).toContain('ANDROID_HOME');
    const missing = await find('android.sdk-home', runner({})).run(host({}));
    expect(missing.status).toBe('fail');
    const gone = await find('android.sdk-home', runner({})).run(host({ ANDROID_HOME: '/nope' }));
    expect(gone.status).toBe('fail');
  });

  it('jdk: fails below 17 with the class-file explanation; ok on 21', async () => {
    const old = await find(
      'android.jdk',
      runner({ 'java --version': { status: 0, stdout: 'openjdk 11.0.2 2019' } }),
    ).run(host({ JAVA_HOME: '/jdk' }));
    expect(old.status).toBe('fail');
    expect(old.fix).toContain('17+');
    const modern = await find(
      'android.jdk',
      runner({ 'java --version': { status: 0, stdout: 'openjdk 21.0.8 2025-07-15 LTS' } }),
    ).run(host({ JAVA_HOME: '/jdk' }));
    expect(modern.status).toBe('ok');
    expect(modern.detail).toBe('JDK 21');
  });

  it('target: ok with a connected device, ok with AVDs only, fail with neither (+arm64 note)', async () => {
    const connected = await find(
      'android.target',
      runner({ 'adb devices': { status: 0, stdout: 'List of devices\nemulator-5554\tdevice\n' } }),
    ).run(host({ ANDROID_HOME: '/sdk' }));
    expect(connected.status).toBe('ok');

    const avdOnly = await find(
      'android.target',
      runner({
        'adb devices': { status: 0, stdout: 'List of devices\n' },
        'emulator -list-avds': { status: 0, stdout: 'Medium_Phone_API_36.0\n' },
      }),
    ).run(host({ ANDROID_HOME: '/sdk' }));
    expect(avdOnly.status).toBe('ok');
    expect(avdOnly.detail).toContain('Medium_Phone_API_36.0');

    const nothing = await find(
      'android.target',
      runner({ 'adb devices': { status: 0, stdout: 'List of devices\n' } }),
    ).run(host({ ANDROID_HOME: '/sdk' }));
    expect(nothing.status).toBe('fail');
    expect(nothing.fix).toContain('arm64-v8a');
  });
});
