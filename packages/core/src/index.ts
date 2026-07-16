/**
 * @kraken-e2e/core — orchestrator (ADR-0001 §5.3, ADR-0002).
 *
 * Session manager, DAG step scheduler, plugin registry, host detection, and
 * the event bus. Knows NOTHING about Appium/WDIO/ADB/browsers (constraint C2):
 * platform knowledge arrives exclusively through @kraken-e2e/contracts drivers.
 *
 * Subpaths: `@kraken-e2e/core/ctk` (driver Conformance Test Kit) and
 * `@kraken-e2e/core/testing` (FakeDriver + FakeAppWorld).
 */

export { EventBus, type EventSink } from './event-bus.js';
export { krakenEventJsonSchema } from './event-schemas.js';
export { createHostContext, systemHostProbe } from './host.js';
export { createLogger, type LogLevel, type LogLine, silentLogger } from './logger.js';
export { type DriverRegistration, DriverRegistry, type DriverStatus } from './registry.js';
export {
  type RunnerDependencies,
  type RunOptions,
  type RunResult,
  runScenarios,
  type ScenarioResult,
  ScenarioRunner,
  SESSION_DISPOSE_TIMEOUT_MS,
} from './runner.js';
export { ScenarioBuilder, scenario } from './scenario.js';
export {
  type ActorRuntime,
  executePlan,
  type PlanExecutionResult,
  type PlanNode,
  type PlanNodeKind,
  type ScenarioPlan,
  type StepRunContext,
  TaskRegistry,
} from './scheduler.js';
