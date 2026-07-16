import type { KrakenEvent } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { EventBus } from '../src/event-bus.ts';
import { krakenEventJsonSchema } from '../src/event-schemas.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('EventBus', () => {
  it('stamps a monotonic seq and the runId on every event', () => {
    const bus = new EventBus('run-1');
    const a = bus.emit({ type: 'runStarted', protocol: 1, scenarioCount: 1 });
    const b = bus.emit({ type: 'runFinished', status: 'passed', durationMs: 5 });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(a.runId).toBe('run-1');
    expect(a.ts).toBeGreaterThan(0);
  });

  it('preserves per-reporter ordering even with slow async reporters', async () => {
    const bus = new EventBus('run-1');
    const seen: number[] = [];
    bus.subscribe({
      id: 'slow',
      onEvent: async (event) => {
        await sleep(event.seq === 1 ? 20 : 1); // first event is slowest
        seen.push(event.seq);
      },
    });
    bus.emit({ type: 'runStarted', protocol: 1, scenarioCount: 0 });
    bus.emit({ type: 'runFinished', status: 'passed', durationMs: 1 });
    await bus.flush();
    expect(seen).toEqual([1, 2]);
  });

  it('contains reporter failures: reports once, never breaks the stream', async () => {
    const failures: string[] = [];
    const bus = new EventBus('run-1', {
      onReporterError: (reporterId) => void failures.push(reporterId),
    });
    const healthy: KrakenEvent[] = [];
    bus.subscribe({
      id: 'broken',
      onEvent: () => {
        throw new Error('reporter bug');
      },
    });
    bus.subscribe({ id: 'healthy', onEvent: (event) => void healthy.push(event) });
    bus.emit({ type: 'runStarted', protocol: 1, scenarioCount: 0 });
    bus.emit({ type: 'runFinished', status: 'passed', durationMs: 1 });
    await bus.flush();
    expect(healthy).toHaveLength(2);
    expect(failures).toEqual(['broken']); // reported once, not per event
  });

  it('rejects malformed events loudly (a core bug, not a user error)', () => {
    const bus = new EventBus('run-1');
    expect(() =>
      // @ts-expect-error — deliberately malformed
      bus.emit({ type: 'runStarted', protocol: 2, scenarioCount: 'many' }),
    ).toThrow(/malformed/);
  });

  it('exports a JSON Schema for external consumers (future GUI)', () => {
    const schema = krakenEventJsonSchema();
    expect(JSON.stringify(schema)).toContain('signalWaitStarted');
  });
});

describe('event schema evolution guard (additive-only — ADR-0001 §5.12)', () => {
  it('the generated JSON Schema matches the committed snapshot', async () => {
    // Changing this snapshot is an EVENT-PROTOCOL change: additive-only rules
    // apply (new optional fields at most; semantic change = new event type).
    // Review any diff against ADR-0002 D5 before updating.
    await expect(JSON.stringify(krakenEventJsonSchema(), null, 2)).toMatchFileSnapshot(
      './__snapshots__/kraken-events.schema.json',
    );
  });
});
