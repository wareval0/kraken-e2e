import type { TargetLocator, UserSession } from '@kraken-e2e/contracts';
import { describe, expect, it, vi } from 'vitest';

import { planFuzz, replayTrace, runFuzz } from '../src/index.ts';
import { mulberry32, pickWeighted } from '../src/random.ts';

const SURFACE = {
  tappable: [
    { by: 'testId', value: 'a' },
    { by: 'testId', value: 'b' },
  ] as TargetLocator[],
  typable: [{ by: 'testId', value: 'input' }] as TargetLocator[],
};

function recordingSession(failAt?: number): { session: UserSession; log: string[] } {
  const log: string[] = [];
  let count = 0;
  const act = (desc: string) => {
    count += 1;
    if (failAt !== undefined && count === failAt) throw new Error(`boom at ${desc}`);
    log.push(desc);
  };
  const session = {
    actorId: 'fuzzer',
    driverId: 'fake',
    platform: 'fake',
    capabilities: {},
    tap: vi.fn(async (t: TargetLocator) => act(`tap:${t.value}`)),
    typeText: vi.fn(async (t: TargetLocator, text: string) => act(`type:${t.value}:${text}`)),
    pressKey: vi.fn(async (k: string) => act(`key:${k}`)),
    scrollIntoView: vi.fn(async (t: TargetLocator) => act(`scroll:${t.value}`)),
    readText: vi.fn(async () => ''),
    waitFor: vi.fn(async () => {}),
    isDisplayed: vi.fn(async () => true),
    navigate: vi.fn(async () => {}),
    screenshot: vi.fn(async () => ({ kind: 'screenshot', path: '/tmp/fuzz-fail.png' })),
    source: vi.fn(async () => ''),
    dispose: vi.fn(async () => {}),
    native: vi.fn(),
  } as unknown as UserSession;
  return { session, log };
}

describe('mulberry32 determinism', () => {
  it('same seed → identical sequence; different seed → different', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
  });

  it('pickWeighted respects zero weights', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 50; i += 1) {
      expect(
        pickWeighted(rng, [
          ['never', 0],
          ['always', 1],
        ]),
      ).toBe('always');
    }
  });
});

describe('planFuzz (pure)', () => {
  it('is reproducible: same seed+surface → identical plan', () => {
    const p1 = planFuzz({ surface: SURFACE, steps: 25, seed: 1234 });
    const p2 = planFuzz({ surface: SURFACE, steps: 25, seed: 1234 });
    expect(p1).toEqual(p2);
    expect(p1).toHaveLength(25);
  });

  it('only plans kinds whose pool exists (or pressKey)', () => {
    const plan = planFuzz({ surface: { tappable: SURFACE.tappable }, steps: 40, seed: 9 });
    expect(plan.every((e) => e.kind === 'tap' || e.kind === 'pressKey')).toBe(true);
  });

  it('throws on an empty surface with all pools missing', () => {
    expect(() => planFuzz({ surface: {}, steps: 5, seed: 1, weights: { pressKey: 0 } })).toThrow(
      /surface is empty/,
    );
  });
});

describe('runFuzz', () => {
  it('executes the planned walk and reports completed', async () => {
    const { session, log } = recordingSession();
    const result = await runFuzz({ session, surface: SURFACE, steps: 12, seed: 99 });
    expect(result.status).toBe('completed');
    expect(result.trace).toHaveLength(12);
    expect(log).toHaveLength(12);
  });

  it('same seed → same executed walk (replay = rerun)', async () => {
    const runA = recordingSession();
    const runB = recordingSession();
    await runFuzz({ session: runA.session, surface: SURFACE, steps: 15, seed: 7 });
    await runFuzz({ session: runB.session, surface: SURFACE, steps: 15, seed: 7 });
    expect(runB.log).toEqual(runA.log);
  });

  it('captures failure with screenshot evidence and the executed prefix', async () => {
    const { session } = recordingSession(5);
    const result = await runFuzz({ session, surface: SURFACE, steps: 10, seed: 3 });
    expect(result.status).toBe('failed');
    expect(result.trace).toHaveLength(4);
    expect(result.failure?.screenshotPath).toBe('/tmp/fuzz-fail.png');
    expect(String((result.failure?.error as Error).message)).toContain('boom');
  });

  it('replayTrace re-executes a captured trace verbatim', async () => {
    const original = recordingSession();
    const result = await runFuzz({
      session: original.session,
      surface: SURFACE,
      steps: 8,
      seed: 21,
    });
    const replay = recordingSession();
    await replayTrace(replay.session, result.trace);
    expect(replay.log).toEqual(original.log);
  });

  it('tolerates action errors up to the budget and records them', async () => {
    const { session } = recordingSession(3); // action 3 throws
    const tolerant = await runFuzz({
      session,
      surface: SURFACE,
      steps: 10,
      seed: 3,
      tolerateActionErrors: 5,
    });
    expect(tolerant.status).toBe('completed');
    expect(tolerant.errors).toHaveLength(1);
    expect(tolerant.trace).toHaveLength(9); // 10 planned - 1 tolerated failure
    expect(tolerant.errors[0]?.message).toContain('boom');

    const strict = await runFuzz({
      session: recordingSession(3).session,
      surface: SURFACE,
      steps: 10,
      seed: 3,
    });
    expect(strict.status).toBe('failed');
  });

  it('aborts cooperatively', async () => {
    const { session } = recordingSession();
    const controller = new AbortController();
    controller.abort();
    const result = await runFuzz({
      session,
      surface: SURFACE,
      steps: 10,
      seed: 5,
      abort: controller.signal,
    });
    expect(result.status).toBe('aborted');
    expect(result.trace).toHaveLength(0);
  });
});
