import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  DriverServices,
  HostContext,
  KrakenDriver,
  Logger,
  Reporter,
} from '@kraken-e2e/contracts';
import { KrakenError, serializeError } from '@kraken-e2e/contracts';
import {
  type ActorSignals,
  type SignalBus,
  type SignalHandle,
  type SignalPayload,
  type SignalRecord,
  SignalTimeoutError,
  type WaitOptions,
} from '@kraken-e2e/signaling';

import { EventBus, type EventSink } from './event-bus.js';
import { createLogger, type LogLine, silentLogger } from './logger.js';
import type { DriverRegistry } from './registry.js';
import { type ActorRuntime, executePlan, type ScenarioPlan } from './scheduler.js';

/**
 * Wraps an ActorSignals handle so every publish/wait surfaces in the event
 * stream (signalSent / signalWaitStarted / signalReceived / signalTimedOut —
 * the live UI's signature moments, ADR-0001 §5.11/§5.12), and so scenario
 * aborts cancel pending waits by default.
 */
class InstrumentedActorSignals implements SignalHandle {
  constructor(
    private readonly inner: ActorSignals,
    private readonly events: EventSink,
    private readonly scenarioId: string,
    private readonly abort: AbortSignal,
  ) {}

  get subscriberId(): string {
    return this.inner.subscriberId;
  }

  async publish<P extends SignalPayload>(name: string, payload?: P): Promise<SignalRecord<P>> {
    const record = await this.inner.publish(name, payload);
    this.events.emit({
      type: 'signalSent',
      scenarioId: this.scenarioId,
      signal: name,
      from: this.subscriberId,
      recordSeq: record.seq,
    });
    return record;
  }

  async waitFor<P extends SignalPayload>(
    name: string,
    opts: WaitOptions<P>,
  ): Promise<SignalRecord<P>> {
    this.events.emit({
      type: 'signalWaitStarted',
      scenarioId: this.scenarioId,
      signal: name,
      actorId: this.subscriberId,
      timeoutMs: opts.timeoutMs,
    });
    const startedAt = Date.now();
    try {
      const record = await this.inner.waitFor(name, {
        ...opts,
        signal: opts.signal ?? this.abort,
      });
      this.events.emit({
        type: 'signalReceived',
        scenarioId: this.scenarioId,
        signal: name,
        by: this.subscriberId,
        from: record.from,
        latencyMs: Date.now() - startedAt,
      });
      return record;
    } catch (error) {
      if (error instanceof SignalTimeoutError) {
        this.events.emit({
          type: 'signalTimedOut',
          scenarioId: this.scenarioId,
          signal: name,
          actorId: this.subscriberId,
          timeoutMs: opts.timeoutMs,
        });
      }
      throw error;
    }
  }

  async barrier(
    name: string,
    opts: { participants: readonly string[]; timeoutMs: number; signal?: AbortSignal },
  ): Promise<void> {
    await this.publish(`${name}:${this.subscriberId}`);
    await Promise.all(
      opts.participants
        .filter((participant) => participant !== this.subscriberId)
        .map((participant) =>
          this.waitFor(`${name}:${participant}`, {
            timeoutMs: opts.timeoutMs,
            ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
          }),
        ),
    );
  }
}

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly name: string;
  readonly status: 'passed' | 'failed';
  readonly durationMs: number;
  readonly error?: unknown;
}

export interface RunnerDependencies {
  readonly registry: DriverRegistry;
  readonly signalBus: SignalBus;
  readonly events: EventBus;
  readonly hostContext: HostContext;
  readonly artifactsDir: string;
  readonly logger?: Logger;
  readonly logSink?: (line: LogLine) => void;
  /** Automatic screenshot policy (default 'on-failure'). */
  readonly screenshots?: 'on-failure' | 'per-step' | 'off';
}

function driverServices(
  deps: RunnerDependencies,
  source: string,
  abort: AbortSignal,
): DriverServices {
  const logger = deps.logSink ? createLogger(source, deps.logSink) : (deps.logger ?? silentLogger);
  return {
    runId: deps.events.runId,
    logger,
    artifactsDir: deps.artifactsDir,
    abort,
    emit: (emission) => {
      if (emission.type === 'driverLog') {
        deps.events.emit({
          type: 'driverLog',
          source,
          level: emission.level,
          message: emission.message,
        });
      } else {
        deps.events.emit({
          type: 'artifactCaptured',
          kind: emission.kind,
          path: emission.path,
          ...(emission.actorId !== undefined ? { actorId: emission.actorId } : {}),
        });
      }
    },
  };
}

const DISPOSE_TIMEOUT_MS = 15_000;

type TimeoutOutcome = 'ok' | 'error' | 'timeout';

async function withTimeout(work: Promise<void>, ms: number): Promise<TimeoutOutcome> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  const outcome = await Promise.race([
    work.then(
      (): TimeoutOutcome => 'ok',
      (): TimeoutOutcome => 'error',
    ),
    timeout,
  ]);
  clearTimeout(timer);
  return outcome;
}

