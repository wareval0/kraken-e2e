import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { DoctorCheck } from '@kraken-e2e/contracts';

/** Injectable so doctor checks are unit-testable without an Android SDK. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
) => { status: number | null; stdout: string };

export const spawnRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 20_000 });
  return { status: result.status, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

export interface FsProbe {
  exists(path: string): boolean;
}

const realFs: FsProbe = { exists: (path) => existsSync(path) };

/**
 * Kraken-specific Android checks (ADR-0001 §5.13): the failures Appium's own
 * doctor does not diagnose for students — missing AVDs, JDK too old for
 * sdkmanager, deprecated env vars. Wrapping `appium driver doctor uiautomator2`
 * arrives with the server-lifecycle work (ADR-0007).
 */
export function androidDoctorChecks(
  run: CommandRunner = spawnRunner,
  fs: FsProbe = realFs,
): readonly DoctorCheck[] {
  return [
    {
      id: 'android.sdk-home',
      title: 'ANDROID_HOME points at an Android SDK',
      run: async (host) => {
        const home = host.env['ANDROID_HOME'];
        const legacy = host.env['ANDROID_SDK_ROOT'];
        if (!home && legacy) {
          return {
            status: 'warn',
            detail: `only ANDROID_SDK_ROOT is set (${legacy}) — deprecated by Google`,
            fix: 'Set ANDROID_HOME to the same directory (Google deprecated ANDROID_SDK_ROOT).',
          };
        }
        if (!home) {
          return {
            status: 'fail',
            detail: 'ANDROID_HOME is not set',
            fix: 'Install the Android SDK and export ANDROID_HOME (usually ~/Library/Android/sdk on macOS).',
          };
        }
        if (!fs.exists(home)) {
          return {
            status: 'fail',
            detail: `ANDROID_HOME=${home} does not exist`,
            fix: 'Point ANDROID_HOME at the actual SDK directory.',
          };
        }
        return { status: 'ok', detail: home };
      },
    },
    {
      id: 'android.jdk',
      title: 'JDK 17+ (sdkmanager requires it; uiautomator2 needs a JDK)',
      run: async (host) => {
        if (!host.env['JAVA_HOME']) {
          return {
            status: 'fail',
            detail: 'JAVA_HOME is not set',
            fix: 'Install a JDK (17+; 21 LTS recommended) and export JAVA_HOME.',
          };
        }
        const result = run('java', ['--version']);
        const major = Number.parseInt(
          /(?:openjdk|java)\s+(\d+)/i.exec(result.stdout)?.[1] ?? '0',
          10,
        );
        if (result.status !== 0 || major === 0) {
          return {
            status: 'fail',
            detail: 'java is not runnable',
            fix: 'Ensure $JAVA_HOME/bin is on PATH.',
          };
        }
        if (major < 17) {
          return {
            status: 'fail',
            detail: `JDK ${major} found`,
            fix: 'Android SDK tooling is compiled for JDK 17+ (class file 61) — upgrade (21 LTS recommended).',
          };
        }
        return { status: 'ok', detail: `JDK ${major}` };
      },
    },
    {
      id: 'android.adb',
      title: 'adb (platform-tools) is runnable',
      run: async (host) => {
        const home = host.env['ANDROID_HOME'];
        const adb = home ? join(home, 'platform-tools', 'adb') : 'adb';
        const result = run(adb, ['--version']);
        if (result.status !== 0) {
          return {
            status: 'fail',
            detail: 'adb did not run',
            fix: 'Install platform-tools: sdkmanager "platform-tools" (or via Android Studio).',
          };
        }
        return { status: 'ok', detail: result.stdout.split('\n')[0] ?? 'adb ok' };
      },
    },
    {
      id: 'android.target',
      title: 'A device is connected or an AVD exists',
      run: async (host) => {
        const home = host.env['ANDROID_HOME'];
        const adb = home ? join(home, 'platform-tools', 'adb') : 'adb';
        const devices = run(adb, ['devices'])
          .stdout.split('\n')
          .slice(1)
          .filter((line) => line.trim().endsWith('device'));
        if (devices.length > 0) {
          return { status: 'ok', detail: `${devices.length} device(s)/emulator(s) connected` };
        }
        const emulator = home ? join(home, 'emulator', 'emulator') : 'emulator';
        const avds = run(emulator, ['-list-avds'])
          .stdout.split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('INFO'));
        if (avds.length > 0) {
          return {
            status: 'ok',
            detail: `no device connected; ${avds.length} AVD(s) available for auto-boot: ${avds.join(', ')}`,
          };
        }
        const armNote =
          host.platform === 'darwin' && host.arch === 'arm64'
            ? ' On Apple Silicon only arm64-v8a system images boot (API 26+ required by uiautomator2).'
            : '';
        return {
          status: 'fail',
          detail: 'no connected device and no AVD',
          fix: `Create an AVD (Android Studio → Device Manager) or connect a device with USB debugging.${armNote}`,
        };
      },
    },
  ];
}
