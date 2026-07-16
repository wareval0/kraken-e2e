import { describe, expect, it } from 'vitest';

import { compileFeatures, type Diagnostic } from '../src/compiler.ts';
import { createStepRegistry } from '../src/registry.ts';

const ACTORS = [
  { id: 'alice', platform: 'fake' },
  { id: 'bob', platform: 'fake' },
];

function registryWithVocabulary() {
  const api = createStepRegistry();
  api.When('{actor} sends the message {string}', { publishes: ['message-sent'] }, async () => {});
  api.Then('{actor} sees the message {string}', async () => {});
  api.When('{actor} announces {string}', { publishes: ['$1'] }, async () => {});
  api.When('{actor} starts uploading {string} as {string}', { detached: true }, async () => {});
  api.When('{actor} does something silent', async () => {});
  return api.registry;
}

const feature = (body: string) => [{ uri: 'test.feature', content: body }];

function errors(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code}: ${d.message}`);
}

describe('compileFeatures — happy path', () => {
  it('compiles a choreography into a screenplay chain with only referenced actors', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Messaging
  Scenario: message arrives
    When alice sends the message "hola"
    Then bob sees the message "hola"
`),
      registry: registryWithVocabulary(),
      actors: [...ACTORS, { id: 'carol', platform: 'fake' }],
    });
    expect(result.ok).toBe(true);
    expect(result.plans).toHaveLength(1);
    const plan = result.plans[0];
    expect(plan?.nodes.map((n) => n.actorId)).toEqual(['alice', 'bob']);
    // Chain: each node depends on the previous one (screenplay total order).
    expect(plan?.nodes[1]?.dependsOn).toEqual([plan?.nodes[0]?.id]);
    // carol is declared but unreferenced — her session must NOT boot.
    expect(plan?.actors.map((a) => a.id).sort()).toEqual(['alice', 'bob']);
  });

  it('prepends Background steps to every scenario (pickles semantics)', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: With background
  Background:
    Given alice does something silent
  Scenario: one
    Then bob sees the message "x"
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(true);
    expect(result.plans[0]?.nodes.map((n) => n.actorId)).toEqual(['alice', 'bob']);
  });

  it('filters scenarios by tag expression', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Tagged
  @smoke
  Scenario: in
    When alice does something silent
  @wip
  Scenario: out
    When alice does something silent
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
      tagFilter: '@smoke and not @wip',
    });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.name).toBe('in');
  });

  it('expands Scenario Outline examples into independent plans', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Outline
  Scenario Outline: send <what>
    When alice sends the message "<what>"
    Then bob sees the message "<what>"
    Examples:
      | what  |
      | hola  |
      | salut |
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.plans).toHaveLength(2);
    expect(result.plans.map((p) => p.scenarioId)).toEqual(['test.feature#1', 'test.feature#2']);
  });
});

