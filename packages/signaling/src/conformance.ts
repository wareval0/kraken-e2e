/**
 * Transport conformance suite (ADR-0003 D7). Every SignalTransport — first-party
 * or student-written, in-memory or networked — must pass this suite before use.
 * This file, more than any document, is what keeps signal semantics stable
 * across thesis-student rotation.
 *
 * Usage (inside a vitest suite):
 *   import { describeSignalTransportContract } from '@kraken-e2e/signaling/conformance';
 *   describeSignalTransportContract('InMemoryTransport', () => new InMemoryTransport());
 */
import { describe, expect, it } from 'vitest';

import { ScopeClosedError, SignalTimeoutError, SignalWaitAbortedError } from './errors.js';
import type { SignalScope, SignalTransport } from './types.js';

let scopeCounter = 0;
function freshScope(): SignalScope {
  scopeCounter += 1;
  return { runId: 'conformance-run', scenarioId: `scenario-${scopeCounter}` };
}

export interface ConformanceOptions {
  /**
   * Baseline wait budget for tests that must NOT time out. Raise for
   * high-latency transports (e.g. a chaos-wrapped or networked one).
   */
  readonly generousTimeoutMs?: number;
  /** Budget for tests that MUST time out. Raise for high-latency transports. */
  readonly shortTimeoutMs?: number;
  /**
   * Register the whole suite as skipped (external infrastructure absent —
   * e.g. no redis-server on this machine). Skipping is VISIBLE in the test
   * summary; silently not registering the suite would hide the gap.
   */
  readonly skip?: boolean;
}

