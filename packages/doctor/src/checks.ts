import { spawnSync } from 'node:child_process';

import type { DoctorCheck } from '@kraken-e2e/contracts';

const NODE_FLOOR_MAJOR = 22;
const NODE_FLOOR_MINOR = 12;

/** Phase 1 built-in checks (Node/pnpm/host — ADR-0001 D5). Driver checks arrive with drivers. */
export function builtInChecks(): readonly DoctorCheck[] {
  return [
    {
      id: 'common.node-version',
      title: `Node.js >= ${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR} (engines floor)`,
      run: async (host) => {
        const [major = 0, minor = 0] = host.nodeVersion.split('.').map(Number);
        if (major > NODE_FLOOR_MAJOR || (major === NODE_FLOOR_MAJOR && minor >= NODE_FLOOR_MINOR)) {
          const note =
            major === 22
              ? 'Node 22 is Maintenance LTS (EOL 2027-04) — Node 24 LTS is the reference dev line.'
              : undefined;
          return {
            status: major === 22 ? 'warn' : 'ok',
            detail: `running ${host.nodeVersion}${note ? `. ${note}` : ''}`,
          };
        }
        return {
          status: 'fail',
          detail: `running ${host.nodeVersion}`,
          fix: `Install Node >= ${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR} (24 LTS recommended): nvm install 24`,
        };
      },
    },
    {
      id: 'common.pnpm',
      title: 'pnpm available',
      run: async () => {
        const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: false });
        if (result.status === 0) {
          return { status: 'ok', detail: `pnpm ${result.stdout.trim()}` };
        }
        return {
          status: 'warn',
          detail: 'pnpm not found on PATH',
          fix: 'corepack enable pnpm (or: npm install -g corepack on Node >=25)',
        };
      },
    },
    {
      id: 'common.host',
      title: 'Host platform',
      run: async (host) => ({
        status: 'ok',
        detail:
          `${host.platform}/${host.arch}` +
          (host.platform === 'darwin'
            ? ' — all three drivers (android, ios, web) can run here'
            : ' — the iOS driver requires macOS (Apple platform restriction); android/web are available'),
      }),
    },
  ];
}

/**
 * Turns the CLI-injected driver gate statuses into doctor entries. The shape is
 * declared here (not imported from core) so doctor keeps its contracts-only
 * dependency rule (ADR-0001 §5.13).
 */
export interface DriverGateStatus {
  readonly driverId: string;
  readonly state: 'ready' | 'unavailable-on-host' | 'incompatible' | 'invalid';
  readonly detail?: string;
  readonly fix?: string;
}

export function driverGateChecks(statuses: readonly DriverGateStatus[]): readonly DoctorCheck[] {
  return statuses.map((status) => ({
    id: `driver.${status.driverId}.gate`,
    title: `Driver "${status.driverId}"`,
    run: async () => {
      switch (status.state) {
        case 'ready':
          return { status: 'ok', detail: 'ready on this host' };
        case 'unavailable-on-host':
          return {
            status: 'warn',
            detail: status.detail ?? 'unavailable on this host',
            fix: status.fix ?? 'Run on a supported host.',
          };
        default:
          return {
            status: 'fail',
            detail: status.detail ?? status.state,
            fix: status.fix ?? 'Reinstall or upgrade the driver package.',
          };
      }
    },
  }));
}
