import type { ResolvedActor } from '@kraken-e2e/contracts';
import { KrakenError } from '@kraken-e2e/contracts';

import type { PlanNode, ScenarioPlan, StepRunContext } from './scheduler.js';

/**
 * The programmatic scenario API (ADR-0001 §7 Phase 1): a plan builder
 * mirroring the DSL's screenplay semantics — same orchestrator, no Gherkin.
 *
 *   const plan = scenario('direct message')
 *     .step('alice', 'opens the conversation', async ({ actor }) => { ... })
 *     .step('bob', 'sees the message', async ({ actor }) => { ... })
 *     .build({ actors });
 */
export function scenario(name: string): ScenarioBuilder {
  return new ScenarioBuilder(name);
}

export class ScenarioBuilder {
  readonly #name: string;
  readonly #nodes: PlanNode[] = [];
  #counter = 0;

  constructor(name: string) {
    this.#name = name;
  }

  #nextId(): string {
    this.#counter += 1;
    return `node-${this.#counter}`;
  }

  #chainDependency(): readonly string[] {
    const last = this.#nodes.at(-1);
    return last ? [last.id] : [];
  }

  step(actorId: string, title: string, run: (ctx: StepRunContext) => Promise<void>): this {
    this.#nodes.push({
      id: this.#nextId(),
      actorId,
      kind: 'step',
      title,
      dependsOn: this.#chainDependency(),
      run,
    });
    return this;
  }

  /** Starts a named background task; MUST be joined before the scenario ends. */
  detach(
    actorId: string,
    title: string,
    handle: string,
    run: (ctx: StepRunContext) => Promise<void>,
  ): this {
    this.#nodes.push({
      id: this.#nextId(),
      actorId,
      kind: 'detach',
      title,
      dependsOn: this.#chainDependency(),
      taskHandle: handle,
      run,
    });
    return this;
  }

  join(actorId: string, title: string, handle: string, timeoutMs: number): this {
    this.#nodes.push({
      id: this.#nextId(),
      actorId,
      kind: 'join',
      title,
      dependsOn: this.#chainDependency(),
      taskHandle: handle,
      joinTimeoutMs: timeoutMs,
      run: async () => {},
    });
    return this;
  }

  build(options: { actors: readonly ResolvedActor[]; scenarioId?: string }): ScenarioPlan {
    const declared = new Set(options.actors.map((actor) => actor.id));
    for (const node of this.#nodes) {
      if (!declared.has(node.actorId)) {
        const known = [...declared].join(', ');
        throw new KrakenError(
          'KRK-STEP-UNKNOWN-ACTOR',
          `Step "${node.title}" is addressed to undeclared actor "${node.actorId}". Declared actors: ${known}.`,
          { fix: 'Declare the actor in the actors list, or fix the actor name in the step.' },
        );
      }
    }
    return {
      scenarioId: options.scenarioId ?? `scenario-${cryptoRandomId()}`,
      name: this.#name,
      actors: options.actors,
      nodes: this.#nodes,
    };
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