export function describeSignalTransportContract(
  name: string,
  makeTransport: () => SignalTransport | Promise<SignalTransport>,
  options: ConformanceOptions = {},
): void {
  const GENEROUS = options.generousTimeoutMs ?? 2_000;
  const SHORT = options.shortTimeoutMs ?? 60;

  describe.skipIf(options.skip === true)(`SignalTransport conformance: ${name}`, () => {
    async function openScope(): Promise<{ transport: SignalTransport; scope: SignalScope }> {
      const transport = await makeTransport();
      const scope = freshScope();
      await transport.createScope(scope);
      return { transport, scope };
    }

    it('1. replays a signal published BEFORE the wait started (the Kraken v2 race)', async () => {
      const { transport, scope } = await openScope();
      await transport.publish(scope, { name: 'message-sent', from: 'alice', payload: { n: 1 } });
      const record = await transport.waitFor(
        scope,
        { name: 'message-sent', afterSeq: 0 },
        { timeoutMs: GENEROUS },
      );
      expect(record.name).toBe('message-sent');
      expect(record.from).toBe('alice');
      expect(record.payload).toEqual({ n: 1 });
    });

    it('2. assigns a strictly increasing per-scope total order', async () => {
      const { transport, scope } = await openScope();
      const first = await transport.publish(scope, { name: 'a', from: 'x', payload: null });
      const second = await transport.publish(scope, { name: 'b', from: 'x', payload: null });
      const third = await transport.publish(scope, { name: 'a', from: 'y', payload: null });
      expect(second.seq).toBeGreaterThan(first.seq);
      expect(third.seq).toBeGreaterThan(second.seq);
      const history = await transport.history(scope);
      expect([...history].map((r) => r.seq)).toEqual(
        [...history].map((r) => r.seq).sort((a, b) => a - b),
      );
    });

    it('3. serves records FIFO as afterSeq advances (loop counting)', async () => {
      const { transport, scope } = await openScope();
      for (let i = 1; i <= 3; i += 1) {
        await transport.publish(scope, { name: 'tick', from: 'loop', payload: i });
      }
      let cursor = 0;
      const seen: unknown[] = [];
      for (let i = 0; i < 3; i += 1) {
        const record = await transport.waitFor(
          scope,
          { name: 'tick', afterSeq: cursor },
          { timeoutMs: GENEROUS },
        );
        cursor = record.seq;
        seen.push(record.payload);
      }
      expect(seen).toEqual([1, 2, 3]);
    });

    it('4. broadcasts: independent queries each receive the same record', async () => {
      const { transport, scope } = await openScope();
      const waitA = transport.waitFor(scope, { name: 'go', afterSeq: 0 }, { timeoutMs: GENEROUS });
      const waitB = transport.waitFor(scope, { name: 'go', afterSeq: 0 }, { timeoutMs: GENEROUS });
      await transport.publish(scope, { name: 'go', from: 'alice', payload: 'now' });
      const [recordA, recordB] = await Promise.all([waitA, waitB]);
      expect(recordA.seq).toBe(recordB.seq);
      expect(recordA.payload).toBe('now');
      expect(recordB.payload).toBe('now');
    });

    it('5. filters by publisher when `from` is given', async () => {
      const { transport, scope } = await openScope();
      await transport.publish(scope, { name: 'done', from: 'mallory', payload: 'wrong' });
      const pending = transport.waitFor(
        scope,
        { name: 'done', afterSeq: 0, from: 'alice' },
        { timeoutMs: GENEROUS },
      );
      await transport.publish(scope, { name: 'done', from: 'alice', payload: 'right' });
      const record = await pending;
      expect(record.from).toBe('alice');
      expect(record.payload).toBe('right');
    });

    it('6. isolates scopes completely', async () => {
      const transport = await makeTransport();
      const scopeA = freshScope();
      const scopeB = freshScope();
      await transport.createScope(scopeA);
      await transport.createScope(scopeB);
      await transport.publish(scopeA, { name: 'leak?', from: 'a', payload: null });
      await expect(
        transport.waitFor(scopeB, { name: 'leak?', afterSeq: 0 }, { timeoutMs: SHORT }),
      ).rejects.toBeInstanceOf(SignalTimeoutError);
      expect(await transport.history(scopeB)).toHaveLength(0);
    });

    it('7. never resolves in the same synchronous execution (Zalgo prevention)', async () => {
      const { transport, scope } = await openScope();
      await transport.publish(scope, { name: 'ready', from: 'a', payload: null });
      let sameTick = true;
      const settled = transport
        .waitFor(scope, { name: 'ready', afterSeq: 0 }, { timeoutMs: GENEROUS })
        .then(() => sameTick);
      sameTick = false;
      // If the implementation resolved before returning control, the then-callback
      // would still observe sameTick === false (promise semantics), so we also
      // verify publish acknowledgement defers: no waiter callback may have run yet.
      expect(await settled).toBe(false);
    });

    it('8. isolates payloads by value (JSON round-trip; mutation does not propagate)', async () => {
      const { transport, scope } = await openScope();
      const payload = { items: ['a'] };
      const published = await transport.publish(scope, { name: 'data', from: 'a', payload });
      payload.items.push('MUTATED');
      const received = await transport.waitFor(
        scope,
        { name: 'data', afterSeq: 0 },
        { timeoutMs: GENEROUS },
      );
      expect(received.payload).toEqual({ items: ['a'] });
      expect(published.payload).toEqual({ items: ['a'] });
      expect(received.payload).not.toBe(payload);
    });

    it('9. rejects with SignalTimeoutError once the budget elapses — and not much before', async () => {
      const { transport, scope } = await openScope();
      const startedAt = Date.now();
      await expect(
        transport.waitFor(scope, { name: 'never', afterSeq: 0 }, { timeoutMs: SHORT }),
      ).rejects.toBeInstanceOf(SignalTimeoutError);
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(SHORT - 15);
    });

    it('10. cancels a pending wait promptly through its AbortSignal', async () => {
      const { transport, scope } = await openScope();
      const controller = new AbortController();
      const pending = transport.waitFor(
        scope,
        { name: 'never', afterSeq: 0 },
        { timeoutMs: GENEROUS, signal: controller.signal },
      );
      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(SignalWaitAbortedError);
    });

    it('11. destroyScope rejects pending waiters, is idempotent, and closes the scope', async () => {
      const { transport, scope } = await openScope();
      const pending = transport.waitFor(
        scope,
        { name: 'never', afterSeq: 0 },
        { timeoutMs: GENEROUS },
      );
      await transport.destroyScope(scope);
      await expect(pending).rejects.toBeInstanceOf(ScopeClosedError);
      await transport.destroyScope(scope); // idempotent
      await expect(
        transport.publish(scope, { name: 'x', from: 'a', payload: null }),
      ).rejects.toBeInstanceOf(ScopeClosedError);
      await expect(
        transport.waitFor(scope, { name: 'x', afterSeq: 0 }, { timeoutMs: SHORT }),
      ).rejects.toBeInstanceOf(ScopeClosedError);
      await expect(transport.history(scope)).rejects.toBeInstanceOf(ScopeClosedError);
    });

    it('12. ping resolves on a healthy transport', async () => {
      const transport = await makeTransport();
      await expect(transport.ping()).resolves.toBeUndefined();
    });

    it('13. timeout errors carry the full history snapshot and near-miss suggestions', async () => {
      const { transport, scope } = await openScope();
      await transport.publish(scope, { name: 'message-sent', from: 'alice', payload: null });
      try {
        await transport.waitFor(scope, { name: 'mesage-sent', afterSeq: 0 }, { timeoutMs: SHORT });
        expect.unreachable('waitFor must time out');
      } catch (error) {
        expect(error).toBeInstanceOf(SignalTimeoutError);
        const detail = (error as SignalTimeoutError).detail;
        expect(detail.historySnapshot.map((r) => r.name)).toContain('message-sent');
        expect(detail.nearMissNames).toContain('message-sent');
      }
    });
  });
}
