/**
 * @kraken-e2e/data-gen — typed, SEEDED test-data fixtures (ADR-0001 §5.14).
 *
 * Replaces v2's stringly `$faker_id` interpolation: a fixture is a zod
 * schema + a generator over a seeded faker instance. Same seed → same data,
 * across actors, runs and machines — which is why the faker version is
 * pinned EXACT in the catalog (faker does not guarantee same-seed values
 * across its own releases).
 */
import { en, Faker, type LocaleDefinition } from '@faker-js/faker';
import type { z } from 'zod';

export interface FixtureBuildOptions {
  /** Reproducibility seed (REQUIRED — pass a scenario-stable value). */
  readonly seed: number;
  /** Deterministic reference for faker.date.* (seeding alone is not enough). */
  readonly refDate?: Date | string;
  /** Locale chain; defaults to English. */
  readonly locale?: LocaleDefinition | LocaleDefinition[];
}

export interface Fixture<Schema extends z.ZodType> {
  readonly schema: Schema;
  /** Generate one validated entity. Same options → same entity. */
  build(options: FixtureBuildOptions, overrides?: Partial<z.input<Schema>>): z.infer<Schema>;
  /**
   * Generate a batch. PREFIX-STABLE: the first N of buildMany(M>N) equal
   * buildMany(N) — each entity derives its own child seed from (seed, index).
   */
  buildMany(count: number, options: FixtureBuildOptions): ReadonlyArray<z.infer<Schema>>;
}

// The generator and overrides feed schema.parse(), so they are the schema's
// INPUT type (z.input), which differs from the OUTPUT (z.infer) whenever the
// schema uses .transform()/.pipe()/coerce; build() returns the parsed OUTPUT.
export type FixtureGenerator<Schema extends z.ZodType> = (faker: Faker) => z.input<Schema>;

function seededFaker(options: FixtureBuildOptions): Faker {
  const locale = options.locale ?? en;
  const faker = new Faker({ locale: Array.isArray(locale) ? locale : [locale] });
  faker.seed(options.seed);
  if (options.refDate !== undefined) {
    faker.setDefaultRefDate(options.refDate);
  }
  return faker;
}

/** Derive a child seed from (seed, index) — cheap, stable, collision-spread. */
function childSeed(seed: number, index: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ index, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Define a typed fixture: the generator receives a FRESH seeded faker per
 * build (isolated RNG state — safe under any actor interleaving), and every
 * result (including overrides) is validated by the zod schema.
 */
export function defineFixture<Schema extends z.ZodType>(
  schema: Schema,
  generate: FixtureGenerator<Schema>,
): Fixture<Schema> {
  return {
    schema,
    build(options, overrides) {
      const generated = generate(seededFaker(options)) as Record<string, unknown>;
      const merged = overrides
        ? { ...generated, ...(overrides as Record<string, unknown>) }
        : generated;
      return schema.parse(merged) as z.infer<Schema>;
    },
    buildMany(count, options) {
      const entities: Array<z.infer<Schema>> = [];
      for (let index = 0; index < count; index += 1) {
        entities.push(this.build({ ...options, seed: childSeed(options.seed, index) }));
      }
      return entities;
    },
  };
}
