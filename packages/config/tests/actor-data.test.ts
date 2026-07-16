import { describe, expect, it } from 'vitest';

import { validateConfig } from '../src/schema.ts';

describe('actor data / env in the config schema', () => {
  it('accepts a data object and an env path per actor', () => {
    const config = validateConfig(
      {
        actors: {
          alice: { platform: 'web', data: { USERNAME: 'alice', ROLE: 'admin' } },
          bob: { platform: 'web', env: './bob.env' },
        },
        drivers: [],
      },
      '/p/kraken.config.ts',
    );
    expect(config.actors['alice']?.data).toEqual({ USERNAME: 'alice', ROLE: 'admin' });
    expect(config.actors['bob']?.env).toBe('./bob.env');
    // driver-specific keys still pass through
    expect(config.actors['alice']?.platform).toBe('web');
  });
});

describe('screenshots policy in the config schema', () => {
  const base = { actors: { a: { platform: 'web' } }, drivers: [] };

  it('accepts the three policies and rejects anything else', () => {
    for (const mode of ['on-failure', 'per-step', 'off'] as const) {
      const config = validateConfig({ ...base, screenshots: mode }, '/x/kraken.config.ts');
      expect(config.screenshots).toBe(mode);
    }
    expect(() =>
      validateConfig({ ...base, screenshots: 'always' }, '/x/kraken.config.ts'),
    ).toThrowError(/screenshots/);
  });
});
