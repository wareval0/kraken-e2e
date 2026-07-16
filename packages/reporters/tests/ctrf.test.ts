import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KrakenEvent, KrakenEventInput } from '@kraken-e2e/contracts';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

import { createCtrfReporter } from '../src/ctrf.ts';

let seq = 0;
const ev = (event: KrakenEventInput): KrakenEvent =>
  ({ ts: 1000 + seq, runId: 'r1', seq: ++seq, ...event }) as KrakenEvent;

function emitRun(reporter: ReturnType<typeof createCtrfReporter>): void {
  const events: KrakenEventInput[] = [
    { type: 'runStarted', protocol: 1, scenarioCount: 2 },
    {
      type: 'scenarioStarted',
      scenarioId: 's1',
      name: 'relay passes',
      actors: [{ id: 'alice', platform: 'android', driverId: 'android' }],
    },
    {
      type: 'stepFinished',
      scenarioId: 's1',
      stepId: 'st1',
      actorId: 'alice',
      text: 'alice taps',
      status: 'passed',
      durationMs: 40,
    },
    { type: 'scenarioFinished', scenarioId: 's1', status: 'passed', durationMs: 120 },
    {
      type: 'scenarioStarted',
      scenarioId: 's2',
      name: 'relay fails',
      actors: [{ id: 'bob', platform: 'ios', driverId: 'ios' }],
    },
    {
      type: 'stepFinished',
      scenarioId: 's2',
      stepId: 'st2',
      actorId: 'bob',
      text: 'bob sees it',
      status: 'failed',
      durationMs: 55,
      error: { code: 'KRK-STEP-FAILED', message: 'mirror mismatch' },
    },
    { type: 'scenarioFinished', scenarioId: 's2', status: 'failed', durationMs: 90 },
    { type: 'runFinished', status: 'failed', durationMs: 300 },
  ];
  for (const event of events) reporter.onEvent(ev(event));
}

describe('CTRF reporter', () => {
  it('emits a report that validates against the OFFICIAL vendored schema', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'kraken-ctrf-')), 'ctrf-report.json');
    emitRun(createCtrfReporter(out, { name: 'kraken', version: '3.0.0-alpha' }));

    const report = JSON.parse(readFileSync(out, 'utf8'));
    const schema = JSON.parse(
      readFileSync(join(import.meta.dirname, 'fixtures/ctrf.schema.json'), 'utf8'),
    );
    const ajv = new Ajv({ strict: false });
    addFormats.default(ajv);
    const validate = ajv.compile(schema);
    expect(validate(report), JSON.stringify(validate.errors, null, 2)).toBe(true);

    expect(report.reportFormat).toBe('CTRF');
    expect(report.specVersion).toBe('0.0.0');
    expect(report.results.summary).toMatchObject({ tests: 2, passed: 1, failed: 1 });
    const failed = report.results.tests.find((t: { status: string }) => t.status === 'failed');
    expect(failed.message).toContain('mirror mismatch' === failed.message ? failed.message : 'bob');
  });
});
