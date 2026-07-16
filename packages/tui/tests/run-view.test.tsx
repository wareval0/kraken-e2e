import type { KrakenEvent, KrakenEventInput } from '@kraken-e2e/contracts';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { RunView } from '../src/run-view.tsx';
import { RunViewStore } from '../src/store.ts';

const base = { ts: 1, runId: 'r' };
let seq = 0;
const ev = (event: KrakenEventInput): KrakenEvent =>
  ({ ...base, seq: ++seq, ...event }) as KrakenEvent;

/** External-store dispatches flush on React's schedule — give it a tick. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('RunView (Ink 7 live lanes)', () => {
  it('renders actor lanes with the signal-wait signature moment', async () => {
    const store = new RunViewStore();
    const { lastFrame } = render(<RunView store={store} />);

    store.dispatch(
      ev({
        type: 'scenarioStarted',
        scenarioId: 's1',
        name: 'cross-platform messaging',
        actors: [
          { id: 'alice', platform: 'android', driverId: 'android' },
          { id: 'bob', platform: 'ios', driverId: 'ios' },
        ],
      }),
    );
    store.dispatch(
      ev({
        type: 'stepStarted',
        scenarioId: 's1',
        stepId: 'st1',
        actorId: 'alice',
        text: 'alice taps send',
      }),
    );
    store.dispatch(
      ev({
        type: 'signalWaitStarted',
        scenarioId: 's1',
        signal: 'message-sent',
        actorId: 'bob',
        timeoutMs: 5000,
      }),
    );

    await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Scenario: cross-platform messaging');
    expect(frame).toContain('▶ alice');
    expect(frame).toContain('alice taps send');
    expect(frame).toContain('⏳ bob');
    expect(frame).toContain('waiting for signal "message-sent"');
  });

  it('moves finished steps into the static region and shows the run summary', async () => {
    const store = new RunViewStore();
    const { lastFrame } = render(<RunView store={store} />);
    store.dispatch(
      ev({
        type: 'scenarioStarted',
        scenarioId: 's1',
        name: 'demo',
        actors: [{ id: 'alice', platform: 'android', driverId: 'android' }],
      }),
    );
    store.dispatch(
      ev({
        type: 'stepFinished',
        scenarioId: 's1',
        stepId: 'st1',
        actorId: 'alice',
        text: 'alice writes "hola"',
        status: 'passed',
        durationMs: 42,
      }),
    );
    store.dispatch(
      ev({ type: 'scenarioFinished', scenarioId: 's1', status: 'passed', durationMs: 100 }),
    );
    store.dispatch(ev({ type: 'runFinished', status: 'passed', durationMs: 120 }));

    await flush();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓ [alice] alice writes "hola" (42ms)');
    expect(frame).toContain('✓ scenario "demo" passed in 100ms');
    expect(frame).toContain('Run passed in 120ms');
  });
});
