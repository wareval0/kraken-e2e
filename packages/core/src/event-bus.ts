import type { KrakenEvent, KrakenEventInput, Reporter } from '@kraken-e2e/contracts';

import { validateEvent } from './event-schemas.js';

export interface EventSink {
  emit(input: KrakenEventInput): KrakenEvent;
}

interface Subscription {
  readonly reporter: Reporter;
  /** Per-reporter promise chain: preserves order without blocking the run loop. */
  chain: Promise<void>;
}

/**
 * Stamps the envelope ({ts, runId, seq} — seq monotonic per run) and fans out
 * to reporters (ADR-0002 D5). Reporter errors are contained: reported once via
 * onReporterError, never allowed to fail the run.
 */
export class EventBus implements EventSink {
  readonly runId: string;
  #seq = 0;
  readonly #subscriptions: Subscription[] = [];
  readonly #onReporterError: (reporterId: string, error: unknown) => void;
  readonly #failed = new Set<string>();

  constructor(
    runId: string,
    options: { onReporterError?: (reporterId: string, error: unknown) => void } = {},
  ) {
    this.runId = runId;
    this.#onReporterError = options.onReporterError ?? (() => {});
  }

  subscribe(reporter: Reporter): void {
    this.#subscriptions.push({ reporter, chain: Promise.resolve() });
  }

  emit(input: KrakenEventInput): KrakenEvent {
    this.#seq += 1;
    const event = {
      ...input,
      ts: Date.now(),
      runId: this.runId,
      seq: this.#seq,
    } as KrakenEvent;
    validateEvent(event);
    for (const subscription of this.#subscriptions) {
      subscription.chain = subscription.chain
        .then(() => subscription.reporter.onEvent(event))
        .catch((error) => {
          // Report each reporter's first failure once; keep the stream flowing.
          if (!this.#failed.has(subscription.reporter.id)) {
            this.#failed.add(subscription.reporter.id);
            this.#onReporterError(subscription.reporter.id, error);
          }
        });
    }
    return event;
  }

  /** Awaits every reporter's chain and flush() — call once at run end. */
  async flush(): Promise<void> {
    await Promise.all(this.#subscriptions.map((subscription) => subscription.chain));
    await Promise.all(
      this.#subscriptions.map(async (subscription) => {
        try {
          await subscription.reporter.flush?.();
        } catch (error) {
          this.#onReporterError(subscription.reporter.id, error);
        }
      }),
    );
  }
}
