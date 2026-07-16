/**
 * Core types of the Kraken signal log (ADR-0003).
 *
 * The transport SPI is a "dumb log": append with acknowledged ordering, blocking
 * reads after a sequence number, scope lifecycle. All intelligence (subscriber
 * cursors, predicates, diagnostics) lives in the SignalBus facade.
 */

/** JSON-serializable values only; every transport round-trips payloads through JSON. */
export type SignalPayload =
  | null
  | boolean
  | number
  | string
  | SignalPayload[]
  | { [key: string]: SignalPayload };

/**
 * Isolation unit for signals. `scenarioId` must be unique per scenario INSTANCE
 * (each Examples row gets its own scope). Cross-scenario signals are unsupported.
 */
export interface SignalScope {
  readonly runId: string;
  readonly scenarioId: string;
}

/** Opaque key transports use for storage isolation (Map key / Redis stream name). */
export function scopeKey(scope: SignalScope): string {
  return `${scope.runId}/${scope.scenarioId}`;
}

export interface SignalRecord<P extends SignalPayload = SignalPayload> {
  /** Strictly increasing per scope; assigned by the transport's single sequencer. */
  readonly seq: number;
  readonly name: string;
  /** Subscriber id (actor id) of the publisher. */
  readonly from: string;
  readonly payload: P;
  /** Epoch ms at the sequencer. Diagnostic only — never used for ordering. */
  readonly publishedAt: number;
}

export interface SignalQuery {
  readonly name: string;
  /** Only records with seq strictly greater than this match. */
  readonly afterSeq: number;
  /** If set, only records published by this subscriber match. */
  readonly from?: string | undefined;
}

export interface TransportWaitOptions {
  /** Waiter-local wall-clock budget. Transport latency counts against it. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The transport SPI. Implementations must pass the conformance suite exported
 * at `@kraken-e2e/signaling/conformance` before use (ADR-0003 D7).
 */
export interface SignalTransport {
  createScope(scope: SignalScope): Promise<void>;
  /**
   * Acknowledged append: resolves once the record is durably ordered.
   * MUST NOT resolve synchronously. Never blocks on receivers; never fails
   * because nobody is listening.
   */
  publish(
    scope: SignalScope,
    signal: { name: string; from: string; payload: SignalPayload },
  ): Promise<SignalRecord>;
  /**
   * Resolves with the earliest record matching the query (name, optional from,
   * seq > afterSeq), replaying history first, then waiting live. Rejects with
   * SignalTimeoutError, ScopeClosedError, SignalWaitAbortedError, or
   * TransportUnavailableError. Never hangs past timeoutMs.
   */
  waitFor(
    scope: SignalScope,
    query: SignalQuery,
    opts: TransportWaitOptions,
  ): Promise<SignalRecord>;
  /** Full in-scope history snapshot (timeout diagnostics, reporters). */
  history(scope: SignalScope): Promise<readonly SignalRecord[]>;
  /** Idempotent. Rejects all pending waiters with ScopeClosedError; frees retention. */
  destroyScope(scope: SignalScope): Promise<void>;
  /** Health probe for `kraken doctor`. */
  ping(): Promise<void>;
}
