import {
  ScopeClosedError,
  SignalPayloadError,
  SignalTimeoutError,
  SignalUsageError,
} from './errors.js';
import { nearMissNames } from './near-miss.js';
import type { SignalPayload, SignalRecord, SignalScope, SignalTransport } from './types.js';

export interface WaitOptions<P extends SignalPayload = SignalPayload> {
  /** Explicit by design — there is no library-level default (ADR-0003 D4). */
  readonly timeoutMs: number;
  /** Only accept signals published by this subscriber. */
  readonly from?: string | undefined;
  /**
   * Client-side payload filter. A predicate-REJECTED record is permanently
   * consumed for this (subscriber, name) cursor — deterministic and documented
   * (ADR-0003 D3). There is no non-consuming peek in v1.
   */
  readonly where?: ((payload: P) => boolean) | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface SignalBusOptions {
  /** Cap on the serialized payload size. Default 64 KiB (ADR-0003 D5). */
  readonly maxPayloadBytes?: number;
  /** Per-scope record count that triggers a one-time warning. Default 10 000 (ADR-0003 D6). */
  readonly scopeRecordWarnThreshold?: number;
  /** Where warnings go (the orchestrator wires this to its logger). */
  readonly onWarning?: ((message: string) => void) | undefined;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_WARN_THRESHOLD = 10_000;
const encoder = new TextEncoder();

/**
 * The facade every consumer touches. Owns what transports deliberately do not:
 * per-(subscriber, signal-name) cursors, predicates, payload validation, and
 * enriched timeout diagnostics (ADR-0003 D2/D3).
 */
export class SignalBus {
  readonly #transport: SignalTransport;
  readonly #options: Required<
    Pick<SignalBusOptions, 'maxPayloadBytes' | 'scopeRecordWarnThreshold'>
  > &
    Pick<SignalBusOptions, 'onWarning'>;

  constructor(transport: SignalTransport, options: SignalBusOptions = {}) {
    this.#transport = transport;
    this.#options = {
      maxPayloadBytes: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
      scopeRecordWarnThreshold: options.scopeRecordWarnThreshold ?? DEFAULT_WARN_THRESHOLD,
      onWarning: options.onWarning,
    };
  }

  scope(scope: SignalScope): ScopedSignals {
    return new ScopedSignals(this.#transport, scope, this.#options);
  }

  ping(): Promise<void> {
    return this.#transport.ping();
  }
}

export class ScopedSignals {
  readonly #transport: SignalTransport;
  readonly #scope: SignalScope;
  readonly #options: Required<
    Pick<SignalBusOptions, 'maxPayloadBytes' | 'scopeRecordWarnThreshold'>
  > &
    Pick<SignalBusOptions, 'onWarning'>;
  /**
   * Cursor per (subscriberId, signalName, from-filter) — the load-bearing
   * state (ADR-0003 D3). The from-filter is part of the channel key: a
   * from-filtered wait must never advance past OTHER senders' records
   * (they were never delivered to this waiter).
   */
  readonly #cursors = new Map<string, Map<string, number>>();
  /** Pending wait channels, to reject concurrent identical waits (collision-free keys). */
  readonly #pendingWaits = new Set<string>();
  #publishCount = 0;
  #warned = false;

  constructor(
    transport: SignalTransport,
    scope: SignalScope,
    options: Required<Pick<SignalBusOptions, 'maxPayloadBytes' | 'scopeRecordWarnThreshold'>> &
      Pick<SignalBusOptions, 'onWarning'>,
  ) {
    this.#transport = transport;
    this.#scope = scope;
    this.#options = options;
  }

  get scope(): SignalScope {
    return this.#scope;
  }

  /** Creates the scope on the transport. Must be called before any publish/wait. */
  open(): Promise<void> {
    return this.#transport.createScope(this.#scope);
  }

  forActor(subscriberId: string): ActorSignals {
    return new ActorSignals(this, subscriberId);
  }

  history(): Promise<readonly SignalRecord[]> {
    return this.#transport.history(this.#scope);
  }

  /** Idempotent. Rejects all pending waiters with ScopeClosedError. */
  destroy(): Promise<void> {
    return this.#transport.destroyScope(this.#scope);
  }

  static #channel(name: string, from: string | undefined): string {
    return JSON.stringify([name, from ?? null]);
  }

  #cursor(subscriberId: string, channel: string): number {
    return this.#cursors.get(subscriberId)?.get(channel) ?? 0;
  }

