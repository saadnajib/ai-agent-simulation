/**
 * Deterministic pseudo-random number generator (sfc32).
 *
 * Every stochastic thing in core takes an `Rng` so a whole run can be
 * replayed from a single seed. Streams can be forked by label so that, for
 * example, the market and the overseer draw from independent sequences and
 * adding a draw to one does not perturb the other.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Uniform pick from a non-empty list. */
  pick<T>(items: readonly T[]): T;
  /** True with probability p (clamped to [0, 1]). */
  chance(p: number): boolean;
  /** Poisson-distributed count with the given mean. */
  poisson(lambda: number): number;
  /** Normally distributed sample. */
  normal(mean: number, sd: number): number;
  /** Independent derived stream. The same label always yields the same stream. */
  fork(label: string): Rng;
}

/** cyrb128: hashes a string into four 32-bit words suitable for seeding sfc32. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32 core generator. Returns a closure producing floats in [0, 1). */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function seedToString(seed: number | string): string {
  return typeof seed === 'number' ? `n:${seed}` : `s:${seed}`;
}

/** Stable 32-bit hash of a string, exposed for niche demand and similar needs. */
export function hashString(str: string): number {
  return cyrb128(str)[0];
}

/**
 * Creates a reproducible generator. Numeric and string seeds are both fine;
 * `createRng(42)` and `createRng('42')` are deliberately different streams.
 */
export function createRng(seed: number | string): Rng {
  const seedKey = seedToString(seed);
  const [a, b, c, d] = cyrb128(seedKey);
  const raw = sfc32(a, b, c, d);
  // Discard a few outputs so closely related seeds decorrelate quickly.
  for (let i = 0; i < 12; i++) raw();

  const next = (): number => raw();

  const int = (min: number, max: number): number => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new RangeError('rng.int bounds must be finite');
    }
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return lo + Math.floor(next() * (hi - lo + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError('rng.pick called with an empty list');
    return items[Math.floor(next() * items.length)] as T;
  };

  const chance = (p: number): boolean => {
    if (!(p > 0)) return false;
    if (p >= 1) return true;
    return next() < p;
  };

  const normal = (mean: number, sd: number): number => {
    // Box-Muller; u1 is kept strictly positive so log() is finite.
    let u1 = next();
    while (u1 <= Number.EPSILON) u1 = next();
    const u2 = next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * sd;
  };

  const poisson = (lambda: number): number => {
    if (!(lambda > 0)) return 0;
    if (lambda > 30) {
      // Normal approximation is accurate enough above ~30 and avoids long loops.
      return Math.max(0, Math.round(normal(lambda, Math.sqrt(lambda))));
    }
    // Knuth's algorithm.
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= next();
    } while (p > limit);
    return k - 1;
  };

  const fork = (label: string): Rng => createRng(`${seedKey}/${label}`);

  return { next, int, pick, chance, poisson, normal, fork };
}
