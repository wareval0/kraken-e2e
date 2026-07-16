/**
 * Distributed SignalTransport over Redis Streams (ADR-0001 D11: node-redis,
 * never ioredis; live-verified against node-redis 6.1 / Redis 8, 2026-07-05).
 *
 * Mapping: one stream per scope; Kraken's monotonic `seq` is assigned by an
 * atomic Lua INCR+XADD (explicit stream id `${seq}-0`), so stream order IS
 * seq order and catch-up reads are `XRANGE (seq-0 +` (exclusive start).
 * waitFor polls (default 15ms) — dumb-log semantics, no per-waiter blocking
 * connections; the SignalBus above owns cursors and FIFO fairness.
 *
 * This module is a SUBPATH export (`@kraken-e2e/signaling/redis`); `redis` is an
 * OPTIONAL peer dependency loaded dynamically on first use — installing
 * Kraken never drags Redis in (same import-safety rule as the drivers).
 */
import {
  ScopeClosedError,
  SignalPayloadError,
  SignalTimeoutError,
  SignalWaitAbortedError,
  TransportUnavailableError,
} from './errors.js';
import { nearMissNames } from './near-miss.js';
import {
  type SignalPayload,
  type SignalQuery,
  type SignalRecord,
  type SignalScope,
  type SignalTransport,
  scopeKey,
  type TransportWaitOptions,
} from './types.js';

/** The node-redis client slice this transport consumes (mock/type firewall). */
export interface RedisClientLike {
  connect(): Promise<unknown>;
  close(): Promise<unknown> | void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  xRange(
    key: string,
    start: string,
    end: string,
  ): Promise<Array<{ id: string; message: Record<string, string> }>>;
  exists(key: string): Promise<number>;
  set(key: string, value: string): Promise<unknown>;
  del(keys: string[]): Promise<unknown>;
  ping(): Promise<unknown>;
}

export interface RedisTransportOptions {
  /** redis:// URL (ignored when `client` is provided). */
  readonly url?: string;
  /** Pre-built client (tests, custom config). Must NOT be connected yet. */
  readonly client?: RedisClientLike;
  /** Key namespace; instances with different prefixes are fully isolated. */
  readonly keyPrefix?: string;
  /** waitFor poll interval. */
  readonly pollMs?: number;
}

