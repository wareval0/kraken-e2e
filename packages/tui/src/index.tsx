/**
 * @kraken-e2e/tui — the Ink live terminal UI (ADR-0001 §5.11, D9). The ONLY
 * package that imports ink; it exposes a Reporter so the CLI wires it exactly
 * like any other event subscriber. patchConsole keeps stray console.* calls
 * from corrupting frames; exitOnCtrlC is OFF — the CLI owns SIGINT so
 * multi-device teardown always runs.
 */
import type { Reporter } from '@kraken-e2e/contracts';
import { render } from 'ink';

import { RunView } from './run-view.js';
import { RunViewStore } from './store.js';

export interface InkReporterHandle {
  readonly reporter: Reporter;
  /** Resolves once the UI unmounts (call after the run finishes). */
  finish(): Promise<void>;
}

export function createInkReporter(stdout: NodeJS.WriteStream = process.stdout): InkReporterHandle {
  const store = new RunViewStore();
  const instance = render(<RunView store={store} />, {
    stdout,
    patchConsole: true,
    exitOnCtrlC: false,
  });
  return {
    reporter: {
      id: 'ink',
      onEvent: (event) => store.dispatch(event),
    },
    finish: async () => {
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}

export { RunView } from './run-view.js';
export type { ActorLane, CompletedLine, RunViewState } from './store.js';
export { initialState, RunViewStore, reduce } from './store.js';
