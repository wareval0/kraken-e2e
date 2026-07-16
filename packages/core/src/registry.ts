import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CONTRACT_VERSION,
  type ContractVersion,
  checkHostRequirements,
  type DriverManifest,
  type HostInfo,
  isContractCompatible,
  isKrakenDriver,
  type KrakenDriver,
  KrakenError,
} from '@kraken-e2e/contracts';

import type { EventSink } from './event-bus.js';

/** Config-facing registration forms (ADR-0001 §5.10): values, names, or tuples. */
export type DriverRegistration =
  | KrakenDriver
  | string
  | readonly [packageName: string, options?: unknown];

export type DriverStatus =
  | { readonly state: 'ready'; readonly driver: KrakenDriver }
  | {
      readonly state: 'unavailable-on-host';
      readonly manifest: DriverManifest;
      readonly code: `KRK-HOST-${string}-UNSUPPORTED`;
      readonly reason: string;
      readonly fix: string;
    }
  | {
      readonly state: 'incompatible';
      readonly id: string;
      readonly platforms: readonly string[];
      readonly found: ContractVersion;
      readonly supported: ContractVersion;
      readonly fix: string;
    }
  | { readonly state: 'invalid'; readonly ref: string; readonly problems: readonly string[] };

function manifestProblems(manifest: unknown): string[] {
  const problems: string[] = [];
  if (typeof manifest !== 'object' || manifest === null) {
    return ['manifest is not an object'];
  }
  const m = manifest as Partial<DriverManifest>;
  if (m.kind !== 'kraken-driver') problems.push(`manifest.kind must be 'kraken-driver'`);
  if (typeof m.id !== 'string' || m.id.length === 0)
    problems.push('manifest.id must be a non-empty string');
  if (!Array.isArray(m.platforms) || m.platforms.length === 0)
    problems.push('manifest.platforms must be a non-empty array');
  if (typeof m.version !== 'string') problems.push('manifest.version must be a string');
  if (typeof m.platformLabel !== 'string') problems.push('manifest.platformLabel must be a string');
  const contract = m.contract as ContractVersion | undefined;
  if (
    typeof contract !== 'object' ||
    contract === null ||
    typeof contract.major !== 'number' ||
    typeof contract.minor !== 'number'
  ) {
    problems.push(
      'manifest.contract must be { major, minor } (use defineDriver — never hand-write it)',
    );
  }
  return problems;
}

/**
 * Loads, validates, version-checks, and host-gates drivers (ADR-0002 D3/D4).
 * Check order per driver: brand → manifest shape → contract compatibility →
 * host requirements. Every failure is a status with remediation, surfaced via
 * events and `kraken doctor` — never a bare stack trace.
 */
export class DriverRegistry {
  readonly #statuses: DriverStatus[] = [];
  readonly #byPlatform = new Map<string, DriverStatus>();

  private constructor() {}

  static async create(options: {
    registrations: readonly DriverRegistration[];
    host: HostInfo;
    events?: EventSink;
    /** Required for string-form registrations (resolution anchor — pnpm-safe). */
    projectRoot?: string;
  }): Promise<DriverRegistry> {
    const registry = new DriverRegistry();
    for (const registration of options.registrations) {
      const status = await registry.#load(registration, options);
      registry.#statuses.push(status);
      registry.#index(status);
      registry.#announce(status, options.events);
    }
    return registry;
  }