describe('compileFeatures — the dry-run analyzer (ADR-0004 D3)', () => {
  it('unknown actor → error with did-you-mean', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Typo
  Scenario: ghost actor
    When alicia sends the message "hola"
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('undeclared actor "alicia"');
    expect(errors(result.diagnostics)[0]).toContain('Did you mean "alice"?');
  });

  it('unmatched step → error naming the text', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Missing
  Scenario: nobody wrote this step
    When alice does a triple backflip
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('No step definition matches');
  });

  it('signal wait with no declared producer → static DEADLOCK error', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Deadlock
  Scenario: waits forever
    Then bob waits for the signal "never-sent" within 10s
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('DEADLOCK');
    expect(errors(result.diagnostics)[0]).toContain('never-sent');
  });

  it('signal wait WITH a declared producer (static or $1-resolved) passes', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Reachable
  Scenario: static publisher
    When alice sends the message "hola"
    Then bob waits for the signal "message-sent" within 10s
  Scenario: dollar-resolved publisher
    When alice announces "custom-signal"
    Then bob waits for the signal "custom-signal" within 10s
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(true);
    expect(result.plans).toHaveLength(2);
  });

  it('producer AFTER the wait is still a deadlock (screenplay order)', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Order matters
  Scenario: too late
    Then bob waits for the signal "message-sent" within 10s
    When alice sends the message "hola"
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('DEADLOCK');
  });

  it('unjoined detached task → static error', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Leak
  Scenario: forgets the join
    When alice starts uploading "demo.mp4" as "upload"
    Then bob sees the message "x"
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('never joined');
  });

  it('join without a detach → static error; detach+join compiles to the right node kinds', () => {
    const registry = registryWithVocabulary();
    const bad = compileFeatures({
      sources: feature(`
Feature: Ghost join
  Scenario: joins nothing
    Then alice's background task "ghost" completes within 30s
`),
      registry,
      actors: ACTORS,
    });
    expect(errors(bad.diagnostics)[0]).toContain('no earlier step started it');

    const good = compileFeatures({
      sources: feature(`
Feature: Proper detach
  Scenario: detaches and joins
    When alice starts uploading "demo.mp4" as "upload"
    Then bob sees the message "x"
    Then alice's background task "upload" completes within 2m
`),
      registry,
      actors: ACTORS,
    });
    expect(good.ok).toBe(true);
    expect(good.plans[0]?.nodes.map((n) => n.kind)).toEqual(['detach', 'step', 'join']);
    expect(good.plans[0]?.nodes[2]?.joinTimeoutMs).toBe(120_000);
  });

  it('a broken scenario never yields a plan, but healthy siblings still compile', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Mixed
  Scenario: broken
    When ghost sends the message "x"
  Scenario: healthy
    When alice does something silent
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.name).toBe('healthy');
  });

  it('a Gherkin syntax error is a PARSE_ERROR diagnostic, not a crash', () => {
    const result = compileFeatures({
      sources: [
        {
          uri: 'broken.feature',
          content:
            'Feature: X\n  Scenario: y\n@tag-on-step\n    When alice does something silent\n',
        },
      ],
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('PARSE_ERROR');
  });
});

describe('regression: verification-driven compiler hardening', () => {
  it('STEP_UNMATCHED suggests the closest registered expression', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Typo in step
  Scenario: close but wrong
    When alice sends the mesage "hola"
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(errors(result.diagnostics)[0]).toContain(
      'Closest expression: "{actor} sends the message {string}"',
    );
  });

  it('the task handle is the last STRING argument (a trailing duration must not shadow it)', () => {
    const api = createStepRegistry();
    api.When(
      '{actor} starts syncing {string} for up to {duration}',
      { detached: true },
      async () => {},
    );
    const result = compileFeatures({
      sources: feature(`
Feature: Trailing duration
  Scenario: sync
    When alice starts syncing "photos" for up to 5s
    Then alice's background task "photos" completes within 10s
`),
      registry: api.registry,
      actors: ACTORS,
    });
    expect(result.ok).toBe(true);
    expect(result.plans[0]?.nodes[0]?.taskHandle).toBe('photos');
  });

  it('a detached step with NO string argument is a compile error, not a silent bad handle', () => {
    const api = createStepRegistry();
    api.When('{actor} starts syncing for up to {duration}', { detached: true }, async () => {});
    const result = compileFeatures({
      sources: feature(`
Feature: No handle
  Scenario: sync
    When alice starts syncing for up to 5s
`),
      registry: api.registry,
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('no string argument');
  });

  it('duplicate detach handles are a static compile error', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Duplicate handles
  Scenario: two uploads, one name
    When alice starts uploading "a.mp4" as "upload"
    When alice starts uploading "b.mp4" as "upload"
    Then alice's background task "upload" completes within 2m
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
    expect(errors(result.diagnostics)[0]).toContain('reuses background-task handle');
  });

  it('node ids are run-unique across feature files (TUI/GUI key by stepId)', () => {
    const registry = registryWithVocabulary();
    const compiled = compileFeatures({
      sources: [
        {
          uri: 'a.feature',
          content: 'Feature: A\n  Scenario: s\n    When alice does something silent\n',
        },
        {
          uri: 'b.feature',
          content: 'Feature: B\n  Scenario: s\n    When alice does something silent\n',
        },
      ],
      registry,
      actors: ACTORS,
    });
    const ids = compiled.plans.flatMap((plan) => plan.nodes.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('zero durations are rejected at parse time with a friendly message', () => {
    const result = compileFeatures({
      sources: feature(`
Feature: Zero wait
  Scenario: impatient
    When alice sends the message "hola"
    Then bob waits for the signal "message-sent" within 0s
`),
      registry: registryWithVocabulary(),
      actors: ACTORS,
    });
    expect(result.ok).toBe(false);
  });
});
