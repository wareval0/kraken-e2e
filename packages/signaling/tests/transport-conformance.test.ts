import { ChaosTransport } from '../src/chaos-transport.ts';
import { describeSignalTransportContract } from '../src/conformance.ts';
import { InMemoryTransport } from '../src/in-memory-transport.ts';

describeSignalTransportContract('InMemoryTransport', () => new InMemoryTransport());

// A deterministic pseudo-random source so the chaos run is reproducible.
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describeSignalTransportContract(
  'ChaosTransport(InMemoryTransport, latency 1-5ms)',
  () =>
    new ChaosTransport(new InMemoryTransport(), {
      latencyMs: [1, 5],
      random: seededRandom(42),
    }),
  // Chaos latency eats into wait budgets; give timeout-sensitive tests headroom.
  { shortTimeoutMs: 120 },
);
