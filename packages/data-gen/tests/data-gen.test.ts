import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineFixture } from '../src/index.ts';

const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  createdAt: z.date(),
});

const userFixture = defineFixture(userSchema, (faker) => ({
  id: faker.string.uuid(),
  email: faker.internet.email(),
  name: faker.person.fullName(),
  createdAt: faker.date.recent(),
}));

describe('defineFixture (seeded, typed)', () => {
  it('same seed → identical entity; different seed → different', () => {
    const options = { seed: 42, refDate: '2026-07-05T00:00:00.000Z' };
    expect(userFixture.build(options)).toEqual(userFixture.build(options));
    expect(userFixture.build({ ...options, seed: 43 })).not.toEqual(userFixture.build(options));
  });

  it('refDate makes date fields deterministic too', () => {
    const a = userFixture.build({ seed: 7, refDate: '2026-01-01T00:00:00.000Z' });
    const b = userFixture.build({ seed: 7, refDate: '2026-01-01T00:00:00.000Z' });
    expect(a.createdAt.toISOString()).toBe(b.createdAt.toISOString());
  });

  it('overrides merge and are re-validated', () => {
    const user = userFixture.build({ seed: 1 }, { name: 'Alice Uniandes' });
    expect(user.name).toBe('Alice Uniandes');
    expect(() => userFixture.build({ seed: 1 }, { email: 'not-an-email' })).toThrow();
  });

  it('a generator that violates the schema throws ZodError', () => {
    const broken = defineFixture(userSchema, (faker) => ({
      id: faker.string.uuid(),
      email: 'nope',
      name: faker.person.fullName(),
      createdAt: faker.date.recent(),
    }));
    expect(() => broken.build({ seed: 1 })).toThrow();
  });

  it('buildMany is prefix-stable (first 3 of 5 === buildMany(3))', () => {
    const options = { seed: 99, refDate: '2026-07-05T00:00:00.000Z' };
    const five = userFixture.buildMany(5, options);
    const three = userFixture.buildMany(3, options);
    expect(five.slice(0, 3)).toEqual(three);
    expect(new Set(five.map((u) => u.email)).size).toBe(5);
  });

  it('cross-actor isolation: interleaved builds do not share RNG state', () => {
    const options = { seed: 5, refDate: '2026-07-05T00:00:00.000Z' };
    const solo = userFixture.build(options);
    const other = userFixture.build({ ...options, seed: 6 });
    const interleaved = userFixture.build(options);
    expect(interleaved).toEqual(solo);
    expect(other).not.toEqual(solo);
  });
});
