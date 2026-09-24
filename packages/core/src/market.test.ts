import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';
import {
  DEFAULT_ESTIMATE_MODEL,
  KIND_ECONOMICS,
  MODEL_PRICES,
  PLATFORM_FEES,
  estimateTaskCostCents,
  expectedDailySales,
  platformFeeCents,
  tokenCostCents,
  unitMarginCents,
} from './economics.js';
import {
  FRESHNESS_FLOOR,
  NICHE_DEMAND_MAX,
  NICHE_DEMAND_MIN,
  binomial,
  createMarketModel,
  freshness,
  inferListingKind,
  nicheDemand,
  saturation,
  scaleDemand,
} from './market.js';
import { VENTURE_KINDS } from './types.js';
import { makeListing } from './testFixtures.js';
import type { Listing } from './types.js';

describe('economics', () => {
  it('prices tokens per model and bills unknown models at the top tier', () => {
    expect(MODEL_PRICES['claude-sonnet-5']).toEqual({ inputCentsPerMTok: 200, outputCentsPerMTok: 1000 });
    expect(tokenCostCents('claude-sonnet-5', 1_000_000, 0)).toBe(200);
    expect(tokenCostCents('claude-opus-5', 0, 1_000_000)).toBe(2500);
    expect(tokenCostCents('scripted', 5_000_000, 5_000_000)).toBe(0);
    expect(tokenCostCents('mystery-model', 1_000_000, 0)).toBe(500);
  });

  it('estimates task costs from the kind token profile', () => {
    // research-niche: 4500 tokens, 30% output on sonnet -> 3150*200 + 1350*1000 per MTok = 0.63 + 1.35 -> 2 cents.
    expect(estimateTaskCostCents('research-niche', 'claude-sonnet-5')).toBe(2);
    expect(estimateTaskCostCents('overseer-epoch', 'claude-opus-5')).toBe(18);
    expect(estimateTaskCostCents('publish-listing', 'scripted')).toBe(0);
    expect(estimateTaskCostCents('review-output', DEFAULT_ESTIMATE_MODEL)).toBeLessThan(
      estimateTaskCostCents('write-article', DEFAULT_ESTIMATE_MODEL),
    );
  });

  it('models the contract platform fees', () => {
    expect(PLATFORM_FEES.etsy).toEqual({ rate: 0.095, fixedCents: 45 });
    expect(PLATFORM_FEES.fiverr.rate).toBe(0.2);
    expect(PLATFORM_FEES['amazon-associates']).toEqual({ rate: 0, fixedCents: 0 });
    expect(platformFeeCents('etsy', 2499)).toBe(283);
  });

  it('keeps every kind pessimistic: under one expected sale per listing per week', () => {
    for (const kind of VENTURE_KINDS) {
      const econ = KIND_ECONOMICS[kind];
      expect(econ.baseCtr).toBeLessThanOrEqual(0.1);
      expect(econ.baseConversion).toBeLessThanOrEqual(0.05);
      expect(expectedDailySales(kind, 1) * 7).toBeLessThan(1);
      expect(unitMarginCents(kind, kind === 'pod-store' ? 'etsy' : 'gumroad')).toBeGreaterThan(0);
    }
    expect(unitMarginCents('pod-store', 'etsy')).toBeLessThan(800);
  });
});

describe('market helpers', () => {
  it('maps niches to a stable demand multiplier in [0.3, 1.7]', () => {
    const niches = ['cat tees', 'desert tileset', 'lo-fi loops', 'espresso guides', 'x', 'yy'];
    for (const n of niches) {
      const d = nicheDemand(n);
      expect(d).toBeGreaterThanOrEqual(NICHE_DEMAND_MIN);
      expect(d).toBeLessThanOrEqual(NICHE_DEMAND_MAX);
      expect(nicheDemand(n)).toBe(d);
      expect(nicheDemand(` ${n.toUpperCase()} `)).toBe(d);
    }
  });

  it('decays freshness by half-life with an evergreen floor', () => {
    expect(freshness(0, 720)).toBe(1);
    expect(freshness(720, 720)).toBeCloseTo(0.5, 6);
    expect(freshness(720 * 10, 720)).toBe(FRESHNESS_FLOOR);
  });

  it('saturates by live listings in the niche', () => {
    expect(saturation(0, 20)).toBe(1);
    expect(saturation(20, 20)).toBeCloseTo(0.5, 6);
  });

  it('binomial is exact for small n and approximate above the cutoff', () => {
    const rng = createRng('binom');
    expect(binomial(rng, 0, 0.5)).toBe(0);
    expect(binomial(rng, 10, 1)).toBe(10);
    let total = 0;
    for (let i = 0; i < 400; i++) total += binomial(rng, 20, 0.3);
    expect(total / 400).toBeCloseTo(6, 0);
    let big = 0;
    for (let i = 0; i < 400; i++) big += binomial(rng, 1000, 0.1);
    expect(big / 400).toBeCloseTo(100, -1);
  });

  it('infers the venture kind from the listing or its platform', () => {
    expect(inferListingKind({ platform: 'etsy' })).toBe('pod-store');
    expect(inferListingKind({ platform: 'itch' })).toBe('game-assets');
    expect(inferListingKind({ platform: 'gumroad', kind: 'music-packs' })).toBe('music-packs');
    expect(inferListingKind({ platform: 'mock' })).toBe('pod-store');
  });
});

