import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KrakenEvent } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { createJsonlReporter } from '../src/jsonl.ts';
import { createLineReporter } from '../src/line.ts';

const base = { ts: 1, runId: 'r', seq: 1 };
const events: KrakenEvent[] = [
  { ...base, seq: 1, type: 'runStarted', protocol: 1, scenarioCount: 1 },
  {
    ...base,
    seq: 2,
    type: 'scenarioStarted',
    scenarioId: 's1',
    name: 'messaging',
    actors: [{ id: 'alice', platform: 'fake', driverId: 'fake' }],
  },
  {
    ...base,
    seq: 3,
    type: 'signalWaitStarted',
    scenarioId: 's1',
    signal: 'go',
    actorId: 'bob',
    timeoutMs: 1000,
  },
  {
    ...base,
    seq: 4,
    type: 'stepFinished',
    scenarioId: 's1',
    stepId: 'st1',
    actorId: 'alice',
    text: 'alice sends the message "hola"',
    status: 'passed',
    durationMs: 12,
  },
  { ...base, seq: 5, type: 'scenarioFinished', scenarioId: 's1', status: 'passed', durationMs: 40 },
  { ...base, seq: 6, type: 'runFinished', status: 'passed', durationMs: 50 },
];

describe('JsonlReporter', () => {
  it('writes one JSON line per event, in seq order', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kraken-jsonl-')), 'events.jsonl');
    const reporter = createJsonlReporter(file);
    for (const event of events) await reporter.onEvent(event);
    await reporter.flush?.();
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(events.length);
    expect(lines.map((line) => (JSON.parse(line) as KrakenEvent).seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('LineReporter', () => {
  it('renders actor-prefixed streaming lines including the signal-wait moment', () => {
    const lines: string[] = [];
    const reporter = createLineReporter((line) => lines.push(line));
    for (const event of events) void reporter.onEvent(event);
    const output = lines.join('\n');
    expect(output).toContain('Scenario: messaging');
    expect(output).toContain('[bob] ⏳ waiting for signal "go"');
    expect(output).toContain('✓ [alice] alice sends the message "hola" (12ms)');
    expect(output).toContain('Run passed');
  });
});
