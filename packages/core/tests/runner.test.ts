/**
 * Orchestrator tests on FakeDriver: real cross-actor E2E with zero devices —
 * a message "sent" by alice appears on bob's screen after fake app latency,
 * choreographed with signals and polling waits (ADR-0002 D7/D9).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { HostContext, KrakenEvent } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';
import { InMemoryTransport, SignalBus } from '@kraken-e2e/signaling';
import { describe, expect, it } from 'vitest';

import { DriverRegistry } from '../src/registry.ts';
import { runScenarios } from '../src/runner.ts';
import { scenario } from '../src/scenario.ts';
import { createFakeDriver, FakeAppWorld } from '../src/testing/fake-driver.ts';

const HOST: HostContext = {
  platform: 'linux',
  arch: 'x64',
  nodeVersion: '22.19.0',
  env: {},
};

function messagingWorld(): FakeAppWorld {
  const world = new FakeAppWorld();
  world.setElement('alice', 'composer', { text: '', visible: true });
  world.setElement('alice', 'send', { text: 'Send', visible: true });
  world.setElement('bob', 'message-cell', { text: '', visible: false });
  // The fake "backend": tapping send delivers alice's composer text to bob
  // after 60ms of simulated network latency.
  world.onAction = (action, w) => {
    if (action.op === 'tap' && action.target?.by === 'testId' && action.target.value === 'send') {
      const message = w.getElement('alice', 'composer')?.text ?? '';
      w.after(60, () => w.setElement('bob', 'message-cell', { text: message, visible: true }));
    }
  };
  return world;
}

async function setup(world: FakeAppWorld) {
  const driver = createFakeDriver({ world, id: 'fake', platforms: ['fake'] });
  const events: KrakenEvent[] = [];
  const registry = await DriverRegistry.create({ registrations: [driver], host: HOST });
  return {
    registry,
    events,
    reporter: { id: 'capture', onEvent: (event: KrakenEvent) => void events.push(event) },
    signalBus: new SignalBus(new InMemoryTransport()),
    artifactsDir: mkdtempSync(join(tmpdir(), 'kraken-core-test-')),
  };
}

const ACTORS = [
  { id: 'alice', platform: 'fake', config: {} },
  { id: 'bob', platform: 'fake', config: {} },
];

describe('runScenarios on FakeDriver', () => {
  it('runs a two-actor messaging choreography with signals end to end', async () => {
    const world = messagingWorld();
    const { registry, events, reporter, signalBus, artifactsDir } = await setup(world);

    const plan = scenario('message from alice arrives at bob')
      .step('alice', 'alice writes the message', async ({ actor }) => {
        await actor.session.typeText({ by: 'testId', value: 'composer' }, 'hola desde los Andes');
      })
      .step('alice', 'alice sends it and announces it', async ({ actor }) => {
        await actor.session.tap({ by: 'testId', value: 'send' });
        await actor.signals.publish('message-sent', { text: 'hola desde los Andes' });
      })
      .step('bob', 'bob waits for the announcement and sees the message', async ({ actor }) => {
        const record = await actor.signals.waitFor<{ text: string }>('message-sent', {
          timeoutMs: 2_000,
        });
        await actor.session.waitFor({ by: 'testId', value: 'message-cell' }, 'visible', {
          timeoutMs: 2_000,
        });
        const text = await actor.session.readText({ by: 'testId', value: 'message-cell' });
        expect(text).toBe(record.payload.text);
      })
      .build({ actors: ACTORS, scenarioId: 'messaging-1' });

    const result = await runScenarios({
      plans: [plan],
      registry,
      signalBus,
      hostContext: HOST,
      reporters: [reporter],
      artifactsDir,
    });

    expect(result.status).toBe('passed');
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('runStarted');
    expect(types.at(-1)).toBe('runFinished');
    expect(types).toContain('actorSessionStarted');
    expect(types).toContain('signalSent');
    expect(types).toContain('signalWaitStarted');
    expect(types).toContain('signalReceived');
    // seq is strictly increasing across the whole run.
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('captures artifacts from ALL actors when a step fails, then tears down', async () => {
    const world = messagingWorld();
    const { registry, events, reporter, signalBus, artifactsDir } = await setup(world);

    const plan = scenario('failing choreography')
      .step('alice', 'alice does something fine', async ({ actor }) => {
        await actor.session.tap({ by: 'testId', value: 'send' });
      })
      .step('bob', 'bob asserts something false', async ({ actor }) => {
        await actor.session.readText({ by: 'testId', value: 'does-not-exist' });
      })
      .build({ actors: ACTORS, scenarioId: 'failing-1' });

    const result = await runScenarios({
      plans: [plan],
      registry,
      signalBus,
      hostContext: HOST,
      reporters: [reporter],
      artifactsDir,
    });

    expect(result.status).toBe('failed');
    const artifacts = events.filter(
      (event): event is Extract<KrakenEvent, { type: 'artifactCaptured' }> =>
        event.type === 'artifactCaptured',
    );
    // One screenshot per actor — the all-actors snapshot (ADR-0002 D7).
    expect(new Set(artifacts.map((a) => a.actorId))).toEqual(new Set(['alice', 'bob']));
    const finished = events.find((event) => event.type === 'scenarioFinished');
    expect(finished?.type === 'scenarioFinished' && finished.status).toBe('failed');
    expect(finished?.type === 'scenarioFinished' && finished.error?.code).toBe(
      'KRK-SESSION-ELEMENT-NOT-FOUND',
    );
  });

  it('rolls back booted sessions when another actor fails to boot', async () => {
    const world = messagingWorld();
    const driver = createFakeDriver({ world, id: 'fake', platforms: ['fake'] });
    // A second driver whose createSession always fails.
    const broken = createFakeDriver({ world, id: 'broken', platforms: ['broken'] });
    const failingDriver = {
      ...broken,
      createSession: async () => {
        throw new Error('emulator refused to boot');
      },
    };
    const registry = await DriverRegistry.create({
      registrations: [driver, failingDriver],
      host: HOST,
    });
    const { events, reporter, signalBus, artifactsDir } = await setup(world);

    const plan = scenario('boot failure')
      .step('alice', 'never runs', async () => {})
      .build({
        actors: [
          { id: 'alice', platform: 'fake', config: {} },
          { id: 'ghost', platform: 'broken', config: {} },
        ],
        scenarioId: 'boot-fail-1',
      });

    const result = await runScenarios({
      plans: [plan],
      registry,
      signalBus,
      hostContext: HOST,
      reporters: [reporter],
      artifactsDir,
    });

    expect(result.status).toBe('failed');
    const scenarioResult = result.scenarios[0];
    expect(KrakenError.is(scenarioResult?.error) ? scenarioResult.error.code : undefined).toBe(
      'KRK-SESSION-CREATE-FAILED',
    );
    // No step ever ran.
    expect(events.some((event) => event.type === 'stepStarted')).toBe(false);
  });

  it('fails fast pre-run when an actor binds to an unknown platform', async () => {
    const world = messagingWorld();
    const { registry, signalBus, artifactsDir, reporter } = await setup(world);
    const plan = scenario('bad binding')
      .step('alice', 'never runs', async () => {})
      .build({
        actors: [{ id: 'alice', platform: 'ios', config: {} }],
        scenarioId: 'bad-binding-1',
      });
    await expect(
      runScenarios({
        plans: [plan],
        registry,
        signalBus,
        hostContext: HOST,
        reporters: [reporter],
        artifactsDir,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => KrakenError.is(error) && error.code === 'KRK-DRIVER-UNKNOWN-PLATFORM',
    );
  });
});

describe('runScenarios — screenshot policies', () => {
  function failingPlan() {
    return scenario('a step that fails')
      .step('alice', 'alice taps a ghost', async ({ actor }) => {
        await actor.session.tap({ by: 'testId', value: 'does-not-exist' });
      })
      .build({ actors: ACTORS, scenarioId: 'shots-1' });
  }

  it("'off' disables both failure artifacts and per-step captures", async () => {
    const { registry, events, reporter, signalBus, artifactsDir } = await setup(messagingWorld());
    const result = await runScenarios({
      plans: [failingPlan()],
      registry,
      signalBus,
      hostContext: HOST,
      reporters: [reporter],
      artifactsDir,
      screenshots: 'off',
    });
    expect(result.status).toBe('failed');
    expect(events.filter((event) => event.type === 'artifactCaptured')).toHaveLength(0);
  });

  it("the default ('on-failure') still captures every actor's artifacts", async () => {
    const { registry, events, reporter, signalBus, artifactsDir } = await setup(messagingWorld());
    const result = await runScenarios({
      plans: [failingPlan()],
      registry,
      signalBus,
      hostContext: HOST,
      reporters: [reporter],
      artifactsDir,
    });
    expect(result.status).toBe('failed');
    const captured = events.filter((event) => event.type === 'artifactCaptured');
    expect(captured.length).toBeGreaterThan(0);
  });

  it("'per-step' stamps each capture with the step it documents", async () => {
    const world = messagingWorld();
    const { registry, events, reporter, signalBus, artifactsDir } = await setup(world);
    const plan = scenario('two passing steps')
      .step('alice', 'alice writes', async ({ actor }) => {
        await actor.session.typeText({ by: 'testId', value: 'composer' }, 'hi');
      })
      .step('alice', 'alice sends', async ({ actor }) => {
        await actor.session.tap({ by: 'testId', value: 'send' });
      })
      .build({ actors: ACTORS, scenarioId: 'shots-2' });
    const result = await runScenarios({
      plans: [plan],
      registry,
      signalBus,
      hostContext: HOST,
      reporters: [reporter],
      artifactsDir,
      screenshots: 'per-step',
    });
    expect(result.status).toBe('passed');
    const captured = events.filter(
      (event) => event.type === 'artifactCaptured' && 'stepId' in event && event.stepId,
    );
    expect(captured).toHaveLength(2);
  });
});
