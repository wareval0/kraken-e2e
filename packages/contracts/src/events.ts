/**
 * The structured event stream (ADR-0001 §5.12 / ADR-0002 D5) — the GUI-ready
 * spine. Envelope: { type, ts, runId, seq } with seq monotonic per run.
 *
 * Evolution rules (cucumber-messages model): additive-only. New OPTIONAL
 * fields at most; a semantic change is a NEW event type; consumers MUST ignore
 * unknown types/fields. A single `protocol: 1` literal lives in runStarted.
 * Validation schemas (zod) live inside @kraken-e2e/core, never here.
 */
import type { SerializedKrakenError } from './errors.js';

export interface KrakenEventBase {
  readonly ts: number;
  readonly runId: string;
  /** Monotonic per run — total ordering for any consumer without clock trust. */
  readonly seq: number;
}

export type StepStatus = 'passed' | 'failed' | 'skipped';
export type RunStatus = 'passed' | 'failed';

export interface ActorSummary {
  readonly id: string;
  readonly platform: string;
  readonly driverId: string;
}

type Ev<TType extends string, TPayload> = KrakenEventBase & {
  readonly type: TType;
} & Readonly<TPayload>;

export type KrakenEvent =
  | Ev<'runStarted', { protocol: 1; scenarioCount: number }>
  | Ev<'runFinished', { status: RunStatus; durationMs: number }>
  | Ev<
      'scenarioStarted',
      { scenarioId: string; name: string; featureUri?: string; actors: readonly ActorSummary[] }
    >
  | Ev<
      'scenarioFinished',
      { scenarioId: string; status: StepStatus; durationMs: number; error?: SerializedKrakenError }
    >
  | Ev<'stepStarted', { scenarioId: string; stepId: string; actorId: string; text: string }>
  | Ev<
      'stepFinished',
      {
        scenarioId: string;
        stepId: string;
        actorId: string;
        text: string;
        status: StepStatus;
        durationMs: number;
        error?: SerializedKrakenError;
      }
    >
  | Ev<
      'actorSessionStarted',
      { scenarioId: string; actorId: string; driverId: string; platformLabel: string }
    >
  | Ev<'actorSessionFinished', { scenarioId: string; actorId: string; status: 'ok' | 'failed' }>
  | Ev<'signalSent', { scenarioId: string; signal: string; from: string; recordSeq: number }>
  | Ev<
      'signalWaitStarted',
      { scenarioId: string; signal: string; actorId: string; timeoutMs: number }
    >
  | Ev<
      'signalReceived',
      { scenarioId: string; signal: string; by: string; from: string; latencyMs: number }
    >
  | Ev<'signalTimedOut', { scenarioId: string; signal: string; actorId: string; timeoutMs: number }>
  | Ev<'driverRegistered', { driverId: string; version: string; platforms: readonly string[] }>
  | Ev<'driverDisabled', { driverId: string; code: string; reason: string; fix: string }>
  | Ev<
      'artifactCaptured',
      {
        kind: 'screenshot' | 'log' | 'video' | 'source';
        path: string;
        scenarioId?: string;
        actorId?: string;
        /** The step this capture documents (per-step screenshot timeline). */
        stepId?: string;
      }
    >
  | Ev<
      'driverLog',
      { source: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string }
    >;

export type KrakenEventType = KrakenEvent['type'];

/** What the EventBus accepts: an event minus the envelope it stamps. */
export type KrakenEventInput = KrakenEvent extends infer E
  ? E extends KrakenEvent
    ? Omit<E, keyof KrakenEventBase>
    : never
  : never;