  #advanceCursor(subscriberId: string, channel: string, seq: number): void {
    let byChannel = this.#cursors.get(subscriberId);
    if (!byChannel) {
      byChannel = new Map();
      this.#cursors.set(subscriberId, byChannel);
    }
    byChannel.set(channel, seq);
  }

  /** @internal used by ActorSignals */
  async publishAs<P extends SignalPayload>(
    subscriberId: string,
    name: string,
    payload: P | undefined,
  ): Promise<SignalRecord<P>> {
    const normalized = (payload ?? null) as SignalPayload;
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(normalized);
    } catch (cause) {
      throw new SignalPayloadError(
        `Payload of signal "${name}" is not JSON-serializable: ` +
          `${cause instanceof Error ? cause.message : String(cause)}. ` +
          'Signals may carry only plain JSON data — never functions, sessions, or cyclic objects.',
      );
    }
    if (serialized === undefined) {
      throw new SignalPayloadError(`Payload of signal "${name}" is not JSON-serializable.`);
    }
    const bytes = encoder.encode(serialized).length;
    if (bytes > this.#options.maxPayloadBytes) {
      throw new SignalPayloadError(
        `Payload of signal "${name}" is ${bytes} bytes; the cap is ${this.#options.maxPayloadBytes}. ` +
          'Signals coordinate actors — they are not a data pipe. Pass a reference (id, path) instead.',
      );
    }

    const record = await this.#transport.publish(this.#scope, {
      name,
      from: subscriberId,
      payload: normalized,
    });

    this.#publishCount += 1;
    if (!this.#warned && this.#publishCount > this.#options.scopeRecordWarnThreshold) {
      this.#warned = true;
      this.#options.onWarning?.(
        `Signal scope ${this.#scope.runId}/${this.#scope.scenarioId} exceeded ` +
          `${this.#options.scopeRecordWarnThreshold} records — a runaway publish loop?`,
      );
    }
    return record as SignalRecord<P>;
  }

  /** @internal used by ActorSignals */
  async waitAs<P extends SignalPayload>(
    subscriberId: string,
    name: string,
    opts: WaitOptions<P>,
  ): Promise<SignalRecord<P>> {
    const channel = ScopedSignals.#channel(name, opts.from);
    // Collision-free key: quoted-alias subscriber ids may contain spaces.
    const pendingKey = JSON.stringify([subscriberId, channel]);
    if (this.#pendingWaits.has(pendingKey)) {
      throw new SignalUsageError(
        `Subscriber "${subscriberId}" is already waiting for signal "${name}". ` +
          'Concurrent identical waits are ambiguous (which record goes to whom?) and are ' +
          'rejected by design (ADR-0003 D3). Wait sequentially to count, or use distinct ' +
          'subscribers to broadcast.',
      );
    }
    this.#pendingWaits.add(pendingKey);
    const startedAt = Date.now();
    try {
      for (;;) {
        const elapsed = Date.now() - startedAt;
        const remaining = opts.timeoutMs - elapsed;
        if (remaining <= 0) {
          throw await this.#timeoutError(subscriberId, name, channel, opts.timeoutMs);
        }
        let record: SignalRecord;
        try {
          record = await this.#transport.waitFor(
            this.#scope,
            { name, afterSeq: this.#cursor(subscriberId, channel), from: opts.from },
            { timeoutMs: remaining, signal: opts.signal },
          );
        } catch (error) {
          if (error instanceof SignalTimeoutError) {
            // Enrich the transport-level error with subscriber identity.
            throw new SignalTimeoutError({
              ...error.detail,
              subscriberId,
              timeoutMs: opts.timeoutMs,
            });
          }
          throw error;
        }
        // Predicate-rejected records are consumed for this cursor (ADR-0003 D3).
        this.#advanceCursor(subscriberId, channel, record.seq);
        if (opts.where && !opts.where(record.payload as P)) {
          continue;
        }
        return record as SignalRecord<P>;
      }
    } finally {
      this.#pendingWaits.delete(pendingKey);
    }
  }

  async #timeoutError(
    subscriberId: string,
    name: string,
    channel: string,
    timeoutMs: number,
  ): Promise<SignalTimeoutError> {
    let snapshot: readonly SignalRecord[] = [];
    try {
      snapshot = await this.#transport.history(this.#scope);
    } catch (error) {
      if (!(error instanceof ScopeClosedError)) throw error;
    }
    return new SignalTimeoutError({
      scope: this.#scope,
      subscriberId,
      signalName: name,
      timeoutMs,
      cursor: this.#cursor(subscriberId, channel),
      historySnapshot: snapshot,
      nearMissNames: nearMissNames(name, snapshot),
    });
  }
}

