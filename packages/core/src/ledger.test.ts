import { describe, expect, it } from 'vitest';
import { DEFAULT_MILESTONES, computeTreasury, computeVentureMetrics, formatCents } from './ledger.js';
import { makeEntry, makeListing, makeVenture } from './testFixtures.js';

const OPTS = { targetCents: 1_000_00, dailyTokenBudgetCents: 500 };

describe('computeTreasury', () => {
  it('derives balance, lifetime and daily figures from a known ledger', () => {
    const entries = [
      makeEntry(1, 'token-cost', -100),
      makeEntry(2, 'revenue', 2499),
      makeEntry(2, 'platform-fee', -283),
      makeEntry(2, 'fulfilment-cost', -1600),
      makeEntry(40, 'token-cost', -50),
      makeEntry(45, 'revenue', 1000),
    ];
    const t = computeTreasury(entries, 48, { ...OPTS, startingBalanceCents: 1000 });
    expect(t.balanceCents).toBe(1000 - 100 + 2499 - 283 - 1600 - 50 + 1000);
    expect(t.lifetimeRevenueCents).toBe(3499);
    expect(t.lifetimeCostCents).toBe(2033);
    // Window is (24, 48]: the tick-40 cost and tick-45 revenue only.
    expect(t.dailyRevenueCents).toBe(1000);
    expect(t.dailyCostCents).toBe(50);
    expect(t.dailyProfitCents).toBe(950);
    expect(t.targetCents).toBe(OPTS.targetCents);
  });

  it('ignores entries after the requested tick', () => {
    const entries = [makeEntry(5, 'revenue', 100), makeEntry(50, 'revenue', 100)];
    expect(computeTreasury(entries, 10, OPTS).balanceCents).toBe(100);
  });

  it('computes runway when burning and eta when profitable', () => {
    const burning = computeTreasury([makeEntry(47, 'token-cost', -240)], 48, { ...OPTS, startingBalanceCents: 1000 });
    expect(burning.runwayTicks).toBe(Math.floor((760 * 24) / 240));
    expect(burning.etaTicksToTarget).toBeNull();

    const earning = computeTreasury([makeEntry(47, 'revenue', 2400)], 48, OPTS);
    expect(earning.runwayTicks).toBeNull();
    expect(earning.etaTicksToTarget).toBe(Math.ceil(((100_000 - 2400) * 24) / 2400));

    const flat = computeTreasury([], 48, OPTS);
    expect(flat.runwayTicks).toBeNull();
    expect(flat.etaTicksToTarget).toBeNull();

    const done = computeTreasury([makeEntry(1, 'revenue', 200_000)], 48, OPTS);
    expect(done.etaTicksToTarget).toBe(0);
  });

  it('marks milestones at the tick cumulative revenue crosses them', () => {
    const entries = [makeEntry(3, 'revenue', 60), makeEntry(9, 'revenue', 50), makeEntry(30, 'revenue', 20_000)];
    const t = computeTreasury(entries, 100, OPTS);
    const byLabel = Object.fromEntries(t.milestones.map((m) => [m.label, m.reachedAtTick]));
    expect(byLabel['$1']).toBe(9);
    expect(byLabel['$100']).toBe(30);
    expect(byLabel['$1k']).toBeUndefined();
    expect(DEFAULT_MILESTONES).toHaveLength(12);
    expect(DEFAULT_MILESTONES[11]).toEqual({ label: '$1T', cents: 1e14 });
    expect(DEFAULT_MILESTONES.map((m) => m.reachedAtTick).every((v) => v === undefined)).toBe(true);
  });

  it('tracks the remaining daily token budget within the current sim day', () => {
    const entries = [makeEntry(20, 'token-cost', -300), makeEntry(25, 'token-cost', -120), makeEntry(26, 'platform-fee', -999)];
    const t = computeTreasury(entries, 30, OPTS);
    expect(t.dailyTokenBudgetRemainingCents).toBe(380);
    const exhausted = computeTreasury([makeEntry(25, 'token-cost', -900)], 30, OPTS);
    expect(exhausted.dailyTokenBudgetRemainingCents).toBe(0);
  });
});

describe('computeVentureMetrics', () => {
  it('splits lifetime and trailing figures per venture', () => {
    const venture = makeVenture({ id: 'ven_a' });
    const entries = [
      makeEntry(1, 'token-cost', -100, 'ven_a'),
      makeEntry(2, 'revenue', 400, 'ven_a'),
      makeEntry(2, 'platform-fee', -40, 'ven_a'),
      makeEntry(190, 'token-cost', -60, 'ven_a'),
      makeEntry(195, 'revenue', 30, 'ven_a'),
      makeEntry(195, 'revenue', 9999, 'ven_other'),
    ];
    const listings = [
      makeListing({ id: 'l1', ventureId: 'ven_a', stats: { impressions: 100, clicks: 10, sales: 2 } }),
      makeListing({ id: 'l2', ventureId: 'ven_a', status: 'draft', publishedAtTick: undefined }),
      makeListing({ id: 'l3', ventureId: 'ven_other' }),
    ];
    const m = computeVentureMetrics(venture, entries, listings, 200, 168);
    expect(m.revenueCents).toBe(430);
    expect(m.costCents).toBe(200);
    expect(m.profitCents).toBe(230);
    expect(m.roi).toBeCloseTo(1.15, 6);
    expect(m.trailingRevenueCents).toBe(30);
    expect(m.trailingCostCents).toBe(60);
    expect(m.trailingRoi).toBeCloseTo(-0.5, 6);
    expect(m.ticksSinceLastSale).toBe(5);
    expect(m.unitsProduced).toBe(2);
    expect(m.unitsPublished).toBe(1);
    expect(m.unitsSold).toBe(2);
    expect(m.impressions).toBe(100);
    expect(m.clicks).toBe(10);
    expect(m.conversionRate).toBeCloseTo(0.2, 6);
  });

  it('reports null ticksSinceLastSale and zero roi with no activity', () => {
    const m = computeVentureMetrics(makeVenture(), [], [], 50, 168);
    expect(m.ticksSinceLastSale).toBeNull();
    expect(m.roi).toBe(0);
    expect(m.trailingRoi).toBe(0);
  });
});

describe('formatCents', () => {
  it('formats small amounts with thousands separators and two decimals', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-42)).toBe('-$0.42');
    expect(formatCents(99_999_999)).toBe('$999,999.99');
  });

  it('abbreviates millions, billions and trillions', () => {
    expect(formatCents(1_234_567_00)).toBe('$1.2M');
    expect(formatCents(1_200_000_000_00)).toBe('$1.2B');
    expect(formatCents(1e14)).toBe('$1.0T');
    expect(formatCents(-2_500_000_00)).toBe('-$2.5M');
  });
});
