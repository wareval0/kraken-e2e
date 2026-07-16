import { describe, expect, it } from 'vitest';

import { parseDuration } from '../src/parameter-types.ts';
import { createStepRegistry } from '../src/registry.ts';

describe('parseDuration', () => {
  it('parses ms/s/m into milliseconds', () => {
    expect(parseDuration('500ms')).toBe(500);
    expect(parseDuration('10s')).toBe(10_000);
    expect(parseDuration('2m')).toBe(120_000);
    expect(parseDuration('1.5s')).toBe(1_500);
    expect(() => parseDuration('10 parsecs')).toThrow(/Invalid duration/);
  });
});

describe('StepRegistry matching and actor extraction', () => {
  it('extracts the actor and passes remaining args to the handler', () => {
    const { When, registry } = createStepRegistry();
    When('{actor} sends the message {string}', async () => {});
    const match = registry.match('alice sends the message "hola"');
    expect(match).toBeDefined();
    expect(match?.actorName).toBe('alice');
    expect(match?.args).toEqual(['hola']);
  });

  it('unquotes quoted actor aliases', () => {
    const { When, registry } = createStepRegistry();
    When('{actor} logs out', async () => {});
    expect(registry.match('"the moderator" logs out')?.actorName).toBe('the moderator');
  });

  it('transforms {duration} and {int} parameters', () => {
    const { Then, registry } = createStepRegistry();
    Then('{actor} sees {int} items within {duration}', async () => {});
    const match = registry.match('bob sees 3 items within 10s');
    expect(match?.args).toEqual([3, 10_000]);
  });

  it('rejects registering a step without an {actor} parameter', () => {
    const { Given } = createStepRegistry();
    expect(() => Given('the backend is seeded', async () => {})).toThrow(/no \{actor\} parameter/);
  });

  it('reports ambiguity when two definitions match one text', () => {
    const { When, registry } = createStepRegistry();
    When('{actor} taps {string}', async () => {});
    When('{actor} taps "ok"', async () => {});
    expect(() => registry.match('alice taps "ok"')).toThrow(/matches 2 definitions/);
  });

  it('returns undefined for unmatched text (compiler turns it into a diagnostic)', () => {
    const { registry } = createStepRegistry();
    expect(registry.match('somebody does something nobody defined')).toBeUndefined();
  });

  it('built-in wait/join steps are registered with their analyzer kinds', () => {
    const { registry } = createStepRegistry();
    expect(registry.match('bob waits for the signal "x" within 10s')?.definition.kind).toBe(
      'wait-signal',
    );
    expect(
      registry.match('alice waits for the signal "x" from bob within 5s')?.definition.kind,
    ).toBe('wait-signal');
    const join = registry.match('alice\'s background task "upload" completes within 2m');
    expect(join?.definition.kind).toBe('join');
    expect(join?.args).toEqual(['upload', 120_000]);
  });

  it('the from-variant extracts the FIRST {actor} as addressee, second as arg', () => {
    const { registry } = createStepRegistry();
    const match = registry.match('bob waits for the signal "msg" from alice within 5s');
    expect(match?.actorName).toBe('bob');
    expect(match?.args).toEqual(['msg', 'alice', 5_000]);
  });

  it('supports custom parameter types via defineParameterType', () => {
    const { When, defineParameterType, registry } = createStepRegistry();
    defineParameterType({
      name: 'color',
      regexp: /red|green|blue/,
      transformer: (value) => value.toUpperCase(),
    });
    When('{actor} picks the {color} pill', async () => {});
    expect(registry.match('neo picks the red pill')?.args).toEqual(['RED']);
  });
});