/** Atomic seq assignment + append: INCR the scope counter, XADD at `${seq}-0`. */
const PUBLISH_LUA = `
local seq = redis.call('INCR', KEYS[2])
redis.call('XADD', KEYS[1], seq .. '-0',
  'name', ARGV[1], 'from', ARGV[2], 'payload', ARGV[3], 'publishedAt', ARGV[4])
return seq
`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class RedisStreamTransport implements SignalTransport {
  readonly #options: RedisTransportOptions;
  readonly #prefix: string;
  readonly #pollMs: number;
  #client: RedisClientLike | undefined;
  #connecting: Promise<RedisClientLike> | undefined;
  #closed = false;

  constructor(options: RedisTransportOptions = {}) {
    this.#options = options;
    this.#prefix = options.keyPrefix ?? 'kraken';
    this.#pollMs = options.pollMs ?? 15;
  }

  async #connected(): Promise<RedisClientLike> {
    if (this.#client) return this.#client;
    this.#connecting ??= (async () => {
      try {
        let client = this.#options.client;
        if (!client) {
          const redisSpecifier = 'redis';
          const redis = (await import(redisSpecifier)) as {
            createClient(options?: { url?: string }): RedisClientLike;
          };
          client = redis.createClient(
            this.#options.url !== undefined ? { url: this.#options.url } : {},
          );
        }
        // MANDATORY: without an error listener node-redis throws uncaught.
        client.on('error', () => {});
        await client.connect();
        this.#client = client;
        return client;
      } catch (cause) {
        this.#connecting = undefined;
        throw new TransportUnavailableError(
          `Redis transport could not connect${this.#options.url ? ` to ${this.#options.url}` : ''}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
    })();
    return this.#connecting;
  }

  #keys(scope: SignalScope): { stream: string; seq: string; open: string } {
    const base = `${this.#prefix}:${scopeKey(scope)}`;
    return { stream: `${base}:stream`, seq: `${base}:seq`, open: `${base}:open` };
  }

  async #assertOpen(client: RedisClientLike, scope: SignalScope, operation: string): Promise<void> {
    if ((await client.exists(this.#keys(scope).open)) !== 1) {
      throw new ScopeClosedError(scope, operation);
    }
  }

  #toRecord(entry: { id: string; message: Record<string, string> }): SignalRecord {
    return {
      seq: Number(entry.id.split('-')[0]),
      name: entry.message['name'] ?? '',
      from: entry.message['from'] ?? '',
      payload: JSON.parse(entry.message['payload'] ?? 'null') as SignalPayload,
      publishedAt: Number(entry.message['publishedAt'] ?? 0),
    };
  }

  async createScope(scope: SignalScope): Promise<void> {
    const client = await this.#connected();
    await client.set(this.#keys(scope).open, '1');
  }

  async publish(
    scope: SignalScope,
    signal: { name: string; from: string; payload: SignalPayload },
  ): Promise<SignalRecord> {
    const client = await this.#connected();
    await this.#assertOpen(client, scope, `publish signal "${signal.name}"`);
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(signal.payload ?? null);
    } catch (cause) {
      throw new SignalPayloadError(
        `Signal payload is not JSON-serializable: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (serialized === undefined) {
      throw new SignalPayloadError('Signal payload is not JSON-serializable.');
    }
    const publishedAt = Date.now();
    const keys = this.#keys(scope);
    const seq = Number(
      await client.eval(PUBLISH_LUA, {
        keys: [keys.stream, keys.seq],
        arguments: [signal.name, signal.from, serialized, String(publishedAt)],
      }),
    );
    return {
      seq,
      name: signal.name,
      from: signal.from,
      payload: JSON.parse(serialized) as SignalPayload,
      publishedAt,
    };
  }

  async #readAfter(
    client: RedisClientLike,
    scope: SignalScope,
    afterSeq: number,
  ): Promise<SignalRecord[]> {
    const entries = await client.xRange(
      this.#keys(scope).stream,
      afterSeq > 0 ? `(${afterSeq}-0` : '-',
      '+',
    );
    return entries.map((entry) => this.#toRecord(entry));
  }

  async waitFor(
    scope: SignalScope,
    query: SignalQuery,
    opts: TransportWaitOptions,
  ): Promise<SignalRecord> {
    const client = await this.#connected();
    const deadline = Date.now() + opts.timeoutMs;
    for (;;) {
      // close() can land during a poll sleep; stop before touching a client it
      // already tore down (was: operate on a closed node-redis client).
      if (this.#closed) {
        throw new TransportUnavailableError('Redis transport was closed while waiting.');
      }
      await this.#assertOpen(client, scope, `wait for signal "${query.name}"`);
      if (opts.signal?.aborted) {
        throw new SignalWaitAbortedError(query.name);
      }
      const records = await this.#readAfter(client, scope, query.afterSeq);
      const match = records.find(
        (record) =>
          record.name === query.name && (query.from === undefined || record.from === query.from),
      );
      if (match) return match;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        const historySnapshot = await this.history(scope);
        throw new SignalTimeoutError({
          scope,
          signalName: query.name,
          timeoutMs: opts.timeoutMs,
          cursor: query.afterSeq,
          historySnapshot,
          nearMissNames: nearMissNames(query.name, historySnapshot),
        });
      }
      await sleep(Math.min(this.#pollMs, remaining));
    }
  }

  async history(scope: SignalScope): Promise<readonly SignalRecord[]> {
    const client = await this.#connected();
    await this.#assertOpen(client, scope, 'read signal history');
    return this.#readAfter(client, scope, 0);
  }

  async destroyScope(scope: SignalScope): Promise<void> {
    const client = await this.#connected();
    const keys = this.#keys(scope);
    // Pending waiters observe the missing :open flag on their next poll and
    // reject with ScopeClosedError — no server-side waiter registry to clear.
    await client.del([keys.open, keys.stream, keys.seq]);
  }

  async ping(): Promise<void> {
    try {
      const client = await this.#connected();
      await client.ping();
    } catch (cause) {
      if (cause instanceof TransportUnavailableError) throw cause;
      throw new TransportUnavailableError(
        `Redis ping failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  /** Closes the underlying client (transport-level teardown, not per-scope). */
  async close(): Promise<void> {
    this.#closed = true;
    // Settle an in-flight connect too, else a connect that resolves AFTER
    // close() would leak a live, never-closed client.
    const pending = this.#connecting;
    this.#connecting = undefined;
    let client = this.#client;
    this.#client = undefined;
    if (!client && pending) {
      try {
        client = await pending;
      } catch {
        client = undefined; // failed connect: nothing to close
      }
    }
    if (client) await client.close();
  }
}
