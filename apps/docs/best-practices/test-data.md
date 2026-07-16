# Seeded test data

Multi-actor scenarios multiply the cost of unstable test data: two devices that must agree on an account cannot rely on "generate something random" unless the generation is deterministic. `@kraken-e2e/data-gen` provides typed, seeded fixtures — the same seed produces the same data on every machine, for every actor, on every run.

## Defining a fixture

A fixture is a Zod schema plus a generator over a seeded Faker instance. Every built value — including manual overrides — is validated against the schema:

```typescript
import { defineFixture } from '@kraken-e2e/data-gen';
import { z } from 'zod';

export const userFixture = defineFixture(
  z.object({
    fullName: z.string().min(1),
    email: z.email(),
    password: z.string().min(8),
  }),
  (faker) => ({
    fullName: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    password: `${faker.internet.password({ length: 10 })}K1!`,
  }),
);
```

## Building values

```typescript
const user = userFixture.build({ seed: 20260709, refDate: '2026-07-09T00:00:00.000Z' });
const many = userFixture.buildMany(5, { seed: 424242, refDate: '2026-07-09T00:00:00.000Z' });
```

- `build({ seed, refDate?, locale? }, overrides?)` — one validated entity. Each call constructs a **fresh, isolated** Faker seeded with `seed`, so builds are independent of call order and safe under any actor interleaving. `overrides` are merged and re-validated.
- `buildMany(count, options)` — a batch with **prefix stability**: the first *N* entities of `buildMany(M > N)` equal `buildMany(N)`, because each index derives its own child seed. Growing a dataset never changes existing entities.
- Generators and overrides are typed against the schema's *input* (`z.input`), so schemas using `transform`, `pipe` or coercion type-check correctly; `build` returns the parsed *output*.

## Determinism has two extra requirements

1. **Pin Faker exactly.** Faker does not guarantee same-seed values across its own releases. Kraken's own monorepo pins the exact version; projects that rely on seed stability should do the same (no caret range).
2. **Pass `refDate` when generating dates.** Seeding fixes the random stream, but date generators are relative to the wall clock unless a reference date is supplied.

## The cross-actor pattern

Seeded fixtures remove the need to pass generated data between actors. The showcase's account-parity suite creates an account on Android and logs into it from iOS — the two actors never exchange the credentials, they *derive* them:

```typescript
/** The QA engineer who signs off releases (same on every machine, forever). */
export const qaUser = (): User => userFixture.build({ seed: 20260709, refDate: REF });
```

```gherkin
Given alice has signed up with the shared QA account   # Android builds the user from the seed
When bob logs in with the shared QA account            # iOS derives the identical user
Then bob is greeted with a successful login
```

When data must reflect something that genuinely happened at runtime (a value read off a screen, a server-assigned identifier), carry it in a [signal payload](/guide/signals) instead — fixtures are for data that is *decided*, payloads are for data that is *discovered*.
