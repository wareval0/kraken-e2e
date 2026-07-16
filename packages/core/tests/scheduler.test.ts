import type { KrakenEvent } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { EventBus } from '../src/event-bus.ts';
import { type ActorRuntime, executePlan, type PlanNode } from '../src/scheduler.ts';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeActor(id: string): ActorRuntime {
  return {
    id,
    platform: 'fake',
    session: {} as ActorRuntime['session'],
    signals: {} as ActorRuntime['signals'],
    log: { debug() {}, info() {}, warn() {}, error() {} },
    data: {},
  };
}

function harness() {
  const events: KrakenEvent[] = [];
  const bus = new EventBus('run-sched');
  bus.subscribe({ id: 'capture', onEvent: (event) => void events.push(event) });
  const actors = new Map([
    ['alice', fakeActor('alice')],
    ['bob', fakeActor('bob')],
  ]);
  return { events, bus, actors, abortController: new AbortController() };
}

let nodeCounter = 0;
function node(partial: Partial<PlanNode> & Pick<PlanNode, 'actorId' | 'run'>): PlanNode {
  nodeCounter += 1;
  return {
    id: `n${nodeCounter}`,
    kind: 'step',
    title: partial.title ?? `node ${nodeCounter}`,
    dependsOn: [],
    ...partial,
  };
}

const plan = (nodes: PlanNode[]) => ({
  scenarioId: 's1',
  name: 'test scenario',
  actors: [
    { id: 'alice', platform: 'fake', config: {} },
    { id: 'bob', platform: 'fake', config: {} },
  ],
  nodes,
});

