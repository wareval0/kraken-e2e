/**
 * THE PHASE 4 EXIT CRITERION (ADR-0001 §7): the SAME 13-invariant conformance
 * suite that guards InMemoryTransport, run UNMODIFIED against Redis Streams —
 * including the Chaos wrapper. Env-gated on a redis-server binary (C11: skip,
 * never fail, on machines without it); an ad-hoc server on an OS-assigned
 * port keeps the run hermetic (no daemon, no fixed ports, no shared state).
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

import { afterAll, beforeAll } from 'vitest';

import { ChaosTransport } from '../src/chaos-transport.ts';
import { describeSignalTransportContract } from '../src/conformance.ts';
import { RedisStreamTransport } from '../src/redis-transport.ts';

const REDIS_BIN = spawnSync('which', ['redis-server'], { encoding: 'utf8' }).status === 0;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('no port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

let server: ChildProcess | undefined;
let url = '';
let instance = 0;
const transports: RedisStreamTransport[] = [];

beforeAll(async () => {
  if (!REDIS_BIN) return;
  const port = await freePort();
  url = `redis://127.0.0.1:${port}`;
  server = spawn('redis-server', ['--port', String(port), '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore',
  });
  // Wait for the server to accept connections (probe transport ping).
  const probe = new RedisStreamTransport({ url });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await probe.ping();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await probe.close();
}, 30_000);

afterAll(async () => {
  for (const transport of transports) {
    await transport.close().catch(() => {});
  }
  server?.kill('SIGKILL');
});

function factory(): RedisStreamTransport {
  instance += 1;
  const transport = new RedisStreamTransport({
    url,
    // Unique namespace per transport instance: scopes never collide across tests.
    keyPrefix: `kraken-test-${process.pid}-${instance}`,
    pollMs: 5,
  });
  transports.push(transport);
  return transport;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

describeSignalTransportContract('RedisStreamTransport', factory, {
  skip: !REDIS_BIN,
  // Real network round-trips + 5ms polling need more headroom than in-memory.
  shortTimeoutMs: 200,
  generousTimeoutMs: 5_000,
});

describeSignalTransportContract(
  'ChaosTransport(RedisStreamTransport, latency 1-5ms)',
  () => new ChaosTransport(factory(), { latencyMs: [1, 5], random: seededRandom(42) }),
  { skip: !REDIS_BIN, shortTimeoutMs: 300, generousTimeoutMs: 5_000 },
);