/**
 * The interface consumers program against (`ctx.signals`). Lets orchestrators
 * wrap the concrete ActorSignals (e.g. to emit events) without inheritance.
 */
export interface SignalHandle {
  readonly subscriberId: string;
  publish<P extends SignalPayload>(name: string, payload?: P): Promise<SignalRecord<P>>;
  waitFor<P extends SignalPayload>(name: string, opts: WaitOptions<P>): Promise<SignalRecord<P>>;
  barrier(
    name: string,
    opts: { participants: readonly string[]; timeoutMs: number; signal?: AbortSignal },
  ): Promise<void>;
}

/**
 * The per-actor handle steps receive as `ctx.signals`. Binds the subscriber
 * identity (defaults to the actor id — ADR-0001 §5.7, ADR-0003 D3).
 */
export class ActorSignals implements SignalHandle {
  readonly #scoped: ScopedSignals;
  readonly #subscriberId: string;

  constructor(scoped: ScopedSignals, subscriberId: string) {
    this.#scoped = scoped;
    this.#subscriberId = subscriberId;
  }

  get subscriberId(): string {
    return this.#subscriberId;
  }

  /** Fire-and-persist. Never blocks on receivers; resolves once durably ordered. */
  publish<P extends SignalPayload>(name: string, payload?: P): Promise<SignalRecord<P>> {
    return this.#scoped.publishAs(this.#subscriberId, name, payload);
  }

  /**
   * Exactly one record per call: replay-first, then live; FIFO per
   * (this subscriber, name). Publish-before-wait always delivers — the
   * Kraken v2 lost-signal race is defined away (ADR-0003 D2/D3).
   */
  waitFor<P extends SignalPayload>(name: string, opts: WaitOptions<P>): Promise<SignalRecord<P>> {
    return this.#scoped.waitAs(this.#subscriberId, name, opts);
  }

  /**
   * Rendezvous sugar on publish+waitFor: publishes `${name}:${self}` and waits
   * for every other participant's `${name}:${participant}`.
   */
  async barrier(
    name: string,
    opts: { participants: readonly string[]; timeoutMs: number; signal?: AbortSignal },
  ): Promise<void> {
    await this.publish(`${name}:${this.#subscriberId}`);
    await Promise.all(
      opts.participants
        .filter((participant) => participant !== this.#subscriberId)
        .map((participant) =>
          this.waitFor(`${name}:${participant}`, {
            timeoutMs: opts.timeoutMs,
            signal: opts.signal,
          }),
        ),
    );
  }
}
