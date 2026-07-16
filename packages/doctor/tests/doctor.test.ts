import type { HostContext } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { builtInChecks, driverGateChecks } from '../src/checks.ts';
import { renderDoctorText, runDoctor } from '../src/engine.ts';

const linuxHost: HostContext = { platform: 'linux', arch: 'x64', nodeVersion: '22.19.0', env: {} };

describe('runDoctor engine', () => {
  it('runs injected checks and summarizes; a crashing check becomes a fail, not a crash', async () => {
    const report = await runDoctor({
      host: linuxHost,
      checks: [
        { id: 'a', title: 'always ok', run: async () => ({ status: 'ok' }) },
        {
          id: 'b',
          title: 'explodes',
          run: async () => {
            throw new Error('boom');
          },
        },
      ],
    });
    expect(report.summary).toEqual({ ok: 1, warn: 0, fail: 1 });
    expect(report.entries[1]?.detail).toContain('boom');
    const text = renderDoctorText(report);
    expect(text).toContain('✓ always ok');
    expect(text).toContain('✗ explodes');
    expect(text).toContain('1 ok, 0 warning(s), 1 failure(s)');
  });
});

describe('built-in checks (Node/pnpm/host — the Phase 1 minimal doctor)', () => {
  it('node floor: 22.x warns (maintenance LTS), older fails with a fix, 24 is ok', async () => {
    const checks = builtInChecks();
    const nodeCheck = checks.find((check) => check.id === 'common.node-version');
    expect((await nodeCheck?.run(linuxHost))?.status).toBe('warn');
    expect((await nodeCheck?.run({ ...linuxHost, nodeVersion: '20.11.0' }))?.status).toBe('fail');
    expect((await nodeCheck?.run({ ...linuxHost, nodeVersion: '24.18.0' }))?.status).toBe('ok');
  });

  it('host check states the iOS/macOS restriction explicitly on non-darwin (C4)', async () => {
    const hostCheck = builtInChecks().find((check) => check.id === 'common.host');
    const onLinux = await hostCheck?.run(linuxHost);
    expect(onLinux?.detail).toContain('iOS driver requires macOS');
    const onMac = await hostCheck?.run({ ...linuxHost, platform: 'darwin', arch: 'arm64' });
    expect(onMac?.detail).toContain('all three drivers');
  });
});

describe('driverGateChecks', () => {
  it('maps gate statuses to ok/warn/fail entries with fixes', async () => {
    const checks = driverGateChecks([
      { driverId: 'fake', state: 'ready' },
      {
        driverId: 'ios',
        state: 'unavailable-on-host',
        detail: 'requires darwin',
        fix: 'use a Mac',
      },
      { driverId: 'old', state: 'incompatible', detail: 'contract 2.0 vs 1.0' },
    ]);
    const report = await runDoctor({ host: linuxHost, checks });
    expect(report.entries.map((entry) => entry.status)).toEqual(['ok', 'warn', 'fail']);
    expect(report.entries[1]?.fix).toBe('use a Mac');
  });
});
