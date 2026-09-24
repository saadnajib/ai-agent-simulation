/**
 * Simulated demand. A pure function of (listings, tick, rng).
 *
 * Per live listing and tick:
 *   impressions ~ Poisson(baseDailyImpressions/24 * quality^2 * freshness(age)
 *                          * saturation(niche) * nicheDemand(niche) * ramp(age))
 *   clicks      ~ Binomial(impressions, baseCtr)
 *   sales       ~ Binomial(clicks, baseConversion)
 * Gross = units * price; platform fees and unit cost come off; each unit is
 * refunded with probability refundRate, which also comes off the net.
 */
import type { Listing, Platform, VentureKind } from './types.js';
import { KIND_ECONOMICS, PLATFORM_FEES, type KindEconomics } from './economics.js';
import { hashString, type Rng } from './rng.js';

export interface SaleEvent {
  listingId: string;
  ventureId: string;
  platform: Platform;
  units: number;
  grossCents: number;
  feeCents: number;
  fulfilmentCents: number;
  /** Gross value of refunded units, already subtracted from netCents. */
  refundCents: number;
  refundedUnits: number;
  netCents: number;
  tick: number;
}

export interface MarketTickResult {
  sales: SaleEvent[];
  /** Impressions per listing id this tick. */
  impressions: Record<string, number>;
  /** Clicks per listing id this tick. */
  clicks: Record<string, number>;
}

export interface MarketModel {
  simulateTick(listings: readonly Listing[], tick: number, rng: Rng): MarketTickResult;
  /** The economics in force for a kind after overrides, for HUD/docs. */
  economicsFor(kind: VentureKind): KindEconomics;
}

/** Freshness never drops below this: the evergreen long tail. */
export const FRESHNESS_FLOOR = 0.15;
export const NICHE_DEMAND_MIN = 0.3;
export const NICHE_DEMAND_MAX = 1.7;

/** Above this many trials the binomial draw uses a normal approximation. */
const BINOMIAL_EXACT_LIMIT = 50;

const PLATFORM_KIND: Partial<Record<Platform, VentureKind>> = {
  etsy: 'pod-store',
  printify: 'pod-store',
  printful: 'pod-store',
  fiverr: 'thumbnail-service',
  itch: 'game-assets',
  'unity-asset-store': 'game-assets',
  wordpress: 'affiliate-blog',
  'amazon-associates': 'affiliate-blog',
  lemonsqueezy: 'software-templates',
  gumroad: 'software-templates',
  distrokid: 'music-packs',
};

/** Venture kind for a listing: explicit field first, then platform, then the POD default. */
export function inferListingKind(listing: Pick<Listing, 'platform' | 'kind'>): VentureKind {
  return listing.kind ?? PLATFORM_KIND[listing.platform] ?? 'pod-store';
}

/** Stable demand multiplier in [NICHE_DEMAND_MIN, NICHE_DEMAND_MAX] derived from the niche string. */
export function nicheDemand(niche: string): number {
  const unit = hashString(niche.trim().toLowerCase()) / 0x1_0000_0000;
  return NICHE_DEMAND_MIN + unit * (NICHE_DEMAND_MAX - NICHE_DEMAND_MIN);
}

/** 0.5^(age/halfLife), floored at FRESHNESS_FLOOR. */
export function freshness(ageTicks: number, halfLifeTicks: number): number {
  if (!(halfLifeTicks > 0)) return 1;
  const age = Math.max(0, ageTicks);
  return Math.max(FRESHNESS_FLOOR, Math.pow(0.5, age / halfLifeTicks));
}

/** 1 / (1 + liveInNiche / K). */
export function saturation(liveInNiche: number, saturationK: number): number {
  if (!(saturationK > 0)) return 1;
  return 1 / (1 + Math.max(0, liveInNiche) / saturationK);
}

function indexingRamp(ageTicks: number, rampTicks: number | undefined): number {
  if (rampTicks === undefined || !(rampTicks > 0)) return 1;
  return Math.min(1, Math.max(0, ageTicks) / rampTicks);
}

/** Binomial(n, p): exact by repeated trials for small n, normal approximation above. */
export function binomial(rng: Rng, n: number, p: number): number {
  if (n <= 0 || !(p > 0)) return 0;
  if (p >= 1) return n;
  if (n <= BINOMIAL_EXACT_LIMIT) {
    let successes = 0;
    for (let i = 0; i < n; i++) if (rng.chance(p)) successes++;
    return successes;
  }
  const mean = n * p;
  const sd = Math.sqrt(n * p * (1 - p));
  return Math.min(n, Math.max(0, Math.round(rng.normal(mean, sd))));
}

