/**
 * Runtime validation of the KrakenEvent stream (ADR-0002 D5). zod lives HERE,
 * inside core, and never appears in any public .d.ts (ADR-0001 §5.3): the
 * public surface is the plain TS types in @kraken-e2e/contracts plus the generated
 * JSON Schema. The committed JSON-Schema snapshot test is the additive-only
 * evolution guard (ADR-0001 §5.12).
 */
import { KrakenError, type KrakenEvent } from '@kraken-e2e/contracts';
import { z } from 'zod';

const base = {
  ts: z.number(),
  runId: z.string().min(1),
  seq: z.number().int().positive(),
};

const serializedError = z
  .object({
    code: z.string(),
    message: z.string(),
    fix: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const stepStatus = z.enum(['passed', 'failed', 'skipped']);

const actorSummary = z
  .object({ id: z.string(), platform: z.string(), driverId: z.string() })
  .strict();

const artifactKind = z.enum(['screenshot', 'log', 'video', 'source']);
const logLevel = z.enum(['debug', 'info', 'warn', 'error']);

// One schema per event type. Additive-only: new OPTIONAL fields at most; a
// semantic change is a NEW event type (cucumber-messages model).
// Module-private: zod must never leak into a public surface (ADR-0001 §5.3).
const krakenEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('runStarted'),
      ...base,
      protocol: z.literal(1),
      scenarioCount: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('runFinished'),
      ...base,
      status: z.enum(['passed', 'failed']),
      durationMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('scenarioStarted'),
      ...base,
      scenarioId: z.string(),
      name: z.string(),
      featureUri: z.string().optional(),
      actors: z.array(actorSummary),
    })
    .strict(),
  z
    .object({
      type: z.literal('scenarioFinished'),
      ...base,
      scenarioId: z.string(),
      status: stepStatus,
      durationMs: z.number().nonnegative(),
      error: serializedError.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('stepStarted'),
      ...base,
      scenarioId: z.string(),
      stepId: z.string(),
      actorId: z.string(),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('stepFinished'),
      ...base,
      scenarioId: z.string(),
      stepId: z.string(),
      actorId: z.string(),
      text: z.string(),
      status: stepStatus,
      durationMs: z.number().nonnegative(),
      error: serializedError.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('actorSessionStarted'),
      ...base,
      scenarioId: z.string(),
      actorId: z.string(),
      driverId: z.string(),
      platformLabel: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('actorSessionFinished'),
      ...base,
      scenarioId: z.string(),
      actorId: z.string(),
      status: z.enum(['ok', 'failed']),
    })
    .strict(),
  z
    .object({
      type: z.literal('signalSent'),
      ...base,
      scenarioId: z.string(),
      signal: z.string(),
      from: z.string(),
      recordSeq: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('signalWaitStarted'),
      ...base,
      scenarioId: z.string(),
      signal: z.string(),
      actorId: z.string(),
      timeoutMs: z.number().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('signalReceived'),
      ...base,
      scenarioId: z.string(),
      signal: z.string(),
      by: z.string(),
      from: z.string(),
      latencyMs: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('signalTimedOut'),
      ...base,
      scenarioId: z.string(),
      signal: z.string(),
      actorId: z.string(),
      timeoutMs: z.number().positive(),
    })
    .strict(),
  z
    .object({
      type: z.literal('driverRegistered'),
      ...base,
      driverId: z.string(),
      version: z.string(),
      platforms: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal('driverDisabled'),
      ...base,
      driverId: z.string(),
      code: z.string(),
      reason: z.string(),
      fix: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('artifactCaptured'),
      ...base,
      kind: artifactKind,
      path: z.string(),
      scenarioId: z.string().optional(),
      actorId: z.string().optional(),
      stepId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('driverLog'),
      ...base,
      source: z.string(),
      level: logLevel,
      message: z.string(),
    })
    .strict(),
]);

/** Throws with a precise message when core emits a malformed event (a core bug). */
export function validateEvent(event: KrakenEvent): void {
  const result = krakenEventSchema.safeParse(event);
  if (!result.success) {
    throw new KrakenError(
      'KRK-RUN-ABORTED',
      `Internal error: core emitted a malformed "${event.type}" event: ${result.error.message}`,
      { data: { issues: JSON.parse(JSON.stringify(result.error.issues)) } },
    );
  }
}

/** The public, consumer-facing schema (future GUI, external tooling). */
export function krakenEventJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(krakenEventSchema) as Record<string, unknown>;
}
