import type { Logger, ResolvedActor, UserSession } from '@kraken-e2e/contracts';
import { KrakenError, serializeError } from '@kraken-e2e/contracts';
import type { SignalHandle } from '@kraken-e2e/signaling';

import type { EventSink } from './event-bus.js';

/** What a step's run() receives for its addressed actor. */
export interface ActorRuntime {
  readonly id: string;
  readonly platform: string;
  readonly session: UserSession;
  readonly signals: SignalHandle;
  readonly log: Logger;
  /** Per-actor data from kraken.config.ts (`data` + resolved `env` file). */
  readonly data: Readonly<Record<string, unknown>>;
}

export interface StepRunContext {
  readonly actor: ActorRuntime;
  /** Per-scenario shared state across all actors' steps. */
  readonly world: Record<string, unknown>;
  readonly tasks: TaskRegistry;
  /** Fired on failFast — long operations must honor it. */
  readonly abort: AbortSignal;
  /** All actor runtimes, for the rare step that must inspect another actor. */
  readonly actors: ReadonlyMap<string, ActorRuntime>;
}

export type PlanNodeKind = 'step' | 'detach' | 'join';

export interface PlanNode {
  readonly id: string;
  readonly actorId: string;
  readonly kind: PlanNodeKind;
  /** Human-readable step text (Gherkin text or programmatic title). */
  readonly title: string;
  /** Default compilation is a chain (screenplay total order — ADR-0001 D6). */
  readonly dependsOn: readonly string[];
  /** detach/join: the named background-task handle. */
  readonly taskHandle?: string;
  /** join: how long to wait for the task. */
  readonly joinTimeoutMs?: number;
  run(ctx: StepRunContext): Promise<void>;
}

export interface ScenarioPlan {
  readonly scenarioId: string;
  readonly name: string;
  readonly featureUri?: string;
  readonly actors: readonly ResolvedActor[];
  readonly nodes: readonly PlanNode[];
}

type TrackedOutcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

/**
 * Named background tasks (the detach/join escape hatch — ADR-0001 §5.9).
 * An unjoined handle at scenario end fails the scenario (leak detection).
 */
export class TaskRegistry {
  readonly #tasks = new Map<
    string,
    { readonly outcome: Promise<TrackedOutcome>; readonly startedBy: string; joined: boolean }
  >();

  /**
   * Check-then-start: the duplicate-handle check runs BEFORE the task body is
   * invoked, so a rejected registration never leaves an untracked task running
   * (and never produces an unhandled rejection).
   */
  register(handle: string, start: () => Promise<void>, startedBy: string): void {
    if (this.#tasks.has(handle)) {
      throw new KrakenError(
        'KRK-PLAN-DUPLICATE-TASK',
        `A background task named "${handle}" is already running.`,
        { fix: 'Use a distinct handle per detached task within a scenario.' },
      );
    }
    // Track the settlement so an early rejection never becomes an unhandled one.
    const outcome = start().then(
      (): TrackedOutcome => ({ ok: true }),
      (error): TrackedOutcome => ({ ok: false, error }),
    );
    this.#tasks.set(handle, { outcome, startedBy, joined: false });
  }

  async join(handle: string, timeoutMs: number): Promise<void> {
    const entry = this.#tasks.get(handle);
    if (!entry) {
      throw new KrakenError(
        'KRK-PLAN-UNKNOWN-TASK',
        `No background task named "${handle}" was started.`,
        { fix: 'Start it with a detached step before joining it.' },
      );
    }
    entry.joined = true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const result = await Promise.race([entry.outcome, timeout]);
    clearTimeout(timer);
    if (result === 'timeout') {
      throw new KrakenError(
        'KRK-PLAN-TASK-JOIN-TIMEOUT',
        `Background task "${handle}" (started by ${entry.startedBy}) did not complete within ${timeoutMs}ms.`,
      );
    }
    if (!result.ok) {
      throw KrakenError.wrap(result.error, 'KRK-STEP-FAILED', `Background task "${handle}" failed`);
    }
  }

