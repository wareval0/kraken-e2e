/**
 * @kraken-e2e/signaling — standalone multi-actor signal log (ADR-0001 §5.7, ADR-0003).
 *
 * A scoped append-only log with per-(subscriber, signal-name) cursors:
 * publish-before-wait always delivers (replay-first), repeated signals count
 * FIFO per subscriber, and distinct subscribers each receive every record
 * (broadcast). Zero runtime dependencies; usable without Gherkin or WebdriverIO.
 *
 * The transport conformance suite lives at `@kraken-e2e/signaling/conformance`.
 */

export {
  ActorSignals,
  ScopedSignals,
  SignalBus,
  type SignalBusOptions,
  type SignalHandle,
  type WaitOptions,
} from './bus.js';
export {
  type ChaosOperation,
  type ChaosOptions,
  ChaosTransport,
} from './chaos-transport.js';
export {
  ScopeClosedError,
  SignalPayloadError,
  type SignalTimeoutDetail,
  SignalTimeoutError,
  SignalUsageError,
  SignalWaitAbortedError,
  TransportUnavailableError,
} from './errors.js';
export { InMemoryTransport } from './in-memory-transport.js';
export { levenshtein, nearMissNames } from './near-miss.js';
export {
  type SignalPayload,
  type SignalQuery,
  type SignalRecord,
  type SignalScope,
  type SignalTransport,
  scopeKey,
  type TransportWaitOptions,
} from './types.js';
