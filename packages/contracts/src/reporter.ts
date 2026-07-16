import type { KrakenEvent } from './events.js';

/**
 * Reporters are single-method subscribers of the serialized event stream
 * (ADR-0001 §5.12): transport-symmetric — identical whether the subscriber is
 * Allure in-process, a JSONL file sink, or a future GUI over WebSocket.
 */
export interface Reporter {
  readonly id: string;
  onEvent(event: KrakenEvent): void | Promise<void>;
  /** Awaited at run end — drain buffers, close files. */
  flush?(): Promise<void>;
}

/** Identity helper for symmetry with defineDriver (and future branding). */
export function defineReporter(reporter: Reporter): Reporter {
  return reporter;
}
