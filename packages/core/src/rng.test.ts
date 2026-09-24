import { describe, expect, it } from 'vitest';
import { createRng, hashString } from './rng.js';
import { makeId, idPrefix } from './ids.js';
import { TICKS_PER_DAY, dayStartTick, formatTicks, simDay, tickToSimTime } from './simTime.js';

describe('rng', () => {
  it('is deterministic for the same seed and different for different seeds', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    const c = createRng('seed-2');
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    const seqC = Array.from({ length: 5 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('produces values in [0,1) and ints within inclusive bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = rng.int(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
  });

  it('poisson and normal have the expected means', () => {
    const rng = createRng('stats');
    const n = 5000;
    let poissonSum = 0;
    let normalSum = 0;
    for (let i = 0; i < n; i++) {
      poissonSum += rng.poisson(2.5);
      normalSum += rng.normal(10, 2);
    }
    expect(poissonSum / n).toBeCloseTo(2.5, 0);
    expect(normalSum / n).toBeCloseTo(10, 0);
    expect(rng.poisson(0)).toBe(0);
    expect(rng.poisson(100)).toBeGreaterThan(60);
  });

  it('chance respects its probability at the extremes', () => {
    const rng = createRng('chance');
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
    let hits = 0;
    for (let i = 0; i < 4000; i++) if (rng.chance(0.25)) hits++;
    expect(hits / 4000).toBeCloseTo(0.25, 1);
  });

  it('forks are stable by label and independent of draws on the parent', () => {
    const a = createRng('root');
    const forkBefore = a.fork('market').next();
    a.next();
    a.next();
    const forkAfter = a.fork('market').next();
    expect(forkBefore).toBe(forkAfter);
    expect(createRng('root').fork('overseer').next()).not.toBe(forkBefore);
  });

  it('hashString is stable', () => {
    expect(hashString('vintage botanical cat tees')).toBe(hashString('vintage botanical cat tees'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('ids', () => {
  it('makes prefixed ids that are reproducible with an rng', () => {
    const id = makeId('ven', createRng(1));
    expect(id).toMatch(/^ven_[0-9a-z]{8}$/);
    expect(makeId('ven', createRng(1))).toBe(id);
    expect(idPrefix(id)).toBe('ven');
    expect(idPrefix('nope')).toBeNull();
  });

  it('rejects invalid prefixes', () => {
    expect(() => makeId('Bad Prefix')).toThrow(RangeError);
  });
});

describe('simTime', () => {
  it('maps ticks to hours from the epoch start', () => {
    expect(TICKS_PER_DAY).toBe(24);
    expect(tickToSimTime(0)).toBe('2030-01-01T00:00:00.000Z');
    expect(tickToSimTime(25)).toBe('2030-01-02T01:00:00.000Z');
    expect(tickToSimTime(3, '2031-06-01T00:00:00.000Z')).toBe('2031-06-01T03:00:00.000Z');
    expect(simDay(47)).toBe(1);
    expect(dayStartTick(47)).toBe(24);
  });

  it('formats durations for the HUD', () => {
    expect(formatTicks(2)).toBe('2h');
    expect(formatTicks(76)).toBe('3d 4h');
    expect(formatTicks(24 * 400)).toBe('1y 35d');
    expect(formatTicks(Number.POSITIVE_INFINITY)).toBe('never');
  });
});
