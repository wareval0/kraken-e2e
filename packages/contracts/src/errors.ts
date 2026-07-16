/**
 * Error taxonomy (ADR-0001 §5.12 / ADR-0002 D6): stable KRK-* codes so CLI,
 * doctor, reporters, and the future GUI render errors consistently.
 * Stability rule: released codes are NEVER renamed or reused.
 * Third-party drivers mint codes under `KRK-DRV-<ID>-*`.
 */

export const KrakenErrorCodes = {
  /** Generic host gate; driver-specific variants are composed as `KRK-HOST-<ID>-UNSUPPORTED`. */
  HOST_UNSUPPORTED: 'KRK-HOST-UNSUPPORTED',
  CONFIG_INVALID: 'KRK-CONFIG-INVALID',
  CONFIG_NOT_FOUND: 'KRK-CONFIG-NOT-FOUND',
  PLUGIN_NOT_FOUND: 'KRK-PLUGIN-NOT-FOUND',
  PLUGIN_INVALID: 'KRK-PLUGIN-INVALID',
  PLUGIN_INCOMPATIBLE: 'KRK-PLUGIN-INCOMPATIBLE',
  DRIVER_UNKNOWN_PLATFORM: 'KRK-DRIVER-UNKNOWN-PLATFORM',
  DRIVER_START_FAILED: 'KRK-DRIVER-START-FAILED',
  /** An actor's configured app file does not exist (fail-fast, pre-boot). */
  DRIVER_APP_NOT_FOUND: 'KRK-DRIVER-APP-NOT-FOUND',
  SESSION_CREATE_FAILED: 'KRK-SESSION-CREATE-FAILED',
  SESSION_OP_UNSUPPORTED: 'KRK-SESSION-OP-UNSUPPORTED',
  SESSION_ELEMENT_NOT_FOUND: 'KRK-SESSION-ELEMENT-NOT-FOUND',
  SESSION_WAIT_TIMEOUT: 'KRK-SESSION-WAIT-TIMEOUT',
  SIGNAL_TIMEOUT: 'KRK-SIGNAL-TIMEOUT',
  STEP_UNMATCHED: 'KRK-STEP-UNMATCHED',
  STEP_AMBIGUOUS: 'KRK-STEP-AMBIGUOUS',
  STEP_UNKNOWN_ACTOR: 'KRK-STEP-UNKNOWN-ACTOR',
  STEP_FAILED: 'KRK-STEP-FAILED',
  PLAN_DEADLOCK: 'KRK-PLAN-DEADLOCK',
  PLAN_UNJOINED_TASK: 'KRK-PLAN-UNJOINED-TASK',
  PLAN_UNKNOWN_TASK: 'KRK-PLAN-UNKNOWN-TASK',
  PLAN_DUPLICATE_TASK: 'KRK-PLAN-DUPLICATE-TASK',
  TASK_JOIN_TIMEOUT: 'KRK-PLAN-TASK-JOIN-TIMEOUT',
  RUN_ABORTED: 'KRK-RUN-ABORTED',
} as const;

export type KrakenErrorCode =
  | (typeof KrakenErrorCodes)[keyof typeof KrakenErrorCodes]
  | `KRK-HOST-${string}-UNSUPPORTED`
  | `KRK-DRV-${string}`;

export interface SerializedKrakenError {
  readonly code: string;
  readonly message: string;
  readonly fix?: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export class KrakenError extends Error {
  override readonly name = 'KrakenError';
  readonly code: KrakenErrorCode;
  /** Actionable remediation — what CLI/doctor/GUI render next to the message. */
  readonly fix: string | undefined;
  readonly data: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: KrakenErrorCode,
    message: string,
    options?: {
      fix?: string | undefined;
      data?: Readonly<Record<string, unknown>> | undefined;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.fix = options?.fix;
    this.data = options?.data;
  }

  toJSON(): SerializedKrakenError {
    return {
      code: this.code,
      message: this.message,
      ...(this.fix !== undefined ? { fix: this.fix } : {}),
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }

  static is(error: unknown): error is KrakenError {
    return error instanceof KrakenError;
  }

  /** Wraps a foreign error, preserving it as `cause`. */
  static wrap(error: unknown, code: KrakenErrorCode, message?: string): KrakenError {
    if (KrakenError.is(error)) return error;
    const detail = error instanceof Error ? error.message : String(error);
    return new KrakenError(code, message ? `${message}: ${detail}` : detail, { cause: error });
  }
}

/** Serializes any error into the event-carriable shape. */
export function serializeError(error: unknown): SerializedKrakenError {
  if (KrakenError.is(error)) return error.toJSON();
  if (error instanceof Error) {
    return { code: 'KRK-STEP-FAILED', message: `${error.name}: ${error.message}` };
  }
  return { code: 'KRK-STEP-FAILED', message: String(error) };
}
