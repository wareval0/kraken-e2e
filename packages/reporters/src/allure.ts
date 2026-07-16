/**
 * Allure 3 reporter (ADR-0006 part B): a projection of the event stream onto
 * `allure-js-commons/sdk/reporter` (ReporterRuntime + FileSystemWriter — the
 * documented custom-integration path; live-verified 2026-07-05).
 *
 * Multi-actor model (verified to render correctly):
 * - one Allure test per scenario; the actor↔platform cast as test parameters
 * - one top-level Allure step per Kraken step, name prefixed `[actor]`, with
 *   a step Parameter {name:'actor'} (machine-readable chips in the UI)
 * - signal waits/receptions/timeouts as their own instant steps — the
 *   choreography handoffs stay visible in the report
 * - screenshots/page-source attach to the test via writeAttachment
 * - writeTest at scenarioFinished (crash-safe), timestamps propagated from
 *   Kraken events (never Date.now()).
 *
 * HTML: `npx allure generate <resultsDir> -o <report>` — Allure 3's npm CLI
 * is pure Node (no Java).
 */
import type { KrakenEvent, Reporter } from '@kraken-e2e/contracts';
import { Status } from 'allure-js-commons';
import { FileSystemWriter, ReporterRuntime } from 'allure-js-commons/sdk/reporter';

interface ScenarioState {
  readonly testUuid: string;
  /** stepId → allure step uuid (Kraken steps are sequential per scenario). */
  readonly steps: Map<string, string>;
  /** signal wait key (actorId:signal) → allure step uuid. */
  readonly waits: Map<string, string>;
}

export function createAllureReporter(resultsDir: string): Reporter {
  const runtime = new ReporterRuntime({ writer: new FileSystemWriter({ resultsDir }) });
  const scenarios = new Map<string, ScenarioState>();

  const onEvent = (event: KrakenEvent): void => {
    switch (event.type) {
      case 'scenarioStarted': {
        const testUuid = runtime.startTest(
          {
            name: event.name,
            fullName: `${event.scenarioId}: ${event.name}`,
            start: event.ts,
            parameters: event.actors.map((actor) => ({
              name: `actor:${actor.id}`,
              value: `${actor.platform} (${actor.driverId})`,
            })),
            labels: [{ name: 'framework', value: 'kraken' }],
          },
          [],
        );
        scenarios.set(event.scenarioId, { testUuid, steps: new Map(), waits: new Map() });
        return;
      }
      case 'stepStarted': {
        const scenario = scenarios.get(event.scenarioId);
        if (!scenario) return;
        const stepUuid = runtime.startStep(scenario.testUuid, null, {
          name: `[${event.actorId}] ${event.text}`,
          start: event.ts,
          parameters: [{ name: 'actor', value: event.actorId }],
        });
        if (stepUuid) scenario.steps.set(event.stepId, stepUuid);
        return;
      }
      case 'stepFinished': {
        const scenario = scenarios.get(event.scenarioId);
        const stepUuid = scenario?.steps.get(event.stepId);
        if (!scenario || !stepUuid) return;
        runtime.updateStep(stepUuid, (step) => {
          step.status =
            event.status === 'passed'
              ? Status.PASSED
              : event.status === 'skipped'
                ? Status.SKIPPED
                : Status.FAILED;
          if (event.status === 'failed' && event.error) {
            step.statusDetails = {
              message: event.error.message,
              ...(event.error.fix !== undefined ? { trace: `fix: ${event.error.fix}` } : {}),
            };
          }
        });
        runtime.stopStep(stepUuid, { stop: event.ts });
        scenario.steps.delete(event.stepId);
        return;
      }
      case 'signalWaitStarted': {
        const scenario = scenarios.get(event.scenarioId);
        if (!scenario) return;
        const uuid = runtime.startStep(scenario.testUuid, null, {
          name: `[${event.actorId}] ⏳ waits for signal "${event.signal}" (≤${event.timeoutMs}ms)`,
          start: event.ts,
          parameters: [{ name: 'actor', value: event.actorId }],
        });
        if (uuid) scenario.waits.set(`${event.actorId}:${event.signal}`, uuid);
        return;
      }
      case 'signalReceived': {
        const scenario = scenarios.get(event.scenarioId);
        const key = `${event.by}:${event.signal}`;
        const uuid = scenario?.waits.get(key);
        if (!scenario || !uuid) return;
        runtime.updateStep(uuid, (step) => {
          step.status = Status.PASSED;
          step.name = `[${event.by}] ⚡ received "${event.signal}" from ${event.from} after ${event.latencyMs}ms`;
        });
        runtime.stopStep(uuid, { stop: event.ts });
        scenario.waits.delete(key);
        return;
      }
      case 'signalTimedOut': {
        const scenario = scenarios.get(event.scenarioId);
        const key = `${event.actorId}:${event.signal}`;
        const uuid = scenario?.waits.get(key);
        if (!scenario || !uuid) return;
        runtime.updateStep(uuid, (step) => {
          step.status = Status.FAILED;
          step.statusDetails = {
            message: `signal "${event.signal}" never arrived within ${event.timeoutMs}ms`,
          };
        });
        runtime.stopStep(uuid, { stop: event.ts });
        scenario.waits.delete(key);
        return;
      }
      case 'artifactCaptured': {
        const scenario =
          event.scenarioId !== undefined ? scenarios.get(event.scenarioId) : undefined;
        if (!scenario) return;
        runtime.writeAttachment(
          scenario.testUuid,
          null,
          event.path.split('/').pop() ?? 'artifact',
          event.path,
          {
            contentType: event.kind === 'screenshot' ? 'image/png' : 'text/plain',
          },
        );
        return;
      }
      case 'scenarioFinished': {
        const scenario = scenarios.get(event.scenarioId);
        if (!scenario) return;
        scenarios.delete(event.scenarioId);
        runtime.updateTest(scenario.testUuid, (test) => {
          test.status =
            event.status === 'passed'
              ? Status.PASSED
              : event.status === 'skipped'
                ? Status.SKIPPED
                : Status.FAILED;
          test.stage = 'finished' as never;
        });
        runtime.stopTest(scenario.testUuid, { stop: event.ts });
        runtime.writeTest(scenario.testUuid);
        return;
      }
      default:
        return;
    }
  };

  return { id: 'allure', onEvent };
}
