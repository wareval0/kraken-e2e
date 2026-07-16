/**
 * Seeded, typed test data (@kraken-e2e/data-gen). The seed is the contract:
 * every actor, every machine, every run derives the SAME users — so alice can
 * sign up with a generated account on Android and bob can log into the very
 * same account on iOS without passing data around.
 */
import { defineFixture } from '@kraken-e2e/data-gen';
import { z } from 'zod';

export const userSchema = z.object({
  fullName: z.string().min(1),
  email: z.email(),
  // native-demo-app requires 8+ chars; keep the rule in the schema.
  password: z.string().min(8),
});

export type User = z.infer<typeof userSchema>;

export const userFixture = defineFixture(userSchema, (faker) => ({
  fullName: faker.person.fullName(),
  email: faker.internet.email().toLowerCase(),
  password: `${faker.internet.password({ length: 10 })}K1!`,
}));

/** Deterministic reference date: fixtures never drift with the wall clock. */
const REF = '2026-07-09T00:00:00.000Z';

/** The QA engineer who signs off releases (same on every machine, forever). */
export const qaUser = (): User => userFixture.build({ seed: 20260709, refDate: REF });

/** A batch of distinct customers — prefix-stable (first N never change). */
export const customers = (count: number): readonly User[] =>
  userFixture.buildMany(count, { seed: 424242, refDate: REF });
