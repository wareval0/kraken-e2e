import { describe, expect, it } from 'vitest';

import { SignalBus } from '../src/bus.ts';
import { SignalPayloadError, SignalTimeoutError, SignalUsageError } from '../src/errors.ts';
import { InMemoryTransport } from '../src/in-memory-transport.ts';

let scenarioCounter = 0;
async function openScoped(busOptions = {}) {
  const bus = new SignalBus(new InMemoryTransport(), busOptions);
  scenarioCounter += 1;
  const scoped = bus.scope({ runId: 'run', scenarioId: `s${scenarioCounter}` });
  await scoped.open();
  return scoped;
}

describe('SignalBus cursors and delivery semantics (ADR-0003 D3)', () => {
  it('replays publish-before-wait through the actor facade', async () => {
    const scoped = await openScoped();
    const alice = scoped.forActor('alice');
    const bob = scoped.forActor('bob');
    await alice.publish('message-sent', { id: 7 });
    const record = await bob.waitFor('message-sent', { timeoutMs: 500 });
    expect(record.payload).toEqual({ id: 7 });
    expect(record.from).toBe('alice');
  });

  it('counts FIFO per subscriber: N publishes satisfy N sequential waits in order', async () => {
    const scoped = await openScoped();
    const alice = scoped.forActor('alice');
    const bob = scoped.forActor('bob');
    await alice.publish('tick', 1);
    await alice.publish('tick', 2);
    await alice.publish('tick', 3);
    const seen: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      seen.push((await bob.waitFor('tick', { timeoutMs: 500 })).payload);
    }
    expect(seen).toEqual([1, 2, 3]);
    // A fourth wait finds nothing new.
    await expect(bob.waitFor('tick', { timeoutMs: 40 })).rejects.toBeInstanceOf(SignalTimeoutError);
  });

  it('broadcasts: distinct subscribers each receive the same record', async () => {
    const scoped = await openScoped();
    await scoped.forActor('alice').publish('go');
    const bob = await scoped.forActor('bob').waitFor('go', { timeoutMs: 500 });
    const carol = await scoped.forActor('carol').waitFor('go', { timeoutMs: 500 });
    expect(bob.seq).toBe(carol.seq);
  });

  it('keeps cursors independent per signal name (waiting B then A still finds A)', async () => {
    const scoped = await openScoped();
    const alice = scoped.forActor('alice');
    const bob = scoped.forActor('bob');
    await alice.publish('a-done');
    await alice.publish('b-done');
    const first = await bob.waitFor('b-done', { timeoutMs: 500 });
    const second = await bob.waitFor('a-done', { timeoutMs: 500 });
    expect(first.name).toBe('b-done');
    expect(second.name).toBe('a-done');
  });

  it('consumes where-rejected records permanently for that cursor', async () => {
    const scoped = await openScoped();
    const alice = scoped.forActor('alice');
    const bob = scoped.forActor('bob');
    await alice.publish('msg', { n: 1 });
    await alice.publish('msg', { n: 2 });
    const match = await bob.waitFor<{ n: number }>('msg', {
      timeoutMs: 500,
      where: (payload) => payload.n === 2,
    });
    expect(match.payload).toEqual({ n: 2 });
    // Record n=1 was consumed while being skipped; nothing remains for bob/msg.
    await expect(bob.waitFor('msg', { timeoutMs: 40 })).rejects.toBeInstanceOf(SignalTimeoutError);
  });

  it('rejects concurrent identical waits by the same subscriber (SignalUsageError)', async () => {
    const scoped = await openScoped();
    const bob = scoped.forActor('bob');
    const first = bob.waitFor('x', { timeoutMs: 300 });
    await expect(bob.waitFor('x', { timeoutMs: 300 })).rejects.toBeInstanceOf(SignalUsageError);
    await scoped.forActor('alice').publish('x');
    await first; // the original wait still completes normally
  });

  it('allows a fresh wait after a timeout (pending-set cleanup)', async () => {
    const scoped = await openScoped();
    const bob = scoped.forActor('bob');
    await expect(bob.waitFor('x', { timeoutMs: 30 })).rejects.toBeInstanceOf(SignalTimeoutError);
    await scoped.forActor('alice').publish('x');
    await expect(bob.waitFor('x', { timeoutMs: 300 })).resolves.toMatchObject({ name: 'x' });
  });

  it('filters by publisher with `from`', async () => {
    const scoped = await openScoped();
    await scoped.forActor('mallory').publish('done');
    const pending = scoped.forActor('bob').waitFor('done', { timeoutMs: 500, from: 'alice' });
    await scoped.forActor('alice').publish('done');
    expect((await pending).from).toBe('alice');
  });
});

