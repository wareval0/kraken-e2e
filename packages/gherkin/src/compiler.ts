/**
 * The scenario compiler + dry-run analyzer (ADR-0004 D2/D3): official Gherkin
 * parser → pickles → screenplay ScenarioPlan chains, with EVERY static check
 * running before any session boots. `kraken run` refuses to start on errors;
 * --dry-run stops after this pass.
 */
import {
  AstBuilder,
  compile as compilePickles,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin';
import { IdGenerator, type Pickle } from '@cucumber/messages';
import parseTagExpression from '@cucumber/tag-expressions';
import type { ResolvedActor } from '@kraken-e2e/contracts';
import type { PlanNode, ScenarioPlan, StepRunContext } from '@kraken-e2e/core';

import { levenshtein } from './levenshtein.js';
import type { StepMatch, StepRegistry } from './registry.js';

export interface FeatureSource {
  readonly uri: string;
  readonly content: string;
}

export interface ActorDeclaration {
  readonly id: string;
  readonly platform: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface Diagnostic {
  readonly severity: 'error' | 'warning';
  readonly code:
    | 'STEP_UNMATCHED'
    | 'STEP_AMBIGUOUS'
    | 'UNKNOWN_ACTOR'
    | 'DEADLOCK'
    | 'UNJOINED_TASK'
    | 'UNKNOWN_TASK'
    | 'PARSE_ERROR';
  readonly message: string;
  readonly uri: string;
  readonly scenario?: string;
}

export interface CompileResult {
  readonly plans: readonly ScenarioPlan[];
  readonly diagnostics: readonly Diagnostic[];
  get ok(): boolean;
}

export interface CompileOptions {
  readonly sources: readonly FeatureSource[];
  readonly registry: StepRegistry;
  readonly actors: readonly ActorDeclaration[];
  /** @cucumber/tag-expressions filter, e.g. '@smoke and not @wip'. */
  readonly tagFilter?: string;
}

function didYouMean(name: string, candidates: readonly string[]): string {
  const closest = [...candidates]
    .map((candidate) => ({ candidate, distance: levenshtein(name, candidate) }))
    .sort((a, b) => a.distance - b.distance)[0];
  return closest && closest.distance <= 2 ? ` Did you mean "${closest.candidate}"?` : '';
}

/** Resolves publishes metadata ('$1' → the step's 1st handler argument). */
function resolvePublishes(match: StepMatch): readonly string[] {
  return (match.definition.options.publishes ?? []).map((entry) => {
    const ref = /^\$(\d+)$/.exec(entry);
    if (!ref) return entry;
    const index = Number(ref[1]) - 1;
    return String(match.args[index] ?? '');
  });
}

export function compileFeatures(options: CompileOptions): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const plans: ScenarioPlan[] = [];
  const declaredActors = new Map(options.actors.map((actor) => [actor.id, actor]));
  const tagFilter = options.tagFilter ? parseTagExpression(options.tagFilter) : undefined;

  for (const source of options.sources) {
    const newId = IdGenerator.incrementing();
    let pickles: readonly Pickle[];
    try {
      const parser = new Parser(new AstBuilder(newId), new GherkinClassicTokenMatcher());
      const document = parser.parse(source.content);
      pickles = compilePickles(document, source.uri, newId);
    } catch (cause) {
      diagnostics.push({
        severity: 'error',
        code: 'PARSE_ERROR',
        message: cause instanceof Error ? cause.message : String(cause),
        uri: source.uri,
      });
      continue;
    }

    let occurrence = 0;
    for (const pickle of pickles) {
      occurrence += 1;
      if (tagFilter && !tagFilter.evaluate(pickle.tags.map((tag) => tag.name))) continue;
      const plan = compilePickle(
        pickle,
        source.uri,
        occurrence,
        options,
        declaredActors,
        diagnostics,
      );
      if (plan) plans.push(plan);
    }
  }

  return {
    plans,
    diagnostics,
    get ok() {
      return diagnostics.every((diagnostic) => diagnostic.severity !== 'error');
    },
  };
}

function compilePickle(
  pickle: Pickle,
  uri: string,
  occurrence: number,
  options: CompileOptions,
  declaredActors: ReadonlyMap<string, ActorDeclaration>,
  diagnostics: Diagnostic[],
): ScenarioPlan | undefined {
  const nodes: PlanNode[] = [];
  const referencedActors = new Set<string>();
  /** Static choreography facts for the analyzer. */
  const facts: {
    kind: string;
    publishes: readonly string[];
    waitsFor?: string;
    detachHandle?: string;
    joinHandle?: string;
  }[] = [];
  let broken = false;

  pickle.steps.forEach((step, index) => {
    let match: StepMatch | undefined;
    try {
      match = options.registry.match(step.text);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'STEP_AMBIGUOUS',
        message: error instanceof Error ? error.message : String(error),
        uri,
        scenario: pickle.name,
      });
      broken = true;
      return;
    }
    if (!match) {
      const closest = [...options.registry.definitions]
        .map((definition) => ({
          source: definition.expressionSource,
          distance: levenshtein(step.text, definition.expressionSource),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      diagnostics.push({
        severity: 'error',
        code: 'STEP_UNMATCHED',
        message:
          `No step definition matches "${step.text}".` +
          (closest ? ` Closest expression: "${closest.source}".` : '') +
          ` ${options.registry.definitions.length} definitions are registered.`,
        uri,
        scenario: pickle.name,
      });
      broken = true;
      return;
    }

    if (!declaredActors.has(match.actorName)) {
      diagnostics.push({
        severity: 'error',
        code: 'UNKNOWN_ACTOR',
        message:
          `Step "${step.text}" is addressed to undeclared actor "${match.actorName}".` +
          didYouMean(match.actorName, [...declaredActors.keys()]) +
          ` Declared actors: ${[...declaredActors.keys()].join(', ')}.`,
        uri,
        scenario: pickle.name,
      });
      broken = true;
      return;
    }
    referencedActors.add(match.actorName);

    const { definition, args, actorName } = match;
    const previous = nodes.at(-1);
    const base = {
      // Run-unique (pickle ids reset per feature file): future TUI/GUI key by stepId.
      id: `${uri}#${occurrence}-step-${index + 1}`,
      actorId: actorName,
      title: step.text,
      dependsOn: previous ? [previous.id] : [],
    };

    if (definition.kind === 'detach') {
      // The LAST STRING argument is the handle (documented convention) —
      // a trailing {duration}/{int} must not shadow it.
      const handle = [...args].reverse().find((arg): arg is string => typeof arg === 'string');
      if (handle === undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'UNKNOWN_TASK',
          message: `Detached step "${step.text}" has no string argument to use as its task handle.`,
          uri,
          scenario: pickle.name,
        });
        broken = true;
        return;
      }
      nodes.push({
        ...base,
        kind: 'detach',
        taskHandle: handle,
        run: (ctx: StepRunContext) => definition.handler(ctx, ...(args as never[])),
      });
      facts.push({ kind: 'detach', publishes: resolvePublishes(match), detachHandle: handle });
    } else if (definition.kind === 'join') {
      const handle = String(args[0] ?? '');
      const timeoutMs = Number(args[1] ?? 30_000);
      nodes.push({
        ...base,
        kind: 'join',
        taskHandle: handle,
        joinTimeoutMs: timeoutMs,
        run: async () => {},
      });
      facts.push({ kind: 'join', publishes: [], joinHandle: handle });
    } else {
      nodes.push({
        ...base,
        kind: 'step',
        run: (ctx: StepRunContext) => definition.handler(ctx, ...(args as never[])),
      });
      facts.push({
        kind: definition.kind,
        publishes: resolvePublishes(match),
        ...(definition.kind === 'wait-signal' ? { waitsFor: String(args[0] ?? '') } : {}),
      });
    }
  });

  if (broken) return undefined;

  // ── Static analysis (the dry-run analyzer — ADR-0004 D3) ──
  const detached = new Set<string>();
  for (const [index, fact] of facts.entries()) {
    if (fact.detachHandle) {
      if (detached.has(fact.detachHandle)) {
        diagnostics.push({
          severity: 'error',
          code: 'UNKNOWN_TASK',
          message: `"${nodes[index]?.title}" reuses background-task handle "${fact.detachHandle}" — handles must be unique within a scenario.`,
          uri,
          scenario: pickle.name,
        });
      }
      detached.add(fact.detachHandle);
    }
    if (fact.joinHandle && !detached.has(fact.joinHandle)) {
      diagnostics.push({
        severity: 'error',
        code: 'UNKNOWN_TASK',
        message: `"${nodes[index]?.title}" joins background task "${fact.joinHandle}" but no earlier step started it.`,
        uri,
        scenario: pickle.name,
      });
    }
    if (fact.waitsFor !== undefined) {
      // Under total order, a main-cursor wait with no earlier declared producer
      // is a GUARANTEED deadlock — rejected statically (ADR-0001 §5.9).
      const producers = facts
        .slice(0, index)
        .some((earlier) => earlier.publishes.includes(fact.waitsFor as string));
      if (!producers) {
        diagnostics.push({
          severity: 'error',
          code: 'DEADLOCK',
          message:
            `"${nodes[index]?.title}" waits for signal "${fact.waitsFor}", but no earlier step ` +
            `or background task declares publishing it (via the publishes: option). Under ` +
            `screenplay order this wait can never be satisfied.`,
          uri,
          scenario: pickle.name,
        });
      }
    }
  }
  const joined = new Set(facts.flatMap((fact) => (fact.joinHandle ? [fact.joinHandle] : [])));
  for (const handle of detached) {
    if (!joined.has(handle)) {
      diagnostics.push({
        severity: 'error',
        code: 'UNJOINED_TASK',
        message:
          `Background task "${handle}" is started but never joined. Every detached task must be ` +
          `joined before the scenario ends (leak detection — ADR-0001 §5.9).`,
        uri,
        scenario: pickle.name,
      });
    }
  }

  const hasErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error' && diagnostic.scenario === pickle.name,
  );
  if (hasErrors) return undefined;

  const actors: ResolvedActor[] = [...referencedActors].map((id) => {
    const declaration = declaredActors.get(id) as ActorDeclaration;
    return {
      id,
      platform: declaration.platform,
      config: declaration.config ?? {},
      ...(declaration.data !== undefined ? { data: declaration.data } : {}),
    };
  });

  return {
    scenarioId: `${uri}#${occurrence}`,
    name: pickle.name,
    featureUri: uri,
    actors,
    nodes,
  };
}