/**
 * Runs one scenario end to end (ADR-0002 D7): boot all actor sessions
 * (allSettled + rollback — never leak a booted device), open the signal scope,
 * execute the plan, capture artifacts from ALL actors on failure, and tear
 * everything down in finally with timeout guards.
 */
export class ScenarioRunner {
  constructor(private readonly deps: RunnerDependencies) {}

  async run(plan: ScenarioPlan): Promise<ScenarioResult> {
    const { deps } = this;
    const startedAt = Date.now();
    const abortController = new AbortController();

    // Resolve every actor's driver BEFORE any session boots: an iOS actor on a
    // non-macOS host fails here, fast and explicit (C4b).
    const bindings = plan.actors.map((actor) => ({
      actor,
      driver: deps.registry.driverFor(actor.platform),
    }));

    deps.events.emit({
      type: 'scenarioStarted',
      scenarioId: plan.scenarioId,
      name: plan.name,
      ...(plan.featureUri !== undefined ? { featureUri: plan.featureUri } : {}),
      actors: bindings.map(({ actor, driver }) => ({
        id: actor.id,
        platform: actor.platform,
        driverId: driver.manifest.id,
      })),
    });

    const finish = (status: 'passed' | 'failed', error?: unknown): ScenarioResult => {
      deps.events.emit({
        type: 'scenarioFinished',
        scenarioId: plan.scenarioId,
        status,
        durationMs: Date.now() - startedAt,
        ...(error !== undefined ? { error: serializeError(error) } : {}),
      });
      return {
        scenarioId: plan.scenarioId,
        name: plan.name,
        status,
        durationMs: Date.now() - startedAt,
        ...(error !== undefined ? { error } : {}),
      };
    };

    // ── Boot sessions: allSettled, roll back the booted ones on any failure ──
    const settled = await Promise.allSettled(
      bindings.map(async ({ actor, driver }) => {
        const services = driverServices(
          deps,
          `driver:${driver.manifest.id}/${actor.id}`,
          abortController.signal,
        );
        const session = await driver.createSession(actor, services);
        return { actor, driver, session };
      }),
    );
    const booted = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const bootFailures = settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (bootFailures.length > 0) {
      await Promise.all(booted.map((b) => withTimeout(b.session.dispose(), DISPOSE_TIMEOUT_MS)));
      const cause = bootFailures[0];
      return finish(
        'failed',
        KrakenError.is(cause)
          ? cause
          : KrakenError.wrap(cause, 'KRK-SESSION-CREATE-FAILED', 'Actor session boot failed'),
      );
    }

    for (const { actor, driver } of booted) {
      deps.events.emit({
        type: 'actorSessionStarted',
        scenarioId: plan.scenarioId,
        actorId: actor.id,
        driverId: driver.manifest.id,
        platformLabel: driver.manifest.platformLabel,
      });
    }

    // ── Signal scope + actor runtimes ──
    const scoped = deps.signalBus.scope({
      runId: deps.events.runId,
      scenarioId: plan.scenarioId,
    });
    await scoped.open();

    const actors = new Map<string, ActorRuntime>(
      booted.map(({ actor, session }) => [
        actor.id,
        {
          id: actor.id,
          platform: actor.platform,
          session,
          data: actor.data ?? {},
          signals: new InstrumentedActorSignals(
            scoped.forActor(actor.id),
            deps.events,
            plan.scenarioId,
            abortController.signal,
          ),
          log: deps.logSink
            ? createLogger(`actor:${actor.id}`, deps.logSink)
            : (deps.logger ?? silentLogger),
        },
      ]),
    );

    let result: ScenarioResult;
    try {
      const execution = await executePlan(plan, {
        actors,
        events: deps.events,
        abortController,
        ...(deps.screenshots !== undefined ? { screenshots: deps.screenshots } : {}),
      });

      if (execution.status === 'failed') {
        if (deps.screenshots !== 'off') {
          await this.#captureFailureArtifacts(plan.scenarioId, actors);
        }
        result = finish('failed', execution.error);
      } else {
        result = finish('passed');
      }
    } finally {
      // Sessions first: device teardown must never depend on transport health.
      await Promise.all(
        booted.map(async ({ actor, session }) => {
          const outcome = await withTimeout(session.dispose(), DISPOSE_TIMEOUT_MS);
          deps.events.emit({
            type: 'actorSessionFinished',
            scenarioId: plan.scenarioId,
            actorId: actor.id,
            status: outcome === 'ok' ? 'ok' : 'failed',
          });
        }),
      );
      try {
        await scoped.destroy();
      } catch {
        // A failing transport must not mask the scenario result.
      }
    }
    return result;
  }