function runTicks(listings: Listing[], ticks: number, seed: string, overrides = {}) {
  const model = createMarketModel(overrides);
  const rng = createRng(seed);
  let units = 0;
  let net = 0;
  let impressions = 0;
  for (let t = 0; t < ticks; t++) {
    const r = model.simulateTick(listings, t, rng);
    for (const s of r.sales) {
      units += s.units;
      net += s.netCents;
    }
    for (const v of Object.values(r.impressions)) impressions += v;
  }
  return { units, net, impressions };
}

describe('market model', () => {
  it('yields zero sales and impressions with no listings', () => {
    const r = createMarketModel().simulateTick([], 10, createRng(1));
    expect(r).toEqual({ sales: [], impressions: {}, clicks: {} });
  });

  it('ignores listings that are not live', () => {
    const listings = [makeListing({ status: 'draft', quality: 1 }), makeListing({ id: 'lst_2', status: 'delisted', quality: 1 })];
    expect(runTicks(listings, 500, 'not-live').impressions).toBe(0);
  });

  it('is deterministic under a seed', () => {
    const listings = [makeListing({ quality: 1 }), makeListing({ id: 'lst_2', niche: 'other', quality: 0.9 })];
    const a = runTicks(listings, 1000, 'same');
    const b = runTicks(listings, 1000, 'same');
    const c = runTicks(listings, 1000, 'different');
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('sells more at higher quality over 1000 ticks', () => {
    const boosted = { 'pod-store': { baseDailyImpressions: 400 } };
    const high = runTicks([makeListing({ quality: 1 })], 1000, 'q', boosted);
    const low = runTicks([makeListing({ quality: 0.4 })], 1000, 'q', boosted);
    expect(high.units).toBeGreaterThan(low.units);
    expect(high.impressions).toBeGreaterThan(low.impressions * 3);
  });

  it('applies platform fees, unit cost and refunds to the net', () => {
    const listing = makeListing({ quality: 1, priceCents: 2499, unitCostCents: 1600 });
    const model = createMarketModel({ 'pod-store': { baseDailyImpressions: 24_000, baseCtr: 1, baseConversion: 1, refundRate: 0.5 } });
    const r = model.simulateTick([listing], 0, createRng('fees'));
    expect(r.sales).toHaveLength(1);
    const sale = r.sales[0]!;
    expect(sale.units).toBeGreaterThan(0);
    expect(sale.grossCents).toBe(sale.units * 2499);
    expect(sale.feeCents).toBe(Math.ceil(sale.grossCents * 0.095) + 45 * sale.units);
    expect(sale.fulfilmentCents).toBe(sale.units * 1600);
    expect(sale.refundedUnits).toBeGreaterThan(0);
    expect(sale.refundCents).toBe(sale.refundedUnits * 2499);
    expect(sale.netCents).toBe(sale.grossCents - sale.feeCents - sale.fulfilmentCents - sale.refundCents);
  });

  it('starves saturated niches of impressions', () => {
    const boost = { 'pod-store': { baseDailyImpressions: 240, saturationK: 2 } };
    const lonely = runTicks([makeListing({ quality: 1, niche: 'solo' })], 400, 'sat', boost);
    const crowd = Array.from({ length: 20 }, (_, i) => makeListing({ id: `lst_${i}`, quality: 1, niche: 'crowded' }));
    const crowded = runTicks(crowd, 400, 'sat', boost);
    const perListing = crowded.impressions / crowd.length;
    expect(perListing).toBeLessThan(lonely.impressions / 4);
  });

  it('scaleDemand multiplies impressions for every kind and rejects bad multipliers', () => {
    const boosted = createMarketModel(scaleDemand(8));
    for (const kind of VENTURE_KINDS) {
      expect(boosted.economicsFor(kind).baseDailyImpressions).toBeCloseTo(KIND_ECONOMICS[kind].baseDailyImpressions * 8, 9);
      expect(boosted.economicsFor(kind).baseCtr).toBe(KIND_ECONOMICS[kind].baseCtr);
    }
    const plain = runTicks([makeListing({ quality: 1 })], 500, 'scale');
    const scaled = runTicks([makeListing({ quality: 1 })], 500, 'scale', scaleDemand(8));
    expect(scaled.impressions).toBeGreaterThan(plain.impressions * 4);
    expect(() => scaleDemand(0)).toThrow(RangeError);
    expect(() => scaleDemand(Number.NaN)).toThrow(RangeError);
  });

  it('holds affiliate posts at zero until they index', () => {
    const post = makeListing({ platform: 'wordpress', kind: 'affiliate-blog', quality: 1, priceCents: 600, unitCostCents: 0 });
    const model = createMarketModel({ 'affiliate-blog': { baseDailyImpressions: 2400 } });
    const rng = createRng('index');
    expect(model.simulateTick([post], 0, rng).impressions['lst_1']).toBeUndefined();
    expect(model.simulateTick([post], 24 * 60, rng).impressions['lst_1']).toBeGreaterThan(0);
  });
});