describe('executePlan — screenplay chain', () => {
  it('runs steps strictly in text order, alternating actors', async () => {
    const { events, bus, actors, abortController } = harness();
    const order: string[] = [];
    const result = await executePlan(
      plan([
        node({ actorId: 'alice', run: async () => void order.push('a1') }),
        node({ actorId: 'bob', run: async () => void order.push('b1') }),
        node({ actorId: 'alice', run: async () => void order.push('a2') }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('passed');
    expect(order).toEqual(['a1', 'b1', 'a2']);
    await bus.flush();
    expect(events.filter((e) => e.type === 'stepFinished')).toHaveLength(3);
  });

  it('failFast: first failure aborts, remaining steps are reported skipped', async () => {
    const { events, bus, actors, abortController } = harness();
    const executed: string[] = [];
    const result = await executePlan(
      plan([
        node({ actorId: 'alice', run: async () => void executed.push('a1') }),
        node({
          actorId: 'bob',
          title: 'the failing one',
          run: async () => {
            throw new Error('app broke');
          },
        }),
        node({ actorId: 'alice', run: async () => void executed.push('a2') }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('failed');
    expect(result.failedNodeId).toBeDefined();
    expect(executed).toEqual(['a1']); // a2 never ran
    expect(abortController.signal.aborted).toBe(true);
    await bus.flush();
    const statuses = events
      .filter((e): e is Extract<KrakenEvent, { type: 'stepFinished' }> => e.type === 'stepFinished')
      .map((e) => e.status);
    expect(statuses).toEqual(['passed', 'failed', 'skipped']);
  });

  it('shares one world across actors and steps', async () => {
    const { bus, actors, abortController } = harness();
    let observed: unknown;
    await executePlan(
      plan([
        node({
          actorId: 'alice',
          run: async ({ world }) => {
            world['messageId'] = 42;
          },
        }),
        node({
          actorId: 'bob',
          run: async ({ world }) => {
            observed = world['messageId'];
          },
        }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(observed).toBe(42);
  });
});

describe('executePlan — detached tasks (escape hatch #1)', () => {
  it('detach runs in the background; join awaits it; main cursor advances meanwhile', async () => {
    const { bus, actors, abortController } = harness();
    const order: string[] = [];
    const result = await executePlan(
      plan([
        node({
          actorId: 'alice',
          kind: 'detach',
          taskHandle: 'upload',
          run: async () => {
            await sleep(40);
            order.push('upload-done');
          },
        }),
        node({ actorId: 'bob', run: async () => void order.push('bob-acted') }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'upload',
          joinTimeoutMs: 1_000,
          run: async () => {},
        }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('passed');
    expect(order).toEqual(['bob-acted', 'upload-done']); // real overlap
  });

  it('an unjoined task fails the scenario (leak detection)', async () => {
    const { bus, actors, abortController } = harness();
    const result = await executePlan(
      plan([
        node({
          actorId: 'alice',
          kind: 'detach',
          taskHandle: 'forgotten',
          run: async () => sleep(5),
        }),
        node({ actorId: 'bob', run: async () => {} }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('failed');
    expect(KrakenError.is(result.error) && result.error.code).toBe('KRK-PLAN-UNJOINED-TASK');
  });

  it('join times out with a precise error when the task hangs', async () => {
    const { bus, actors, abortController } = harness();
    const result = await executePlan(
      plan([
        node({
          actorId: 'alice',
          kind: 'detach',
          taskHandle: 'slow',
          run: async ({ abort }) =>
            new Promise((resolve) => {
              const timer = setTimeout(resolve, 5_000);
              abort.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve(undefined);
              });
            }),
        }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'slow',
          joinTimeoutMs: 50,
          run: async () => {},
        }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('failed');
    expect(KrakenError.is(result.error) && result.error.code).toBe('KRK-PLAN-TASK-JOIN-TIMEOUT');
  });

  it('a failing detached task surfaces at its join, wrapped with the handle name', async () => {
    const { bus, actors, abortController } = harness();
    const result = await executePlan(
      plan([
        node({
          actorId: 'alice',
          kind: 'detach',
          taskHandle: 'doomed',
          run: async () => {
            await sleep(5);
            throw new Error('background exploded');
          },
        }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'doomed',
          joinTimeoutMs: 1_000,
          run: async () => {},
        }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('failed');
    expect(result.error).toSatisfy(
      (error: unknown) =>
        KrakenError.is(error) &&
        error.message.includes('doomed') &&
        error.message.includes('background exploded'),
    );
  });

  it('joining an unknown handle and duplicate handles are precise errors', async () => {
    const { bus, actors, abortController } = harness();
    const result = await executePlan(
      plan([
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'ghost',
          joinTimeoutMs: 50,
          run: async () => {},
        }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(KrakenError.is(result.error) && result.error.code).toBe('KRK-PLAN-UNKNOWN-TASK');

    const { bus: bus2, actors: actors2, abortController: ac2 } = harness();
    const dup = await executePlan(
      plan([
        node({ actorId: 'alice', kind: 'detach', taskHandle: 'x', run: async () => sleep(5) }),
        node({ actorId: 'alice', kind: 'detach', taskHandle: 'x', run: async () => sleep(5) }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'x',
          joinTimeoutMs: 500,
          run: async () => {},
        }),
      ]),
      { actors: actors2, events: bus2, abortController: ac2 },
    );
    expect(KrakenError.is(dup.error) && dup.error.code).toBe('KRK-PLAN-DUPLICATE-TASK');
  });
});

describe('regression: detach/drain hardening (phase1-verify majors)', () => {
  it('duplicate detach handles fail WITHOUT starting the second task (check-then-start)', async () => {
    const { bus, actors, abortController } = harness();
    let secondStarted = false;
    const result = await executePlan(
      plan([
        node({ actorId: 'alice', kind: 'detach', taskHandle: 'x', run: async () => sleep(5) }),
        node({
          actorId: 'alice',
          kind: 'detach',
          taskHandle: 'x',
          run: async () => {
            secondStarted = true;
            await sleep(5);
          },
        }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'x',
          joinTimeoutMs: 500,
          run: async () => {},
        }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('failed');
    expect(KrakenError.is(result.error) && result.error.code).toBe('KRK-PLAN-DUPLICATE-TASK');
    expect(secondStarted).toBe(false); // the body never ran — no untracked zombie task
  });

  it('an abort-ignoring detached task fails the scenario after the drain budget instead of hanging', async () => {
    const { bus, actors, abortController } = harness();
    const result = await executePlan(
      plan([
        node({
          actorId: 'alice',
          kind: 'detach',
          taskHandle: 'stubborn',
          run: () => new Promise(() => {}), // ignores ctx.abort forever
        }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'stubborn',
          joinTimeoutMs: 30,
          run: async () => {},
        }),
      ]),
      { actors, events: bus, abortController, drainTimeoutMs: 80 },
    );
    expect(result.status).toBe('failed');
    // The join timeout fires first; the key property is that executePlan RETURNED.
  });

  it('a join node without joinTimeoutMs is an explicit error (no silent 30s default)', async () => {
    const { bus, actors, abortController } = harness();
    const result = await executePlan(
      plan([
        node({ actorId: 'alice', kind: 'detach', taskHandle: 'x', run: async () => sleep(5) }),
        node({ actorId: 'alice', kind: 'join', taskHandle: 'x', run: async () => {} }),
      ]),
      { actors, events: bus, abortController },
    );
    expect(result.status).toBe('failed');
    expect(KrakenError.is(result.error) && result.error.message).toContain('joinTimeoutMs');
  });
});

describe('executePlan — per-step screenshots', () => {
  it("captures the acting actor's screenshot after each passed step and emits artifactCaptured", async () => {
    const { events, bus, actors, abortController } = harness();
    const shots: string[] = [];
    for (const [id, actor] of actors) {
      (actor as { session: unknown }).session = {
        screenshot: async () => {
          shots.push(id);
          return { kind: 'screenshot', path: `/tmp/${id}.png` };
        },
      };
    }
    const result = await executePlan(
      plan([
        node({ actorId: 'alice', run: async () => {} }),
        node({ actorId: 'bob', run: async () => {} }),
      ]),
      { actors, events: bus, abortController, screenshots: 'per-step' },
    );
    expect(result.status).toBe('passed');
    expect(shots).toEqual(['alice', 'bob']);
    await bus.flush(); // reporter delivery is an async chain
    const captured = events.filter((event) => event.type === 'artifactCaptured');
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({ actorId: 'alice', kind: 'screenshot' });
  });

  it('detach/join nodes never trigger per-step captures', async () => {
    const { bus, actors, abortController } = harness();
    const shots: string[] = [];
    for (const [id, actor] of actors) {
      (actor as { session: unknown }).session = {
        screenshot: async () => {
          shots.push(id);
          return { kind: 'screenshot', path: `/tmp/${id}.png` };
        },
      };
    }
    const result = await executePlan(
      plan([
        node({ actorId: 'alice', kind: 'detach', taskHandle: 'bg', run: async () => {} }),
        node({
          actorId: 'alice',
          kind: 'join',
          taskHandle: 'bg',
          joinTimeoutMs: 1000,
          run: async () => {},
        }),
        node({ actorId: 'bob', run: async () => {} }),
      ]),
      { actors, events: bus, abortController, screenshots: 'per-step' },
    );
    expect(result.status).toBe('passed');
    expect(shots).toEqual(['bob']); // only the real step captured
  });

  it('a failing screenshot never fails the step; default mode captures nothing', async () => {
    const { events, bus, actors, abortController } = harness();
    (actors.get('alice') as { session: unknown } | undefined)!.session = {
      screenshot: async () => {
        throw new Error('device gone');
      },
    };
    const withBroken = await executePlan(plan([node({ actorId: 'alice', run: async () => {} })]), {
      actors,
      events: bus,
      abortController,
      screenshots: 'per-step',
    });
    expect(withBroken.status).toBe('passed');

    const defaults = await executePlan(plan([node({ actorId: 'alice', run: async () => {} })]), {
      actors,
      events: bus,
      abortController: new AbortController(),
    });
    expect(defaults.status).toBe('passed');
    await bus.flush();
    expect(events.filter((event) => event.type === 'artifactCaptured')).toHaveLength(0);
  });
});