function listingAge(listing: Listing, tick: number): number {
  return Math.max(0, tick - (listing.publishedAtTick ?? listing.createdAtTick));
}

function countLiveByNiche(listings: readonly Listing[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const listing of listings) {
    if (listing.status !== 'live') continue;
    const niche = listing.niche.trim().toLowerCase();
    counts.set(niche, (counts.get(niche) ?? 0) + 1);
  }
  return counts;
}

function mergeEconomics(
  overrides: Partial<Record<VentureKind, Partial<KindEconomics>>>,
): Record<VentureKind, KindEconomics> {
  const merged = {} as Record<VentureKind, KindEconomics>;
  for (const kind of Object.keys(KIND_ECONOMICS) as VentureKind[]) {
    merged[kind] = { ...KIND_ECONOMICS[kind], ...(overrides[kind] ?? {}) };
  }
  return merged;
}

/** Expected impressions this tick for one listing given the niche counts. */
function impressionRate(listing: Listing, econ: KindEconomics, tick: number, liveInNiche: number): number {
  const quality = Math.min(1, Math.max(0, listing.quality));
  const age = listingAge(listing, tick);
  return (
    (econ.baseDailyImpressions / 24) *
    quality *
    quality *
    freshness(age, econ.decayHalfLifeTicks) *
    saturation(liveInNiche, econ.saturationK) *
    nicheDemand(listing.niche) *
    indexingRamp(age, econ.indexingRampTicks)
  );
}

function settle(listing: Listing, econ: KindEconomics, units: number, tick: number, rng: Rng): SaleEvent {
  const fee = PLATFORM_FEES[listing.platform];
  const price = Math.max(0, Math.round(listing.priceCents));
  const grossCents = units * price;
  const feeCents = Math.ceil(grossCents * fee.rate) + fee.fixedCents * units;
  const fulfilmentCents = units * Math.max(0, Math.round(listing.unitCostCents));
  const refundedUnits = binomial(rng, units, econ.refundRate);
  const refundCents = refundedUnits * price;
  return {
    listingId: listing.id,
    ventureId: listing.ventureId,
    platform: listing.platform,
    units,
    grossCents,
    feeCents,
    fulfilmentCents,
    refundCents,
    refundedUnits,
    netCents: grossCents - feeCents - fulfilmentCents - refundCents,
    tick,
  };
}

/**
 * Overrides that scale baseDailyImpressions for every kind by `multiplier`.
 * Sim mode can pass this to createMarketModel so a fresh station shows
 * sales in days rather than weeks; the HUD should label the multiplier so
 * nobody mistakes boosted demand for the real thing.
 */
export function scaleDemand(multiplier: number): Partial<Record<VentureKind, Partial<KindEconomics>>> {
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError('scaleDemand: multiplier must be a positive finite number');
  }
  const overrides: Partial<Record<VentureKind, Partial<KindEconomics>>> = {};
  for (const kind of Object.keys(KIND_ECONOMICS) as VentureKind[]) {
    overrides[kind] = { baseDailyImpressions: KIND_ECONOMICS[kind].baseDailyImpressions * multiplier };
  }
  return overrides;
}

export function createMarketModel(
  overrides: Partial<Record<VentureKind, Partial<KindEconomics>>> = {},
): MarketModel {
  const economics = mergeEconomics(overrides);

  const simulateTick = (listings: readonly Listing[], tick: number, rng: Rng): MarketTickResult => {
    const result: MarketTickResult = { sales: [], impressions: {}, clicks: {} };
    const liveByNiche = countLiveByNiche(listings);
    for (const listing of listings) {
      if (listing.status !== 'live') continue;
      const econ = economics[inferListingKind(listing)];
      const liveInNiche = liveByNiche.get(listing.niche.trim().toLowerCase()) ?? 0;
      const impressions = rng.poisson(impressionRate(listing, econ, tick, liveInNiche));
      if (impressions === 0) continue;
      result.impressions[listing.id] = impressions;
      const clicks = binomial(rng, impressions, econ.baseCtr);
      if (clicks === 0) continue;
      result.clicks[listing.id] = clicks;
      const units = binomial(rng, clicks, econ.baseConversion);
      if (units === 0) continue;
      result.sales.push(settle(listing, econ, units, tick, rng));
    }
    return result;
  };

  return { simulateTick, economicsFor: (kind) => economics[kind] };
}
