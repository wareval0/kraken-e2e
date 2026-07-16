import type { KrakenEvent } from '@kraken-e2e/contracts';

/**
 * The TUI's view model: a pure reducer over the KrakenEvent stream plus a
 * minimal external store (useSyncExternalStore-compatible). Everything the
 * live view renders is derivable from events alone (ADR-0001 §5.12 — the
 * same property the future GUI relies on).
 */
export interface ActorLane {
  readonly id: string;
  readonly platform: string;
  readonly driverId: string;
  readonly state: 'starting' | 'ready' | 'acting' | 'waiting-signal' | 'done' | 'failed';
  readonly detail: string;
}

export interface CompletedLine {
  readonly key: string;
  readonly text: string;
}

export interface RunViewState {
  readonly scenarioName: string | undefined;
  readonly lanes: readonly ActorLane[];
  readonly completed: readonly CompletedLine[];
  readonly runStatus: 'running' | 'passed' | 'failed';
  readonly summary: string | undefined;
}

export const initialState: RunViewState = {
  scenarioName: undefined,
  lanes: [],
  completed: [],
  runStatus: 'running',
  summary: undefined,
};

const MARKS = { passed: '✓', failed: '✗', skipped: '–' } as const;

function updateLane(
  lanes: readonly ActorLane[],
  actorId: string,
  patch: Partial<ActorLane>,
): readonly ActorLane[] {
  return lanes.map((lane) => (lane.id === actorId ? { ...lane, ...patch } : lane));
}

export function reduce(state: RunViewState, event: KrakenEvent): RunViewState {
  switch (event.type) {
    case 'scenarioStarted':
      return {
        ...state,
        scenarioName: event.name,
        lanes: event.actors.map((actor) => ({
          id: actor.id,
          platform: actor.platform,
          driverId: actor.driverId,
          state: 'starting',
          detail: 'booting session…',
        })),
      };
    case 'actorSessionStarted':
      return {
        ...state,
        lanes: updateLane(state.lanes, event.actorId, {
          state: 'ready',
          detail: event.platformLabel,
        }),
      };
    case 'stepStarted':
      return {
        ...state,
        lanes: updateLane(state.lanes, event.actorId, { state: 'acting', detail: event.text }),
      };
    case 'stepFinished':
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            key: `${event.scenarioId}:${event.stepId}`,
            text: `${MARKS[event.status]} [${event.actorId}] ${event.text}${
              event.status === 'skipped' ? '' : ` (${event.durationMs}ms)`
            }`,
          },
        ],
        lanes: updateLane(state.lanes, event.actorId, {
          state: event.status === 'failed' ? 'failed' : 'ready',
          detail: event.status === 'failed' ? `✗ ${event.text}` : 'idle',
        }),
      };
    // The product's signature moment (ADR-0001 §5.11): render waits explicitly.
    case 'signalWaitStarted':
      return {
        ...state,
        lanes: updateLane(state.lanes, event.actorId, {
          state: 'waiting-signal',
          detail: `⏳ waiting for signal "${event.signal}" (≤${event.timeoutMs}ms)`,
        }),
      };
    case 'signalReceived':
      return {
        ...state,
        lanes: updateLane(state.lanes, event.by, {
          state: 'acting',
          detail: `⚡ "${event.signal}" from ${event.from} after ${event.latencyMs}ms`,
        }),
      };
    case 'signalTimedOut':
      return {
        ...state,
        lanes: updateLane(state.lanes, event.actorId, {
          state: 'failed',
          detail: `✗ signal "${event.signal}" never arrived (${event.timeoutMs}ms)`,
        }),
      };
    case 'scenarioFinished':
      return {
        ...state,
        lanes: state.lanes.map((lane) =>
          lane.state === 'failed' ? lane : { ...lane, state: 'done', detail: 'session closing…' },
        ),
        completed: [
          ...state.completed,
          {
            key: `${event.scenarioId}:end`,
            text: `${MARKS[event.status]} scenario "${state.scenarioName ?? event.scenarioId}" ${event.status} in ${event.durationMs}ms`,
          },
        ],
      };
    case 'runFinished':
      return {
        ...state,
        runStatus: event.status,
        summary: `Run ${event.status} in ${event.durationMs}ms`,
      };
    case 'driverDisabled':
      return {
        ...state,
        completed: [
          ...state.completed,
          {
            key: `driver:${event.driverId}`,
            text: `! driver "${event.driverId}" disabled: ${event.reason}`,
          },
        ],
      };
    default:
      return state;
  }
}

export class RunViewStore {
  #state: RunViewState = initialState;
  readonly #listeners = new Set<() => void>();

  readonly getSnapshot = (): RunViewState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  dispatch(event: KrakenEvent): void {
    this.#state = reduce(this.#state, event);
    for (const listener of this.#listeners) listener();
  }
}
