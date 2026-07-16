import { KrakenError } from '@kraken-e2e/contracts';
import { describe, expect, it } from 'vitest';

import { scenario } from '../src/scenario.ts';

const ACTORS = [
  { id: 'alice', platform: 'fake', config: {} },
  { id: 'bob', platform: 'fake', config: {} },
];

describe('scenario() programmatic builder', () => {
  it('builds a chained plan with detach/join node kinds and metadata', () => {
    const plan = scenario('with background work')
      .step('alice', 'does something', async () => {})
      .detach('bob', 'starts recording', 'rec', async () => {})
      .step('alice', 'keeps going', async () => {})
      .join('bob', 'recording finishes', 'rec', 5_000)
      .build({ actors: ACTORS, scenarioId: 's-1' });

    expect(plan.nodes.map((node) => node.kind)).toEqual(['step', 'detach', 'step', 'join']);
    expect(plan.nodes[1]?.taskHandle).toBe('rec');
    expect(plan.nodes[3]?.joinTimeoutMs).toBe(5_000);
    // Chain: every node depends on its predecessor.
    for (let i = 1; i < plan.nodes.length; i += 1) {
      expect(plan.nodes[i]?.dependsOn).toEqual([plan.nodes[i - 1]?.id]);
    }
    expect(plan.scenarioId).toBe('s-1');
  });

  it('generates a scenarioId when none is given', () => {
    const plan = scenario('x')
      .step('alice', 't', async () => {})
      .build({ actors: ACTORS });
    expect(plan.scenarioId).toMatch(/^scenario-/);
  });

  it('rejects steps addressed to undeclared actors at build time', () => {
    const builder = scenario('typo').step('alicia', 'ghost step', async () => {});
    try {
      builder.build({ actors: ACTORS });
      expect.unreachable('build must throw');
    } catch (error) {
      expect(KrakenError.is(error) && error.code).toBe('KRK-STEP-UNKNOWN-ACTOR');
      expect(KrakenError.is(error) && error.message).toContain('alicia');
    }
  });
});
