import { Box, Static, Text } from 'ink';
import { useSyncExternalStore } from 'react';

import type { ActorLane, RunViewStore } from './store.js';

const LANE_ICONS: Record<ActorLane['state'], string> = {
  starting: '◌',
  ready: '●',
  acting: '▶',
  'waiting-signal': '⏳',
  done: '✓',
  failed: '✗',
};

const LANE_COLORS: Record<ActorLane['state'], string> = {
  starting: 'gray',
  ready: 'green',
  acting: 'cyan',
  'waiting-signal': 'yellow',
  done: 'green',
  failed: 'red',
};

/**
 * The live multi-actor view (ADR-0001 §5.11): one lane per actor with its
 * platform, current step, and signal state; completed steps flow into
 * <Static> (Ink's sanctioned append-only region).
 */
export function RunView({ store }: { readonly store: RunViewStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return (
    <Box flexDirection="column">
      <Static items={state.completed as import('./store.js').CompletedLine[]}>
        {(line) => <Text key={line.key}>{line.text}</Text>}
      </Static>
      {state.scenarioName !== undefined && state.runStatus === 'running' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Scenario: {state.scenarioName}</Text>
          {state.lanes.map((lane) => (
            <Box key={lane.id} paddingLeft={2}>
              <Text color={LANE_COLORS[lane.state]}>
                {LANE_ICONS[lane.state]} {lane.id}
              </Text>
              <Text dimColor> [{lane.platform}] </Text>
              <Text>{lane.detail}</Text>
            </Box>
          ))}
        </Box>
      ) : null}
      {state.summary !== undefined ? (
        <Text bold color={state.runStatus === 'passed' ? 'green' : 'red'}>
          {state.summary}
        </Text>
      ) : null}
    </Box>
  );
}