  unjoined(): readonly { handle: string; startedBy: string }[] {
    return [...this.#tasks.entries()]
      .filter(([, entry]) => !entry.joined)
      .map(([handle, entry]) => ({ handle, startedBy: entry.startedBy }));
  }

  /**
   * Settle everything (ignoring outcomes) so nothing dangles past the
   * scenario — with a budget: a detached task that ignores the AbortSignal
   * must never hang the run forever. Returns the handles still pending after
   * the budget so the caller can fail the scenario explicitly.
   */
  async drain(timeoutMs: number): Promise<readonly string[]> {
    const entries = [...this.#tasks.entries()];
    const settled = new Set<string>();
    await Promise.race([
      Promise.all(
        entries.map(async ([handle, entry]) => {
          await entry.outcome;
          settled.add(handle);
        }),
      ),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    return entries.map(([handle]) => handle).filter((handle) => !settled.has(handle));
  }
}

export interface PlanExecutionResult {
  readonly status: 'passed' | 'failed';
  readonly error?: unknown;
  readonly failedNodeId?: string;
}

/**
 * Executes a ScenarioPlan (ADR-0002 D7). The default shape is a chain, so
 * execution is sequential in text order; `detach` nodes spawn tracked tasks;
 * `join` nodes await them. Failure policy is failFast: the first failure
 * aborts in-flight sibling work via the shared AbortSignal.
 */
export async function executePlan(
  plan: ScenarioPlan,
  deps: {
    readonly actors: ReadonlyMap<string, ActorRuntime>;
    readonly events: EventSink;
    readonly abortController: AbortController;
    /** Grace period for abort-ignoring detached tasks. */
    readonly drainTimeoutMs?: number;
    /** 'per-step' captures the acting actor's screenshot after each step. */
    readonly screenshots?: 'on-failure' | 'per-step' | 'off';
  },
): Promise<PlanExecutionResult> {
  const world: Record<string, unknown> = {};
  const tasks = new TaskRegistry();
  const { events, abortController } = deps;

  const contextFor = (actorId: string): StepRunContext => {
    const actor = deps.actors.get(actorId);
    if (!actor) {
      throw new KrakenError(
        'KRK-STEP-UNKNOWN-ACTOR',
        `Plan node references actor "${actorId}" but no session was booted for it.`,
      );
    }
    return { actor, world, tasks, abort: abortController.signal, actors: deps.actors };
  };

  let failure: { error: unknown; nodeId: string } | undefined;

  for (const node of plan.nodes) {
    if (failure) break;
    const startedAt = Date.now();
    events.emit({
      type: 'stepStarted',
      scenarioId: plan.scenarioId,
      stepId: node.id,
      actorId: node.actorId,
      text: node.title,
    });
    try {
      if (node.kind === 'detach') {
        const handle = node.taskHandle;
        if (!handle) {
          throw new KrakenError(
            'KRK-PLAN-UNKNOWN-TASK',
            `Detach node "${node.id}" has no task handle.`,
          );
        }
        // Spawn without awaiting; the step itself passes once the task starts.
        tasks.register(handle, () => node.run(contextFor(node.actorId)), node.title);
      } else if (node.kind === 'join') {
        const handle = node.taskHandle;
        if (!handle) {
          throw new KrakenError(
            'KRK-PLAN-UNKNOWN-TASK',
            `Join node "${node.id}" has no task handle.`,
          );
        }
        if (node.joinTimeoutMs === undefined) {
          // Explicit-duration policy (ADR-0003 D4 / ADR-0004 D6): no silent default.
          throw new KrakenError(
            'KRK-PLAN-UNKNOWN-TASK',
            `Join node "${node.id}" has no joinTimeoutMs.`,
          );
        }
        await tasks.join(handle, node.joinTimeoutMs);
      } else {
        await node.run(contextFor(node.actorId));
      }
      events.emit({
        type: 'stepFinished',
        scenarioId: plan.scenarioId,
        stepId: node.id,
        actorId: node.actorId,
        text: node.title,
        status: 'passed',
        durationMs: Date.now() - startedAt,
      });
      // A visual timeline of the run: the acting actor's screen after each
      // completed step. Best-effort AND time-bounded — a capture failure (or a
      // hung driver) must never fail or stall the step it documents.
      if (deps.screenshots === 'per-step' && node.kind === 'step') {
        try {
          const capture = deps.actors.get(node.actorId)?.session.screenshot();
          const artifact = capture
            ? await Promise.race([
                capture,
                new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 10_000)),
              ])
            : undefined;
          if (artifact) {
            events.emit({
              type: 'artifactCaptured',
              kind: artifact.kind,
              path: artifact.path,
              scenarioId: plan.scenarioId,
              actorId: node.actorId,
              stepId: node.id,
            });
          }
        } catch {
          // Screenshot capture must never fail the step it documents.
        }
      }
    } catch (error) {
      failure = { error, nodeId: node.id };
      abortController.abort();
      events.emit({
        type: 'stepFinished',
        scenarioId: plan.scenarioId,
        stepId: node.id,
        actorId: node.actorId,
        text: node.title,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: serializeError(error),
      });
    }
  }

  // Skipped steps after a failure are reported so the timeline stays complete.
  if (failure) {
    const failedIndex = plan.nodes.findIndex((node) => node.id === failure?.nodeId);
    for (const node of plan.nodes.slice(failedIndex + 1)) {
      events.emit({
        type: 'stepStarted',
        scenarioId: plan.scenarioId,
        stepId: node.id,
        actorId: node.actorId,
        text: node.title,
      });
      events.emit({
        type: 'stepFinished',
        scenarioId: plan.scenarioId,
        stepId: node.id,
        actorId: node.actorId,
        text: node.title,
        status: 'skipped',
        durationMs: 0,
      });
    }
  }

  const unsettled = await tasks.drain(deps.drainTimeoutMs ?? 5_000);
  if (!failure && unsettled.length > 0) {
    failure = {
      error: new KrakenError(
        'KRK-PLAN-UNJOINED-TASK',
        `Background task(s) did not settle after the scenario ended (abort ignored?): ${unsettled.join(', ')}.`,
        { fix: 'Detached task bodies must honor ctx.abort (AbortSignal).' },
      ),
      nodeId: 'scenario-end',
    };
    abortController.abort();
  }

  if (!failure) {
    const leaked = tasks.unjoined();
    if (leaked.length > 0) {
      const description = leaked
        .map((leak) => `"${leak.handle}" (started by ${leak.startedBy})`)
        .join(', ');
      failure = {
        error: new KrakenError(
          'KRK-PLAN-UNJOINED-TASK',
          `Scenario ended with unjoined background task(s): ${description}.`,
          {
            fix: 'Join every detached task with a "…background task {handle} completes within…" step.',
          },
        ),
        nodeId: 'scenario-end',
      };
      abortController.abort();
    }
  }

  return failure
    ? { status: 'failed', error: failure.error, failedNodeId: failure.nodeId }
    : { status: 'passed' };
}