describe('SignalBus diagnostics and payload discipline', () => {
  it('enriches timeouts with subscriber, history, and near-miss suggestions', async () => {
    const scoped = await openScoped();
    await scoped.forActor('alice').publish('message-sent');
    try {
      await scoped.forActor('bob').waitFor('mesage-sent', { timeoutMs: 40 });
      expect.unreachable('must time out');
    } catch (error) {
      expect(error).toBeInstanceOf(SignalTimeoutError);
      const detail = (error as SignalTimeoutError).detail;
      expect(detail.subscriberId).toBe('bob');
      expect(detail.nearMissNames).toContain('message-sent');
      expect((error as Error).message).toContain('Did you mean');
    }
  });

  it('rejects non-JSON-serializable payloads with a didactic error', async () => {
    const scoped = await openScoped();
    const alice = scoped.forActor('alice');
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    await expect(alice.publish('bad', cyclic as never)).rejects.toBeInstanceOf(SignalPayloadError);
  });

  it('enforces the payload size cap', async () => {
    const scoped = await openScoped({ maxPayloadBytes: 32 });
    const alice = scoped.forActor('alice');
    await expect(alice.publish('big', 'x'.repeat(64))).rejects.toBeInstanceOf(SignalPayloadError);
    await expect(alice.publish('small', 'ok')).resolves.toMatchObject({ name: 'small' });
  });

  it('warns once past the per-scope record threshold', async () => {
    const warnings: string[] = [];
    const scoped = await openScoped({
      scopeRecordWarnThreshold: 3,
      onWarning: (message: string) => warnings.push(message),
    });
    const alice = scoped.forActor('alice');
    for (let i = 0; i < 6; i += 1) await alice.publish('spam', i);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('runaway');
  });
});

describe('barrier sugar', () => {
  it('synchronizes all participants and resolves for each of them', async () => {
    const scoped = await openScoped();
    const participants = ['alice', 'bob', 'carol'];
    await Promise.all(
      participants.map((actorId) =>
        scoped.forActor(actorId).barrier('ready', { participants, timeoutMs: 1_000 }),
      ),
    );
  });

  it('times out when a participant never arrives', async () => {
    const scoped = await openScoped();
    await expect(
      scoped
        .forActor('alice')
        .barrier('ready', { participants: ['alice', 'ghost'], timeoutMs: 60 }),
    ).rejects.toBeInstanceOf(SignalTimeoutError);
  });
});

describe('regression: from-filter cursor channels (phase1-verify blocker)', () => {
  it('a from-filtered wait must NOT advance past other senders records', async () => {
    const scoped = await openScoped();
    await scoped.forActor('bob').publish('ready'); // seq 1
    await scoped.forActor('alice').publish('ready'); // seq 2
    const charlie = scoped.forActor('charlie');
    const fromAlice = await charlie.waitFor('ready', { timeoutMs: 300, from: 'alice' });
    expect(fromAlice.from).toBe('alice');
    // Before the fix this timed out: the shared cursor had advanced to seq 2.
    const fromBob = await charlie.waitFor('ready', { timeoutMs: 300, from: 'bob' });
    expect(fromBob.from).toBe('bob');
    // And the unfiltered channel still counts FIFO from the top.
    const first = await charlie.waitFor('ready', { timeoutMs: 300 });
    expect(first.seq).toBe(1);
  });

  it('quoted-alias subscribers with spaces cannot collide pending-wait keys', async () => {
    const scoped = await openScoped();
    const moderator = scoped.forActor('the moderator');
    const the = scoped.forActor('the');
    // Distinct (subscriber, name) pairs that a naive space-joined key would merge.
    const w1 = moderator.waitFor('x', { timeoutMs: 200 });
    const w2 = the.waitFor('moderator x', { timeoutMs: 200 });
    await scoped.forActor('a').publish('x');
    await scoped.forActor('a').publish('moderator x');
    await expect(w1).resolves.toMatchObject({ name: 'x' });
    await expect(w2).resolves.toMatchObject({ name: 'moderator x' });
  });

  it('concurrent waits on the same name with DIFFERENT from-filters are distinct channels', async () => {
    const scoped = await openScoped();
    const charlie = scoped.forActor('charlie');
    const fromAlice = charlie.waitFor('go', { timeoutMs: 400, from: 'alice' });
    const fromBob = charlie.waitFor('go', { timeoutMs: 400, from: 'bob' });
    await scoped.forActor('bob').publish('go');
    await scoped.forActor('alice').publish('go');
    expect((await fromAlice).from).toBe('alice');
    expect((await fromBob).from).toBe('bob');
  });
});
