import { spawnSync } from 'node:child_process';

import type { DoctorCheck } from '@kraken-e2e/contracts';

/** Injectable so doctor checks are unit-testable without Xcode. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
) => { status: number | null; stdout: string };

export const spawnRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 30_000 });
  return { status: result.status, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

/** Xcode majors fully supported by appium-xcuitest-driver 11.x (ADR-0001 §4). */
const SUPPORTED_XCODE_MAJORS = [16, 26];

/**
 * Kraken-specific iOS checks (ADR-0001 §5.13). These only ever run on macOS —
 * on other hosts the driver is host-gated off before checks are collected.
 * The classic student trap is covered explicitly: a fresh Xcode passes binary
 * checks yet has ZERO simulator runtimes (separate downloads since Xcode 14).
 */
export function iosDoctorChecks(run: CommandRunner = spawnRunner): readonly DoctorCheck[] {
  return [
    {
      id: 'ios.xcode',
      title: `Xcode present and inside the xcuitest-driver support window (${SUPPORTED_XCODE_MAJORS.join('.x / ')}.x)`,
      run: async () => {
        const selected = run('xcode-select', ['-p']);
        if (selected.status !== 0) {
          return {
            status: 'fail',
            detail: 'no developer directory selected',
            fix: 'Install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
          };
        }
        const version = run('xcodebuild', ['-version']);
        const major = Number.parseInt(/Xcode\s+(\d+)/.exec(version.stdout)?.[1] ?? '0', 10);
        if (version.status !== 0 || major === 0) {
          return {
            status: 'fail',
            detail: 'xcodebuild did not run',
            fix: 'Open Xcode once to finish first-launch setup, then re-run kraken doctor.',
          };
        }
        if (!SUPPORTED_XCODE_MAJORS.includes(major)) {
          return {
            status: major < 16 ? 'fail' : 'warn',
            detail: `Xcode ${major} found`,
            fix:
              `appium-xcuitest-driver 11.x fully supports the latest two Xcode majors ` +
              `(${SUPPORTED_XCODE_MAJORS.join(', ')}). Upgrade/downgrade Xcode or expect breakage — ` +
              'this window moves every September (ADR-0001 §8.3).',
          };
        }
        return { status: 'ok', detail: version.stdout.split('\n')[0] ?? `Xcode ${major}` };
      },
    },
    {
      id: 'ios.simulator-runtimes',
      title: 'An iOS simulator runtime is installed (separate download since Xcode 14)',
      run: async () => {
        const result = run('xcrun', ['simctl', 'list', 'runtimes']);
        const runtimes = result.stdout.split('\n').filter((line) => line.trim().startsWith('iOS '));
        if (result.status !== 0 || runtimes.length === 0) {
          return {
            status: 'fail',
            detail: 'no iOS simulator runtime found',
            fix: 'Download one: xcodebuild -downloadPlatform iOS (or Xcode → Settings → Components). A fresh Xcode install ships with ZERO runtimes.',
          };
        }
        return {
          status: 'ok',
          detail: runtimes.map((line) => line.trim().split(' (')[0]).join(', '),
        };
      },
    },
    {
      id: 'ios.simulators',
      title: 'At least one iPhone simulator is available',
      run: async () => {
        const result = run('xcrun', ['simctl', 'list', 'devices', 'available']);
        const iphones = result.stdout.split('\n').filter((line) => line.includes('iPhone'));
        if (result.status !== 0 || iphones.length === 0) {
          return {
            status: 'fail',
            detail: 'no available iPhone simulators',
            fix: 'Create one: xcrun simctl create "iPhone 16" (or Xcode → Devices and Simulators).',
          };
        }
        return { status: 'ok', detail: `${iphones.length} iPhone simulator(s) available` };
      },
    },
  ];
}
