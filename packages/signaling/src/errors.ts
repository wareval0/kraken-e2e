import type { SignalRecord, SignalScope } from './types.js';

export interface SignalTimeoutDetail {
  readonly scope: SignalScope;
  /** Unknown at transport level; the SignalBus enriches it. */
  readonly subscriberId?: string | undefined;
  readonly signalName: string;
  readonly timeoutMs: number;
  /** The cursor (afterSeq) the wait was issued with. */
  readonly cursor: number;
  /** Everything published in the scope so far — the "what actually happened" dump. */
  readonly historySnapshot: readonly SignalRecord[];
  /** Signal names in the scope within edit distance 2 of the waited name (typo diagnosis). */
  readonly nearMissNames: readonly string[];
}

/** A waited-for signal never arrived within the budget. This is a TEST failure. */
export class SignalTimeoutError extends Error {
  override readonly name = 'SignalTimeoutError';
  readonly detail: SignalTimeoutDetail;

  constructor(detail: SignalTimeoutDetail) {
    const who = detail.subscriberId ? `subscriber "${detail.subscriberId}"` : 'a subscriber';
    const seen =
      detail.historySnapshot.length === 0
        ? 'No signals were published in this scope.'
        : `Signals published so far: ${detail.historySnapshot
            .map((r) => `"${r.name}" by ${r.from} (seq ${r.seq})`)
            .join(', ')}.`;
    const nearMiss =
      detail.nearMissNames.length > 0
        ? ` Did you mean ${detail.nearMissNames.map((n) => `"${n}"`).join(' or ')}?`
        : '';
    super(
      `Timed out after ${detail.timeoutMs}ms: ${who} was waiting for signal "${detail.signalName}" ` +
        `(after seq ${detail.cursor}) in scope ${detail.scope.runId}/${detail.scope.scenarioId}. ${seen}${nearMiss}`,
    );
    this.detail = detail;
  }
}

/** The scope was destroyed (or never created); the operation cannot proceed. */
export class ScopeClosedError extends Error {
  override readonly name = 'ScopeClosedError';

  constructor(scope: SignalScope, operation: string) {
    super(
      `Cannot ${operation}: signal scope ${scope.runId}/${scope.scenarioId} is not open ` +
        '(never created or already destroyed).',
    );
  }
}

/** A pending wait was cancelled through its AbortSignal (e.g. failFast teardown). */
export class SignalWaitAbortedError extends Error {
  override readonly name = 'SignalWaitAbortedError';

  constructor(signalName: string) {
    super(`Wait for signal "${signalName}" was aborted.`);
  }
}

/** Infrastructure failure (transport down/unreachable). NOT a test failure. */
export class TransportUnavailableError extends Error {
  override readonly name = 'TransportUnavailableError';
}

/** The payload is not JSON-serializable or exceeds the configured size cap. */
export class SignalPayloadError extends Error {
  override readonly name = 'SignalPayloadError';
}

/** API misuse (e.g. two concurrent identical waits by one subscriber — ADR-0003 D3). */
export class SignalUsageError extends Error {
  override readonly name = 'SignalUsageError';
}
