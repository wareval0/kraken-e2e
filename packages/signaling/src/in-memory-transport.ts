import {
  ScopeClosedError,
  SignalPayloadError,
  SignalTimeoutError,
  SignalWaitAbortedError,
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

interface Waiter {
  readonly query: SignalQuery;
  settle(record: SignalRecord): void;
  fail(error: Error): void;
}

interface ScopeState {
  readonly records: SignalRecord[];
  nextSeq: number;
  readonly waiters: Set<Waiter>;
}

function matches(query: SignalQuery, record: SignalRecord): boolean {
  return (
    record.seq > query.afterSeq &&
    record.name === query.name &&
    (query.from === undefined || record.from === query.from)
  );
}

/** Deep-copies through JSON so shared-mutable-reference bugs fail locally too (ADR-0003 D5). */
function cloneJson(payload: SignalPayload): SignalPayload {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(payload ?? null);
  } catch (cause) {
    throw new SignalPayloadError(
      `Signal payload is not JSON-serializable: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (serialized === undefined) {
    throw new SignalPayloadError('Signal payload is not JSON-serializable.');
  }
  return JSON.parse(serialized) as SignalPayload;
}

const microtask = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

/**
 * Reference transport: a Map-based append-only log per scope. Deliberately "as
 * awkward as a network": microtask-deferred resolution (never synchronous) and
 * JSON round-tripped payloads, so local tests cannot accrete behaviors a
 * distributed transport can't honor (ADR-0003).
 */
export class InMemoryTransport implements SignalTransport {
  readonly #scopes = new Map<string, ScopeState>();

  #state(scope: SignalScope, operation: string): ScopeState {
    const state = this.#scopes.get(scopeKey(scope));
    if (!state) {
      throw new ScopeClosedError(scope, operation);
    }
    return state;
  }

  async createScope(scope: SignalScope): Promise<void> {
    const key = scopeKey(scope);
    if (!this.#scopes.has(key)) {
      this.#scopes.set(key, { records: [], nextSeq: 1, waiters: new Set() });
    }
    await microtask();
  }

  async publish(
    scope: SignalScope,
    signal: { name: string; from: string; payload: SignalPayload },
  ): Promise<SignalRecord> {
    const state = this.#state(scope, `publish signal "${signal.name}"`);
    // Seq assignment is synchronous with the call (call order = total order);
    // only the RESOLUTION and waiter notification are deferred.
    const record: SignalRecord = {
      seq: state.nextSeq,
      name: signal.name,
      from: signal.from,
      payload: cloneJson(signal.payload),
      publishedAt: Date.now(),
    };
    state.nextSeq += 1;
    state.records.push(record);
    queueMicrotask(() => {
      for (const waiter of [...state.waiters]) {
        if (matches(waiter.query, record)) {
          state.waiters.delete(waiter);
          waiter.settle(record);
        }
      }
    });
    await microtask();
    return record;
  }

  // Async so that even "scope closed" surfaces as a rejection, never a
  // synchronous throw (the same Zalgo rule the resolutions follow).
  async waitFor(
    scope: SignalScope,
    query: SignalQuery,
    opts: TransportWaitOptions,
  ): Promise<SignalRecord> {
    const state = this.#state(scope, `wait for signal "${query.name}"`);

    return new Promise<SignalRecord>((resolve, reject) => {
      const existing = state.records.find((record) => matches(query, record));
      if (existing) {
        // Replay-first, but never synchronously (Zalgo prevention).
        queueMicrotask(() => resolve(existing));
        return;
      }
      if (opts.signal?.aborted) {
        queueMicrotask(() => reject(new SignalWaitAbortedError(query.name)));
        return;
      }

      let cleanup = (): void => {};
      const waiter: Waiter = {
        query,
        settle(record) {
          cleanup();
          resolve(record);
        },
        fail(error) {
          cleanup();
          reject(error);
        },
      };

      const timer = setTimeout(() => {
        state.waiters.delete(waiter);
        cleanup();
        reject(
          new SignalTimeoutError({
            scope,
            signalName: query.name,
            timeoutMs: opts.timeoutMs,
            cursor: query.afterSeq,
            historySnapshot: [...state.records],
            nearMissNames: nearMissNames(query.name, state.records),
          }),
        );
      }, opts.timeoutMs);

      const onAbort = (): void => {
        state.waiters.delete(waiter);
        cleanup();
        reject(new SignalWaitAbortedError(query.name));
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      cleanup = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };

      state.waiters.add(waiter);
    });
  }

  async history(scope: SignalScope): Promise<readonly SignalRecord[]> {
    const state = this.#state(scope, 'read signal history');
    await microtask();
    return [...state.records];
  }

  async destroyScope(scope: SignalScope): Promise<void> {
    const state = this.#scopes.get(scopeKey(scope));
    if (state) {
      this.#scopes.delete(scopeKey(scope));
      for (const waiter of [...state.waiters]) {
        waiter.fail(new ScopeClosedError(scope, `wait for signal "${waiter.query.name}"`));
      }
      state.waiters.clear();
    }
    await microtask();
  }

  async ping(): Promise<void> {
    await microtask();
  }
}
