/**
 * Deterministic PRNG (mulberry32) — the whole fuzz engine's reproducibility
 * rests on this: same seed → same action sequence, on every platform, with
 * zero dependencies. Never use Math.random() anywhere in this package.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickIndex(rng: Rng, length: number): number {
  return Math.floor(rng() * length);
}

/** Weighted choice over entries; weights need not sum to 1. */
export function pickWeighted<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  const last = entries[entries.length - 1];
  if (!last) throw new Error('pickWeighted requires at least one entry');
  return last[0];
}

/** Seeded pseudo-word generator for typed text (no faker dependency here). */
export function randomText(rng: Rng): string {
  const syllables = ['ka', 'ra', 'ken', 'mo', 'ti', 'lu', 'sa', 'de', 'vi', 'po'];
  const count = 2 + pickIndex(rng, 3);
  let word = '';
  for (let i = 0; i < count; i += 1) {
    word += syllables[pickIndex(rng, syllables.length)];
  }
  return word;
}
