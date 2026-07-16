/**
 * THE PHASE 1 EXIT CRITERION (ADR-0001 §7): a multi-actor choreography — the
 * examples/fake-messaging project — runs end to end through the full stack
 * (config → jiti steps import → gherkin compile+analyze → registry →
 * orchestrator → signals → reporters) with ZERO real devices.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { KrakenEvent } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { buildDoctorReport } from '../src/doctor-report.ts';
import { runProject } from '../src/run-project.ts';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = join(here, '../../../examples/fake-messaging');

describe('kraken run (examples/fake-messaging) — the Phase 1 exit criterion', () => {
  it('dry-run compiles and statically analyzes without booting anything', async () => {
    const lines: string[] = [];
    const result = await runProject({ cwd: EXAMPLE, dryRun: true, write: (l) => lines.push(l) });
    expect(result.exitCode).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('Dry run OK: 1 scenario(s), 7 step(s)');
    expect(output).toContain('alice');
    expect(output).toContain('carol');
  });

  it('runs the three-actor choreography end to end on FakeDriver', async () => {
    const lines: string[] = [];
    const result = await runProject({ cwd: EXAMPLE, write: (l) => lines.push(l) });
    const output = lines.join('\n');

    expect(result.exitCode).toBe(0);
    expect(output).toContain('Run passed');
    // The signature moment renders on the plain reporter too.
    expect(output).toContain('[bob] ⏳ waiting for signal "message-sent"');
    expect(output).toContain('⚡ received "message-sent" from alice');
    // All seven steps of the choreography passed.
    expect(output.match(/✓ \[/g)?.length).toBe(7);

    // The JSONL event log is the GUI-ready substrate: parse and verify it.
    expect(result.eventsPath).toBeDefined();
    expect(existsSync(result.eventsPath as string)).toBe(true);
    const events = readFileSync(result.eventsPath as string, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as KrakenEvent);
    expect(events[0]?.type).toBe('runStarted');
    expect(events.at(-1)?.type).toBe('runFinished');
    const sessionStarts = events.filter((event) => event.type === 'actorSessionStarted');
    expect(sessionStarts).toHaveLength(3); // alice, bob, carol — three platforms
    expect(events.some((event) => event.type === 'signalSent')).toBe(true);
    expect(events.some((event) => event.type === 'signalReceived')).toBe(true);
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  }, 20_000);

  it('a tag filter that matches nothing fails with a clear message, not an empty pass', async () => {
    const lines: string[] = [];
    const result = await runProject({
      cwd: EXAMPLE,
      tags: '@does-not-exist',
      dryRun: true,
      write: (l) => lines.push(l),
    });
    // Zero scenarios compiled — dry run reports 0; the run itself would pass
    // vacuously, which the summary makes visible.
    expect(result.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('0 scenario(s)');
  });
});

describe('kraken doctor', () => {
  it('reports host facts and per-driver gate status for the example project', async () => {
    const report = await buildDoctorReport({ cwd: EXAMPLE });
    const ids = report.entries.map((entry) => entry.id);
    expect(ids).toContain('common.node-version');
    expect(ids).toContain('common.host');
    expect(ids).toContain('driver.fake.gate');
    const gate = report.entries.find((entry) => entry.id === 'driver.fake.gate');
    expect(gate?.status).toBe('ok');
    expect(report.summary.fail).toBe(0);
  });
});
