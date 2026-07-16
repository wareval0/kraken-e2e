import {
  CucumberExpression,
  ParameterType,
  type ParameterTypeRegistry,
} from '@cucumber/cucumber-expressions';
import { KrakenError } from '@kraken-e2e/contracts';
import type { StepRunContext } from '@kraken-e2e/core';

import { createParameterTypeRegistry } from './parameter-types.js';

/** How a matched definition behaves in the compiled plan (ADR-0004 D2/D4). */
export type StepKind = 'step' | 'detach' | 'join' | 'wait-signal';

export interface StepOptions {
  /**
   * Signal names this step's handler publishes — the dry-run analyzer's
   * reachability facts (ADR-0004 D3). '$N' references the Nth handler
   * argument (1-based, actor excluded), e.g. publishes: ['$1'].
   */
  readonly publishes?: readonly string[];
  /**
   * The step starts a background task: its handler runs detached and MUST be
   * joined before the scenario ends. The LAST string argument is the task
   * handle (documented convention — ADR-0004 D4).
   */
  readonly detached?: boolean;
  /** Documentation marker: this Then-step is a polling assertion. */
  readonly polls?: boolean;
}

export interface StepDefinition {
  readonly expressionSource: string;
  readonly expression: CucumberExpression;
  readonly options: StepOptions;
  readonly kind: StepKind;
  readonly handler: (ctx: StepRunContext, ...args: never[]) => Promise<void>;
  /** Ordinal of the FIRST {actor} parameter among all parameters (the addressee). */
  readonly actorParameterIndex: number;
}

export interface StepMatch {
  readonly definition: StepDefinition;
  /** The addressed actor's name, unquoted. */
  readonly actorName: string;
  /** Handler arguments (actor excluded), transformed by their parameter types. */
  readonly args: readonly unknown[];
}

/** Ordered parameter names in an expression source ('{actor} sees {string}'). */
function parameterNames(source: string): string[] {
  return [...source.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '');
}

type StepFn = (
  expression: string,
  optionsOrHandler: StepOptions | ((ctx: StepRunContext, ...args: never[]) => Promise<void>),
  maybeHandler?: (ctx: StepRunContext, ...args: never[]) => Promise<void>,
) => void;

export interface KrakenStepApi {
  readonly Given: StepFn;
  readonly When: StepFn;
  readonly Then: StepFn;
  readonly defineParameterType: (options: {
    name: string;
    regexp: RegExp;
    transformer?: (...groups: string[]) => unknown;
  }) => void;
  readonly registry: StepRegistry;
}

/** Survives duplicate copies of this package in one process (jiti + node_modules). */
export const STEP_REGISTRY_BRAND: unique symbol = Symbol.for('kraken.stepRegistry/v1') as never;

export function isStepRegistry(value: unknown): value is StepRegistry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[STEP_REGISTRY_BRAND] === true
  );
}

export class StepRegistry {
  readonly [STEP_REGISTRY_BRAND] = true as const;
  readonly #definitions: StepDefinition[] = [];
  readonly #parameterTypes: ParameterTypeRegistry;

  constructor() {
    this.#parameterTypes = createParameterTypeRegistry();
  }

  define(
    expressionSource: string,
    options: StepOptions,
    handler: (ctx: StepRunContext, ...args: never[]) => Promise<void>,
    kind: StepKind = 'step',
  ): void {
    const names = parameterNames(expressionSource);
    const actorParameterIndex = names.indexOf('actor');
    if (actorParameterIndex === -1) {
      throw new KrakenError(
        'KRK-STEP-UNKNOWN-ACTOR',
        `Step "${expressionSource}" has no {actor} parameter. Every Kraken step is addressed ` +
          'to exactly one actor (ADR-0004 D1).',
        { fix: "Start the expression with '{actor} …'." },
      );
    }
    const expression = new CucumberExpression(expressionSource, this.#parameterTypes);
    this.#definitions.push({
      expressionSource,
      expression,
      options,
      kind,
      handler,
      actorParameterIndex,
    });
  }

  defineParameterType(options: {
    name: string;
    regexp: RegExp;
    transformer?: (...groups: string[]) => unknown;
  }): void {
    this.#parameterTypes.defineParameterType(
      new ParameterType(
        options.name,
        options.regexp,
        null,
        options.transformer ?? ((value: string) => value),
        false,
        false,
      ),
    );
  }

  get definitions(): readonly StepDefinition[] {
    return this.#definitions;
  }

  /**
   * Matches a pickle step's text. Zero matches → undefined (the compiler turns
   * it into a STEP_UNMATCHED diagnostic); more than one → STEP_AMBIGUOUS error.
   */
  match(text: string): StepMatch | undefined {
    const matches: StepMatch[] = [];
    for (const definition of this.#definitions) {
      const matched = definition.expression.match(text);
      if (!matched) continue;
      const values = matched.map((argument) => argument.getValue(null));
      const actorName = String(values[definition.actorParameterIndex]);
      const args = values.filter((_, index) => index !== definition.actorParameterIndex);
      matches.push({ definition, actorName, args });
    }
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      throw new KrakenError(
        'KRK-STEP-AMBIGUOUS',
        `Step "${text}" matches ${matches.length} definitions: ` +
          matches.map((match) => `"${match.definition.expressionSource}"`).join(', '),
        { fix: 'Make the step expressions mutually exclusive.' },
      );
    }
    return matches[0];
  }
}

/**
 * The step-authoring API (ADR-0004 D1). Instance-based — no import-order
 * magic; destructure so call sites are bare identifiers, which is exactly what
 * the Cucumber VS Code extension's tree-sitter queries recognize (appendix B):
 *
 *   export const { Given, When, Then } = createStepRegistry();
 */
export function createStepRegistry(): KrakenStepApi {
  const registry = new StepRegistry();
  registerBuiltInSteps(registry);
  const makeKeyword =
    (): StepFn =>
    (expression, optionsOrHandler, maybeHandler): void => {
      const options = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler;
      if (!handler) {
        throw new KrakenError('KRK-STEP-UNMATCHED', `Step "${expression}" has no handler.`);
      }
      registry.define(expression, options, handler, options.detached ? 'detach' : 'step');
    };
  return {
    Given: makeKeyword(),
    When: makeKeyword(),
    Then: makeKeyword(),
    defineParameterType: (options) => registry.defineParameterType(options),
    registry,
  };
}

/**
 * Built-in choreography vocabulary (ADR-0004 D4) — deliberately minimal:
 * signal waiting (v2 continuity) and background-task joining. App-domain
 * steps belong to the USER's project, never here.
 */
export function registerBuiltInSteps(registry: StepRegistry): void {
  registry.define(
    '{actor} waits for the signal {string} within {duration}',
    {},
    async (ctx, ...args: never[]) => {
      const [name, timeoutMs] = args as unknown as [string, number];
      await ctx.actor.signals.waitFor(name, { timeoutMs });
    },
    'wait-signal',
  );
  registry.define(
    '{actor} waits for the signal {string} from {actor} within {duration}',
    {},
    async (ctx, ...args: never[]) => {
      const [name, from, timeoutMs] = args as unknown as [string, string, number];
      await ctx.actor.signals.waitFor(name, { timeoutMs, from });
    },
    'wait-signal',
  );
  registry.define(
    "{actor}'s background task {string} completes within {duration}",
    {},
    async () => {
      // The scheduler performs the join (compiler emits a 'join' node);
      // this handler never runs.
    },
    'join',
  );
}
