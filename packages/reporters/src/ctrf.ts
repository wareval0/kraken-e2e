/**
 * CTRF reporter (ADR-0006 part B): hand-emitted, ZERO runtime deps.
 *
 * specVersion is pinned to "0.0.0" — what the reference implementation
 * (ctrf-io/ctrf-js) emits today; the spec itself is a pre-1.0 Working Draft.
 * The vendored official JSON Schema in tests guards the shape. Anything
 * Kraken-specific rides in `extra` (the schema is additionalProperties:false
 * everywhere else).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { KrakenEvent, Reporter } from '@kraken-e2e/contracts';

export const CTRF_SPEC_VERSION = '0.0.0';

interface CtrfTest {
  name: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending' | 'other';
  duration: number;
  start?: number;
  stop?: number;
  suite?: string[];
  message?: string;
  trace?: string;
  extra?: Record<string, unknown>;
}

/**
 * Projects the event stream into one CTRF report written at `runFinished`.
 * One CTRF test per scenario (steps ride in extra — CTRF has no step model).
 */
export function createCtrfReporter(
  outputPath: string,
  tool: { readonly name: string; readonly version?: string } = { name: 'kraken' },
): Reporter {
  const tests: CtrfTest[] = [];
  const open = new Map<string, CtrfTest & { failures: string[] }>();
  let runStart = 0;

  const onEvent = (event: KrakenEvent): void => {
    switch (event.type) {
      case 'runStarted':
        runStart = event.ts;
        return;
      case 'scenarioStarted':
        open.set(event.scenarioId, {
          name: event.name,
          status: 'other',
          duration: 0,
          start: event.ts,
          extra: {
            actors: event.actors.map((actor) => `${actor.id}:${actor.platform}`),
          },
          failures: [],
        });
        return;
      case 'stepFinished': {
        const test = open.get(event.scenarioId);
        if (test && event.status === 'failed') {
          test.failures.push(`${event.actorId}: ${event.text}`);
        }
        return;
      }
      case 'scenarioFinished': {
        const test = open.get(event.scenarioId);
        if (!test) return;
        open.delete(event.scenarioId);
        const { failures, ...rest } = test;
        const done: CtrfTest = {
          ...rest,
          status:
            event.status === 'passed'
              ? 'passed'
              : event.status === 'skipped'
                ? 'skipped'
                : 'failed',
          duration: event.durationMs,
          stop: event.ts,
        };
        if (failures.length > 0) {
          done.message = failures.join('\n');
        }
        tests.push(done);
        return;
      }
      case 'runFinished': {
        const summary = {
          tests: tests.length,
          passed: tests.filter((t) => t.status === 'passed').length,
          failed: tests.filter((t) => t.status === 'failed').length,
          skipped: tests.filter((t) => t.status === 'skipped').length,
          pending: 0,
          other: tests.filter((t) => t.status === 'other').length,
          start: runStart,
          stop: event.ts,
        };
        const report = {
          reportFormat: 'CTRF',
          specVersion: CTRF_SPEC_VERSION,
          results: {
            tool: { ...tool },
            summary,
            tests: tests.map(({ ...test }) => test),
          },
        };
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
        return;
      }
      default:
        return;
    }
  };

  return { id: 'ctrf', onEvent };
}