  /** Best-effort screenshots from EVERY actor — the all-actors snapshot (ADR-0002 D7). */
  async #captureFailureArtifacts(
    scenarioId: string,
    actors: ReadonlyMap<string, ActorRuntime>,
  ): Promise<void> {
    await Promise.all(
      [...actors.values()].map(async (actor) => {
        try {
          const artifact = await actor.session.screenshot();
          this.deps.events.emit({
            type: 'artifactCaptured',
            kind: artifact.kind,
            path: artifact.path,
            scenarioId,
            actorId: actor.id,
          });
        } catch {
          // Artifact capture must never mask the real failure.
        }
        try {
          // ADR-0002 D7: screenshot + SOURCE from every actor, best-effort.
          const dump = await actor.session.source();
          const path = join(
            this.deps.artifactsDir,
            `${scenarioId}-${actor.id}-source.txt`.replace(/[^\w.-]+/g, '_'),
          );
          writeFileSync(path, dump);
          this.deps.events.emit({
            type: 'artifactCaptured',
            kind: 'source',
            path,
            scenarioId,
            actorId: actor.id,
          });
        } catch {
          // Best-effort, same rule.
        }
      }),
    );
  }
}

export interface RunOptions {
  readonly plans: readonly ScenarioPlan[];
  readonly registry: DriverRegistry;
  readonly signalBus: SignalBus;
  readonly hostContext: HostContext;
  readonly reporters?: readonly Reporter[];
  readonly artifactsDir?: string;
  readonly runId?: string;
  readonly logSink?: (line: LogLine) => void;
  readonly onReporterError?: (reporterId: string, error: unknown) => void;
  /** Automatic screenshot policy (default 'on-failure'). */
  readonly screenshots?: 'on-failure' | 'per-step' | 'off';
}

export interface RunResult {
  readonly runId: string;
  readonly status: 'passed' | 'failed';
  readonly scenarios: readonly ScenarioResult[];
}

/**
 * The run coordinator: starts each involved driver once, runs scenarios
 * sequentially, stops drivers and flushes reporters in finally
 * (ADR-0002 D7; Phase 1 runs scenarios serially — parallel scenario
 * scheduling is a later concern).
 */
export async function runScenarios(options: RunOptions): Promise<RunResult> {
  const runId = options.runId ?? randomUUID();
  const events = new EventBus(runId, {
    ...(options.onReporterError !== undefined ? { onReporterError: options.onReporterError } : {}),
  });
  for (const reporter of options.reporters ?? []) {
    events.subscribe(reporter);
  }

  const artifactsDir = options.artifactsDir ?? join(process.cwd(), '.kraken', 'runs', runId);
  mkdirSync(artifactsDir, { recursive: true });

  const runAbort = new AbortController();
  const deps: RunnerDependencies = {
    registry: options.registry,
    signalBus: options.signalBus,
    events,
    hostContext: options.hostContext,
    artifactsDir,
    ...(options.logSink !== undefined ? { logSink: options.logSink } : {}),
    ...(options.screenshots !== undefined ? { screenshots: options.screenshots } : {}),
  };

  events.emit({ type: 'runStarted', protocol: 1, scenarioCount: options.plans.length });
  const startedAt = Date.now();
  const scenarios: ScenarioResult[] = [];

  // Start each involved driver exactly once per run (ADR-0002 D2).
  const startedDrivers: KrakenDriver[] = [];
  try {
    const uniqueDrivers = new Map<string, KrakenDriver>();
    for (const plan of options.plans) {
      for (const actor of plan.actors) {
        const driver = options.registry.driverFor(actor.platform);
        uniqueDrivers.set(driver.manifest.id, driver);
      }
    }
    for (const driver of uniqueDrivers.values()) {
      try {
        await driver.start(
          options.hostContext,
          driverServices(deps, `driver:${driver.manifest.id}`, runAbort.signal),
        );
        startedDrivers.push(driver);
      } catch (cause) {
        throw KrakenError.wrap(
          cause,
          'KRK-DRIVER-START-FAILED',
          `Driver "${driver.manifest.id}" failed to start`,
        );
      }
    }

    const runner = new ScenarioRunner(deps);
    for (const plan of options.plans) {
      scenarios.push(await runner.run(plan));
    }
  } finally {
    runAbort.abort();
    for (const driver of startedDrivers.reverse()) {
      try {
        await driver.stop();
      } catch {
        // stop() is declared idempotent/best-effort; a failing stop must not mask results.
      }
    }
    const status: 'passed' | 'failed' =
      scenarios.length === options.plans.length && scenarios.every((s) => s.status === 'passed')
        ? 'passed'
        : 'failed';
    events.emit({ type: 'runFinished', status, durationMs: Date.now() - startedAt });
    await events.flush();
  }

  return {
    runId,
    status: scenarios.every((s) => s.status === 'passed') ? 'passed' : 'failed',
    scenarios,
  };
}

/** Boot-failure sessions and similar cleanup share this constant. */
export const SESSION_DISPOSE_TIMEOUT_MS = DISPOSE_TIMEOUT_MS;
