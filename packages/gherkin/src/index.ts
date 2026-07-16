/**
 * @kraken-e2e/gherkin — the BDD front-end (ADR-0001 §5.8/§5.9, ADR-0004).
 *
 * Parses features with the OFFICIAL Gherkin stack (@cucumber/gherkin 41 →
 * pickles), matches steps with @cucumber/cucumber-expressions, and compiles
 * screenplay-ordered ScenarioPlans executed by @kraken-e2e/core. The cucumber-js
 * RUNNER is deliberately not used: its one-World/sequential model cannot
 * express Kraken's per-actor execution (ADR-0001 D3 — read §5.8 before
 * attempting to "just use cucumber-js").
 */

export {
  type ActorDeclaration,
  type CompileOptions,
  type CompileResult,
  compileFeatures,
  type Diagnostic,
  type FeatureSource,
} from './compiler.js';
export {
  ACTOR_REGEXP,
  createParameterTypeRegistry,
  DURATION_REGEXP,
  parseDuration,
} from './parameter-types.js';
export {
  createStepRegistry,
  isStepRegistry,
  type KrakenStepApi,
  registerBuiltInSteps,
  type StepDefinition,
  type StepKind,
  type StepMatch,
  type StepOptions,
  StepRegistry,
} from './registry.js';
