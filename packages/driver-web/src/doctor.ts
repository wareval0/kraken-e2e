import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { DoctorCheck } from '@kraken-e2e/contracts';

/** Injectable so doctor checks are unit-testable without browsers. */
export type CommandRunner = (
  command: string,
  args: readonly string[],
) => { status: number | null; stdout: string };

export const spawnRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, [...args], { encoding: 'utf8', timeout: 15_000 });
  return { status: result.status, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

export interface FsProbe {
  exists(path: string): boolean;
}

const realFs: FsProbe = { exists: (path) => existsSync(path) };

const MAC_BROWSERS = [
  ['Chrome', '/Applications/Google Chrome.app'],
  ['Firefox', '/Applications/Firefox.app'],
  ['Safari', '/Applications/Safari.app'],
  ['Edge', '/Applications/Microsoft Edge.app'],
] as const;

/** Kraken-specific web checks (ADR-0001 §5.13; ADR-0009). */
export function webDoctorChecks(
  run: CommandRunner = spawnRunner,
  fs: FsProbe = realFs,
): readonly DoctorCheck[] {
  return [
    {
      id: 'web.browsers',
      title: 'At least one automatable browser is installed',
      run: async (host) => {
        if (host.platform === 'darwin') {
          const found = MAC_BROWSERS.filter(([, path]) => fs.exists(path)).map(([name]) => name);
          if (found.length === 0) {
            return {
              status: 'fail',
              detail: 'no browser found in /Applications',
              fix: 'Install Chrome (recommended — WebdriverIO manages chromedriver automatically).',
            };
          }
          return { status: 'ok', detail: found.join(', ') };
        }
        // Non-mac: probe PATH for the common binaries.
        const candidates = ['google-chrome', 'chromium', 'firefox'];
        const found = candidates.filter((bin) => run(bin, ['--version']).status === 0);
        return found.length > 0
          ? { status: 'ok', detail: found.join(', ') }
          : {
              status: 'warn',
              detail: 'no browser binary found on PATH',
              fix: 'Install Chrome or Firefox.',
            };
      },
    },
    {
      id: 'web.safaridriver',
      title: 'Safari automation (safaridriver) state',
      run: async (host) => {
        if (host.platform !== 'darwin') {
          return { status: 'ok', detail: 'not applicable off macOS' };
        }
        // NOTE (ADR-0009): safaridriver allows ONE concurrent session per
        // host — two simultaneous Safari actors on one Mac cannot work; mix
        // browsers instead. Surfaced here so scenario authors learn it from
        // doctor, not from a hanging session.
        const result = run('safaridriver', ['--version']);
        if (result.status !== 0) {
          return {
            status: 'warn',
            detail: 'safaridriver not runnable (never enabled?)',
            fix: "Enable once with: safaridriver --enable (admin password required). Chrome/Firefox actors don't need this.",
          };
        }
        return {
          status: 'ok',
          detail: `${result.stdout.trim().split('\n')[0] ?? 'available'} — max ONE concurrent Safari session per host`,
        };
      },
    },
  ];
}
