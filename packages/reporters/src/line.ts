import type { KrakenEvent, Reporter } from '@kraken-e2e/contracts';

/**
 * The plain streaming renderer (ADR-0001 §5.11): actor-prefixed lines for
 * non-TTY/CI use — deliberately NOT Ink's final-frame CI mode, because a
 * multi-device run must stream progress. Zero Ink dependency by design.
 * The writer is injected: the CLI passes its stdout writer; tests pass arrays.
 */
export function createLineReporter(write: (line: string) => void): Reporter {
  const MARKS = { passed: '✓', failed: '✗', skipped: '–' } as const;
  return {
    id: 'line',
    onEvent(event: KrakenEvent): void {
      switch (event.type) {
        case 'runStarted':
          write(
            `Kraken run started (${event.scenarioCount} scenario${event.scenarioCount === 1 ? '' : 's'})`,
          );
          break;
        case 'scenarioStarted':
          write(
            `\nScenario: ${event.name}  [${event.actors
              .map((actor) => `${actor.id}/${actor.platform}`)
              .join(', ')}]`,
          );
          break;
        case 'stepFinished': {
          const mark = MARKS[event.status];
          const duration = event.status === 'skipped' ? '' : ` (${event.durationMs}ms)`;
          const error = event.error ? `\n      ${event.error.code}: ${event.error.message}` : '';
          write(`  ${mark} [${event.actorId}] ${event.text}${duration}${error}`);
          break;
        }
        case 'signalWaitStarted':
          write(
            `    [${event.actorId}] ⏳ waiting for signal "${event.signal}" (≤${event.timeoutMs}ms)`,
          );
          break;
        case 'signalReceived':
          write(
            `    [${event.by}] ⚡ received "${event.signal}" from ${event.from} after ${event.latencyMs}ms`,
          );
          break;
        case 'signalTimedOut':
          write(
            `    [${event.actorId}] ✗ signal "${event.signal}" never arrived (${event.timeoutMs}ms)`,
          );
          break;
        case 'driverDisabled':
          write(`! driver "${event.driverId}" disabled: ${event.reason}\n  fix: ${event.fix}`);
          break;
        case 'artifactCaptured':
          write(`    ↳ ${event.kind}${event.actorId ? ` [${event.actorId}]` : ''}: ${event.path}`);
          break;
        case 'scenarioFinished': {
          const mark = MARKS[event.status];
          const error =
            event.error && event.status === 'failed'
              ? `\n  ${event.error.code}: ${event.error.message}${event.error.fix ? `\n  fix: ${event.error.fix}` : ''}`
              : '';
          write(`  ${mark} scenario ${event.status} in ${event.durationMs}ms${error}`);
          break;
        }
        case 'runFinished':
          write(`\nRun ${event.status} in ${event.durationMs}ms`);
          break;
        default:
          break; // quieter events (stepStarted, sessions, logs) stay off the line view
      }
    },
  };
}
