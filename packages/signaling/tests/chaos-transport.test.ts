import { describe, expect, it } from 'vitest';

import { ChaosTransport } from '../src/chaos-transport.ts';
import { TransportUnavailableError } from '../src/errors.ts';
import { InMemoryTransport } from '../src/in-memory-transport.ts';
import type { SignalScope } from '../src/types.ts';

const scope: SignalScope = { runId: 'r', scenarioId: 's' };

describe('ChaosTransport failure injection', () => {
  it('throws TransportUnavailableError on scripted calls and recovers afterwards', async () => {
    const chaos = new ChaosTransport(new InMemoryTransport(), {
      shouldFail: (operation, nthCall) => operation === 'publish' && nthCall === 1,
    });
    await chaos.createScope(scope);
    await expect(
      chaos.publish(scope, { name: 'x', from: 'a', payload: null }),
    ).rejects.toBeInstanceOf(TransportUnavailableError);
    // The second call succeeds — infra failures are transient, not sticky.
    const record = await chaos.publish(scope, { name: 'x', from: 'a', payload: null });
    expect(record.seq).toBe(1);
  });

  it('charges its latency against the waiter budget instead of extending it', async () => {
    const chaos = new ChaosTransport(new InMemoryTransport(), { latencyMs: 30 });
    await chaos.createScope(scope);
    const startedAt = Date.now();
    await expect(
      chaos.waitFor(scope, { name: 'never', afterSeq: 0 }, { timeoutMs: 60 }),
    ).rejects.toMatchObject({ name: 'SignalTimeoutError' });
    const elapsed = Date.now() - startedAt;
    // 30ms chaos latency + remaining ~30ms budget: well under 2x the budget.
    expect(elapsed).toBeLessThan(120);
  });
});