  async #load(
    registration: DriverRegistration,
    options: { host: HostInfo; projectRoot?: string },
  ): Promise<DriverStatus> {
    if (typeof registration === 'string' || Array.isArray(registration)) {
      const [packageName, driverOptions] =
        typeof registration === 'string'
          ? [registration, undefined]
          : (registration as readonly [string, unknown?]);
      return this.#loadFromPackage(packageName, driverOptions, options);
    }
    return this.#validate(registration as KrakenDriver, options.host, '(value registration)');
  }

  /**
   * String form: import `<pkg>/manifest` (zero heavy imports) and host-gate
   * BEFORE importing the main entry (ADR-0001 §5.5) — importing driver-ios on
   * Linux must never crash on missing native deps before a friendly error.
   */
  async #loadFromPackage(
    packageName: string,
    driverOptions: unknown,
    options: { host: HostInfo; projectRoot?: string },
  ): Promise<DriverStatus> {
    if (!options.projectRoot) {
      return {
        state: 'invalid',
        ref: packageName,
        problems: [
          'string-form driver registration requires a projectRoot to resolve from ' +
            '(pass registered driver VALUES instead, or provide projectRoot)',
        ],
      };
    }
    const resolve = createRequire(join(options.projectRoot, 'package.json')).resolve;

    let manifest: DriverManifest;
    try {
      const manifestPath = resolve(`${packageName}/manifest`);
      const manifestModule = (await import(pathToFileURL(manifestPath).href)) as {
        default?: DriverManifest;
        manifest?: DriverManifest;
      };
      const candidate = manifestModule.default ?? manifestModule.manifest;
      if (!candidate) {
        return {
          state: 'invalid',
          ref: packageName,
          problems: [`${packageName}/manifest has no default (or named 'manifest') export`],
        };
      }
      manifest = candidate;
    } catch (cause) {
      return {
        state: 'invalid',
        ref: packageName,
        problems: [
          `could not resolve ${packageName}/manifest from ${options.projectRoot}: ` +
            `${cause instanceof Error ? cause.message : String(cause)}`,
          `Is the driver installed? Try: kraken plugins install ${packageName}`,
        ],
      };
    }

    const problems = manifestProblems(manifest);
    if (problems.length > 0) return { state: 'invalid', ref: packageName, problems };

    const gate = checkHostRequirements(manifest.hostRequirements, options.host);
    if (!gate.ok) return this.#disabled(manifest, gate.reason, gate.fix);

    // Host OK — now (and only now) import the real entry and build the driver.
    try {
      const entryPath = resolve(packageName);
      const entryModule = (await import(pathToFileURL(entryPath).href)) as {
        default?: (opts?: unknown) => KrakenDriver;
      };
      if (typeof entryModule.default !== 'function') {
        return {
          state: 'invalid',
          ref: packageName,
          problems: [`${packageName} default export is not a defineDriver() factory`],
        };
      }
      return this.#validate(entryModule.default(driverOptions), options.host, packageName);
    } catch (cause) {
      return {
        state: 'invalid',
        ref: packageName,
        problems: [
          `failed to load ${packageName}: ${cause instanceof Error ? cause.message : String(cause)}`,
        ],
      };
    }
  }

  #validate(candidate: KrakenDriver, host: HostInfo, ref: string): DriverStatus {
    if (!isKrakenDriver(candidate)) {
      return {
        state: 'invalid',
        ref,
        problems: [
          'value is not a Kraken driver (missing brand). Drivers must be created with ' +
            "defineDriver() from '@kraken-e2e/contracts'.",
        ],
      };
    }
    const problems = manifestProblems(candidate.manifest);
    if (problems.length > 0) return { state: 'invalid', ref, problems };

    const manifest = candidate.manifest;
    if (!isContractCompatible(manifest.contract, CONTRACT_VERSION)) {
      return {
        state: 'incompatible',
        id: manifest.id,
        platforms: manifest.platforms,
        found: manifest.contract,
        supported: CONTRACT_VERSION,
        fix:
          manifest.contract.major === CONTRACT_VERSION.major
            ? `The driver was built against contract ${manifest.contract.major}.${manifest.contract.minor}, newer than this core supports (${CONTRACT_VERSION.major}.${CONTRACT_VERSION.minor}). Upgrade @kraken-e2e/core.`
            : `Contract majors differ (driver ${manifest.contract.major}.x vs core ${CONTRACT_VERSION.major}.x). Align the driver and @kraken-e2e/core major versions.`,
      };
    }

    const gate = checkHostRequirements(manifest.hostRequirements, host);
    if (!gate.ok) return this.#disabled(manifest, gate.reason, gate.fix);

    return { state: 'ready', driver: candidate };
  }

  #disabled(manifest: DriverManifest, reason: string, fallbackFix: string): DriverStatus {
    return {
      state: 'unavailable-on-host',
      manifest,
      code: `KRK-HOST-${manifest.id.toUpperCase()}-UNSUPPORTED`,
      reason: `${manifest.platformLabel} ${reason}`,
      fix: manifest.disabledFix ?? fallbackFix,
    };
  }

  #index(status: DriverStatus): void {
    const platforms =
      status.state === 'ready'
        ? status.driver.manifest.platforms
        : status.state === 'unavailable-on-host'
          ? status.manifest.platforms
          : status.state === 'incompatible'
            ? status.platforms
            : [];
    for (const platform of platforms) {
      if (!this.#byPlatform.has(platform)) this.#byPlatform.set(platform, status);
    }
  }

  #announce(status: DriverStatus, events?: EventSink): void {
    if (!events) return;
    if (status.state === 'ready') {
      events.emit({
        type: 'driverRegistered',
        driverId: status.driver.manifest.id,
        version: status.driver.manifest.version,
        platforms: status.driver.manifest.platforms,
      });
    } else if (status.state === 'unavailable-on-host') {
      events.emit({
        type: 'driverDisabled',
        driverId: status.manifest.id,
        code: status.code,
        reason: status.reason,
        fix: status.fix,
      });
    }
  }

  statuses(): readonly DriverStatus[] {
    return this.#statuses;
  }

  readyDrivers(): readonly KrakenDriver[] {
    return this.#statuses.flatMap((status) => (status.state === 'ready' ? [status.driver] : []));
  }

  /**
   * Fails FAST and explicitly (constraint C4b): binding an actor to a
   * host-disabled platform is an error before any session boots.
   */
  driverFor(platform: string): KrakenDriver {
    const status = this.#byPlatform.get(platform);
    if (!status) {
      const known = [...this.#byPlatform.keys()];
      throw new KrakenError(
        'KRK-DRIVER-UNKNOWN-PLATFORM',
        `No registered driver provides platform "${platform}".` +
          (known.length > 0
            ? ` Known platforms: ${known.join(', ')}.`
            : ' No drivers are registered.'),
        { fix: 'Register the driver in kraken.config.ts (drivers: [...]).' },
      );
    }
    if (status.state === 'unavailable-on-host') {
      throw new KrakenError(status.code, status.reason, {
        fix: status.fix,
        data: { driverId: status.manifest.id, platform },
      });
    }
    if (status.state === 'incompatible') {
      throw new KrakenError(
        'KRK-PLUGIN-INCOMPATIBLE',
        `Driver "${status.id}" was built against contract ` +
          `${status.found.major}.${status.found.minor}; this core supports ` +
          `${status.supported.major}.${status.supported.minor}.`,
        { fix: status.fix },
      );
    }
    if (status.state === 'invalid') {
      throw new KrakenError('KRK-PLUGIN-INVALID', `Driver "${status.ref}" failed validation.`, {
        data: { problems: status.problems },
        fix: status.problems.join(' | '),
      });
    }
    return status.driver;
  }
}
