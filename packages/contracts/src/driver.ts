/**
 * The driver SPI (ADR-0001 §5.10 / ADR-0002 D2). A driver package's default
 * export is a factory produced by defineDriver(); the brand symbol survives
 * duplicate copies of this package in the tree, and the baked CONTRACT_VERSION
 * is what the registry checks at load time.
 */
import type { HostContext, HostRequirements } from './host.js';
import type { UserSession } from './session.js';
import { CONTRACT_VERSION, type ContractVersion } from './version.js';

export const DRIVER_BRAND: unique symbol = Symbol.for('kraken.driver/v1') as never;

export interface DriverManifest {
  readonly kind: 'kraken-driver';
  /** Short id: 'android' | 'ios' | 'web' | custom. */
  readonly id: string;
  /** Platform ids actors bind to (usually [id]; web may expose more). */
  readonly platforms: readonly string[];
  /** The driver package's own version. */
  readonly version: string;
  /** Baked by defineDriver — never hand-written. */
  readonly contract: ContractVersion;
  /** Human label for messages: 'iOS (XCUITest via Appium 3)'. */
  readonly platformLabel: string;
  readonly hostRequirements?: HostRequirements;
  /** Actionable remediation shown when the driver is host-disabled. */
  readonly disabledFix?: string;
  /** Printed after `kraken plugins install`. */
  readonly setupHints?: readonly string[];
}

/** Drivers NEVER write to stdout — they get a logger (ADR-0001 §5.11). */
export interface Logger {
  debug(message: string, meta?: Readonly<Record<string, unknown>>): void;
  info(message: string, meta?: Readonly<Record<string, unknown>>): void;
  warn(message: string, meta?: Readonly<Record<string, unknown>>): void;
  error(message: string, meta?: Readonly<Record<string, unknown>>): void;
}

/** The only events a driver may emit directly; core stamps the envelope. */
export type DriverEmission =
  | {
      readonly type: 'driverLog';
      readonly level: 'debug' | 'info' | 'warn' | 'error';
      readonly message: string;
    }
  | {
      readonly type: 'artifactCaptured';
      readonly kind: 'screenshot' | 'log' | 'video' | 'source';
      readonly path: string;
      readonly actorId?: string;
    };

export interface DriverServices {
  readonly runId: string;
  readonly logger: Logger;
  /** Per-run scratch for videos, server logs, screenshots. */
  readonly artifactsDir: string;
  /** Fired on failFast teardown/SIGINT — long driver operations must honor it. */
  readonly abort: AbortSignal;
  emit(event: DriverEmission): void;
}

export interface ResolvedActor {
  readonly id: string;
  readonly platform: string;
  /** Driver-specific actor configuration from kraken.config.ts, passed through. */
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * Per-actor data (contract 2.2): the `data` field of the actor config,
   * merged with any `env` file it references. Step-facing (exposed as
   * `actor.data`) — credentials, per-actor fixtures — NOT sent to the driver.
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * A concrete automation target a driver can see on this host RIGHT NOW —
 * the answer to "what devices do I already have?" (`kraken devices`).
 * `running` targets are usable immediately (booted simulator, connected
 * device); `available` ones can be provisioned on demand (an AVD to boot,
 * an installed browser).
 */
export interface DeviceTarget {
  /** Stable identifier: udid / adb serial / AVD name / browser key. */
  readonly id: string;
  /** Human name: 'iPhone 17', 'Medium_Phone_API_36.0', 'Chrome'. */
  readonly name: string;
  /** The platform id actors bind to ('android' | 'ios' | 'web' | custom). */
  readonly platform: string;
  readonly kind: 'device' | 'emulator' | 'simulator' | 'browser';
  readonly state: 'running' | 'available';
  /** Ready-to-paste actor config for kraken.config.ts. */
  readonly actorConfig?: Readonly<Record<string, unknown>>;
  readonly detail?: string;
}

export type DoctorStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheckResult {
  readonly status: DoctorStatus;
  readonly detail?: string;
  /** Actionable remediation — the whole point of kraken doctor (constraint C10). */
  readonly fix?: string;
}

export interface DoctorCheck {
  /** Stable id, e.g. 'ios.xcode-version'. */
  readonly id: string;
  readonly title: string;
  run(host: HostContext): Promise<DoctorCheckResult>;
}

export interface KrakenDriver<Opts = unknown> {
  readonly [DRIVER_BRAND]: true;
  readonly manifest: DriverManifest;
  /** Environment checks contributed to `kraken doctor` (ADR-0002 D2). */
  readonly doctor?: readonly DoctorCheck[];
  /** Boot shared infra (e.g. an Appium server) once per run. */
  start(host: HostContext, services: DriverServices): Promise<void>;
  /** One INDEPENDENT session per actor (ADR-0001 §5.6 — never multiremote). */
  createSession(actor: ResolvedActor, services: DriverServices): Promise<UserSession>;
  /** Idempotent — SIGINT teardown may call it more than once. */
  stop(): Promise<void>;
  /**
   * OPTIONAL (contract 2.1): enumerate the targets this driver can drive on
   * this host — booted/connected first-class. Powers `kraken devices`.
   * Must be cheap, read-only, and never boot anything.
   */
  listTargets?(host: HostContext): Promise<readonly DeviceTarget[]>;
  /** Phantom marker so Opts survives inference; never set at runtime. */
  readonly __optionsType?: Opts;
}

/** What driver authors write; defineDriver adds the brand and bakes the contract. */
export interface DriverSpec {
  readonly manifest: Omit<DriverManifest, 'kind' | 'contract'>;
  readonly doctor?: readonly DoctorCheck[];
  start(host: HostContext, services: DriverServices): Promise<void>;
  createSession(actor: ResolvedActor, services: DriverServices): Promise<UserSession>;
  stop(): Promise<void>;
  listTargets?(host: HostContext): Promise<readonly DeviceTarget[]>;
}

/**
 * Factory-returning: kraken.config.ts calls `android({ avd: 'Pixel_8' })` and
 * registers the VALUE — dependency injection, the hexagonal answer
 * (ADR-0001 §5.10). The driver package's main entry must stay import-safe on
 * every host (ADR-0001 §5.5): dynamic-import heavy deps inside start().
 */
export function defineDriver<Opts = void>(
  build: (opts: Opts) => DriverSpec,
): (opts?: Opts) => KrakenDriver<Opts> {
  return (opts?: Opts): KrakenDriver<Opts> => {
    const spec = build(opts as Opts);
    return {
      [DRIVER_BRAND]: true as const,
      manifest: { ...spec.manifest, kind: 'kraken-driver', contract: CONTRACT_VERSION },
      ...(spec.doctor !== undefined ? { doctor: spec.doctor } : {}),
      ...(spec.listTargets !== undefined ? { listTargets: spec.listTargets } : {}),
      start: spec.start,
      createSession: spec.createSession,
      stop: spec.stop,
    };
  };
}

/** Runtime check the registry uses; works across duplicate contract copies. */
export function isKrakenDriver(value: unknown): value is KrakenDriver {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[DRIVER_BRAND] === true
  );
}
