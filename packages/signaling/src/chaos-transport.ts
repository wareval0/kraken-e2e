import { TransportUnavailableError } from './errors.js';
import type {
  SignalPayload,
  SignalQuery,
  SignalRecord,
  SignalScope,
  SignalTransport,
  TransportWaitOptions,
} from './types.js';

export type ChaosOperation =
  | 'createScope'
  | 'publish'
  | 'waitFor'
  | 'history'
  | 'destroyScope'
  | 'ping';

export interface ChaosOptions {
  /** Fixed latency, or [min, max] range sampled with `random`. Default 0. */
  readonly latencyMs?: number | readonly [min: number, max: number];
  /** Injectable randomness for deterministic tests. Default Math.random. */
  readonly random?: () => number;
  /**
   * Scripted failures: return true to make the nth call (1-based, per
   * operation) throw TransportUnavailableError instead of delegating.
   */
  readonly shouldFail?: (operation: ChaosOperation, nthCall: number) => boolean;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Decorator that makes any transport behave like a flaky network: injected
 * latency and scripted TransportUnavailableError failures. Ships in Phase 1 so
 * orchestrator tests exercise distributed-mode failure paths years before a
 * real device farm exists (ADR-0003 D7).
 */
export class ChaosTransport implements SignalTransport {
  readonly #inner: SignalTransport;
  readonly #options: ChaosOptions;
  readonly #callCounts = new Map<ChaosOperation, number>();

  constructor(inner: SignalTransport, options: ChaosOptions = {}) {
    this.#inner = inner;
    this.#options = options;
  }

  #latency(): number {
    const { latencyMs } = this.#options;
    if (latencyMs === undefined) return 0;
    if (typeof latencyMs === 'number') return latencyMs;
    const [min, max] = latencyMs;
    const random = this.#options.random ?? Math.random;
    return min + random() * (max - min);
  }

  async #interfere(operation: ChaosOperation): Promise<number> {
    const nthCall = (this.#callCounts.get(operation) ?? 0) + 1;
    this.#callCounts.set(operation, nthCall);
    const latency = this.#latency();
    await sleep(latency);
    if (this.#options.shouldFail?.(operation, nthCall)) {
      throw new TransportUnavailableError(
        `Injected chaos: transport unavailable on ${operation} (call #${nthCall}).`,
      );
    }
    return latency;
  }

  async createScope(scope: SignalScope): Promise<void> {
    await this.#interfere('createScope');
    return this.#inner.createScope(scope);
  }

  async publish(
    scope: SignalScope,
    signal: { name: string; from: string; payload: SignalPayload },
  ): Promise<SignalRecord> {
    await this.#interfere('publish');
    return this.#inner.publish(scope, signal);
  }

  async waitFor(
    scope: SignalScope,
    query: SignalQuery,
    opts: TransportWaitOptions,
  ): Promise<SignalRecord> {
    // Latency counts against the waiter-local budget (ADR-0003 D4).
    const latency = await this.#interfere('waitFor');
    const remaining = Math.max(1, opts.timeoutMs - latency);
    return this.#inner.waitFor(scope, query, { ...opts, timeoutMs: remaining });
  }

  async history(scope: SignalScope): Promise<readonly SignalRecord[]> {
    await this.#interfere('history');
    return this.#inner.history(scope);
  }

  async destroyScope(scope: SignalScope): Promise<void> {
    await this.#interfere('destroyScope');
    return this.#inner.destroyScope(scope);
  }

  async ping(): Promise<void> {
    await this.#interfere('ping');
    return this.#inner.ping();
  }
}
