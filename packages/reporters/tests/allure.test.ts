import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KrakenEvent, KrakenEventInput } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { createAllureReporter } from '../src/allure.ts';

let seq = 0;
const ev = (event: KrakenEventInput): KrakenEvent =>
  ({ ts: 5000 + seq * 10, runId: 'r1', seq: ++seq, ...event }) as KrakenEvent;

describe('Allure 3 reporter', () => {
  it('writes a valid allure result with actor-prefixed steps and signal choreography', () => {
    const resultsDir = mkdtempSync(join(tmpdir(), 'kraken-allure-'));
    const reporter = createAllureReporter(resultsDir);
    const events: KrakenEventInput[] = [
      {
        type: 'scenarioStarted',
        scenarioId: 's1',
        name: 'cross-device relay',
        actors: [
          { id: 'alice', platform: 'android', driverId: 'android' },
          { id: 'bob', platform: 'ios', driverId: 'ios' },
        ],
      },
      {
        type: 'stepStarted',
        scenarioId: 's1',
        stepId: 'st1',
        actorId: 'alice',
        text: 'alice writes "hola"',
      },
      {
        type: 'stepFinished',
        scenarioId: 's1',
        stepId: 'st1',
        actorId: 'alice',
        text: 'alice writes "hola"',
        status: 'passed',
        durationMs: 40,
      },
      {
        type: 'signalWaitStarted',
        scenarioId: 's1',
        signal: 'relay',
        actorId: 'bob',
        timeoutMs: 5000,
      },
      {
        type: 'signalReceived',
        scenarioId: 's1',
        signal: 'relay',
        by: 'bob',
        from: 'alice',
        latencyMs: 2,
      },
      {
        type: 'stepStarted',
        scenarioId: 's1',
        stepId: 'st2',
        actorId: 'bob',
        text: 'bob fails',
      },
      {
        type: 'stepFinished',
        scenarioId: 's1',
        stepId: 'st2',
        actorId: 'bob',
        text: 'bob fails',
        status: 'failed',
        durationMs: 12,
        error: { code: 'KRK-STEP-FAILED', message: 'boom' },
      },
      { type: 'scenarioFinished', scenarioId: 's1', status: 'failed', durationMs: 200 },
    ];
    for (const event of events) reporter.onEvent(ev(event));

    const resultFile = readdirSync(resultsDir).find((f) => f.endsWith('-result.json'));
    expect(resultFile).toBeDefined();
    const result = JSON.parse(readFileSync(join(resultsDir, String(resultFile)), 'utf8'));

    expect(result.name).toBe('cross-device relay');
    expect(result.status).toBe('failed');
    expect(result.parameters).toContainEqual({ name: 'actor:alice', value: 'android (android)' });
    const names = result.steps.map((s: { name: string }) => s.name);
    expect(names).toContainEqual('[alice] alice writes "hola"');
    expect(names.some((n: string) => n.includes('⚡ received "relay" from alice'))).toBe(true);
    const failedStep = result.steps.find((s: { status: string }) => s.status === 'failed');
    expect(failedStep.statusDetails.message).toBe('boom');
    // every kraken step carries the machine-readable actor parameter
    expect(
      result.steps.every((s: { parameters?: { name: string }[] }) =>
        (s.parameters ?? []).some((p) => p.name === 'actor'),
      ),
    ).toBe(true);
  });
});
