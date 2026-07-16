import type { HostContext } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { type CommandRunner, iosDoctorChecks } from '../src/doctor.ts';

const macHost: HostContext = { platform: 'darwin', arch: 'arm64', nodeVersion: '22.19.0', env: {} };

function runner(table: Record<string, { status: number; stdout: string }>): CommandRunner {
  return (command, args) => table[`${command} ${args.join(' ')}`] ?? { status: 1, stdout: '' };
}

const find = (id: string, run: CommandRunner) => {
  const check = iosDoctorChecks(run).find((c) => c.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check;
};

describe('iosDoctorChecks', () => {
  it('xcode: ok inside the 16/26 window, warn outside it (window moves every September)', async () => {
    const ok = await find(
      'ios.xcode',
      runner({
        'xcode-select -p': { status: 0, stdout: '/Applications/Xcode.app/Contents/Developer' },
        'xcodebuild -version': { status: 0, stdout: 'Xcode 26.6\nBuild version 17F113' },
      }),
    ).run(macHost);
    expect(ok.status).toBe('ok');
    expect(ok.detail).toContain('Xcode 26.6');

    const future = await find(
      'ios.xcode',
      runner({
        'xcode-select -p': { status: 0, stdout: '/dev' },
        'xcodebuild -version': { status: 0, stdout: 'Xcode 27.0' },
      }),
    ).run(macHost);
    expect(future.status).toBe('warn');
    expect(future.fix).toContain('latest two Xcode majors');

    const ancient = await find(
      'ios.xcode',
      runner({
        'xcode-select -p': { status: 0, stdout: '/dev' },
        'xcodebuild -version': { status: 0, stdout: 'Xcode 15.4' },
      }),
    ).run(macHost);
    expect(ancient.status).toBe('fail');
  });

  it('runtimes: the fresh-Xcode trap fails with the downloadPlatform fix', async () => {
    const none = await find(
      'ios.simulator-runtimes',
      runner({ 'xcrun simctl list runtimes': { status: 0, stdout: '== Runtimes ==\n' } }),
    ).run(macHost);
    expect(none.status).toBe('fail');
    expect(none.fix).toContain('xcodebuild -downloadPlatform iOS');

    const present = await find(
      'ios.simulator-runtimes',
      runner({
        'xcrun simctl list runtimes': {
          status: 0,
          stdout: '== Runtimes ==\niOS 26.5 (26.5 - 23F77) - com.apple...\n',
        },
      }),
    ).run(macHost);
    expect(present.status).toBe('ok');
    expect(present.detail).toContain('iOS 26.5');
  });

  it('simulators: counts available iPhones', async () => {
    const some = await find(
      'ios.simulators',
      runner({
        'xcrun simctl list devices available': {
          status: 0,
          stdout:
            '-- iOS 26.5 --\n  iPhone 16 Pro (UUID) (Shutdown)\n  iPhone 17 Pro (UUID) (Shutdown)\n',
        },
      }),
    ).run(macHost);
    expect(some.status).toBe('ok');
    expect(some.detail).toBe('2 iPhone simulator(s) available');
  });
});
