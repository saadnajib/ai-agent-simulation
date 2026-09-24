/**
 * Ledger math: treasury, per-venture metrics and money formatting.
 *
 * Ledger entries carry signed cents (revenue positive, costs negative). All
 * functions here are pure and O(n) over the entries they are given.
 */
import type { LedgerEntry, Listing, Milestone, Treasury, Venture, VentureMetrics } from './types.js';
import { TICKS_PER_DAY, dayStartTick } from './simTime.js';

export const DEFAULT_MILESTONES: Milestone[] = [
  { label: '$1', cents: 1_00 },
  { label: '$100', cents: 100_00 },
  { label: '$1k', cents: 1_000_00 },
  { label: '$10k', cents: 10_000_00 },
  { label: '$100k', cents: 100_000_00 },
  { label: '$1M', cents: 1_000_000_00 },
  { label: '$10M', cents: 10_000_000_00 },
  { label: '$100M', cents: 100_000_000_00 },
  { label: '$1B', cents: 1_000_000_000_00 },
  { label: '$10B', cents: 10_000_000_000_00 },
  { label: '$100B', cents: 100_000_000_000_00 },
  { label: '$1T', cents: 1_000_000_000_000_00 },
];

export interface TreasuryOptions {
  targetCents: number;
  dailyTokenBudgetCents: number;
  startingBalanceCents?: number;
  milestones?: Milestone[];
}

interface WindowTotals {
  revenueCents: number;
  costCents: number;
}

function isRevenue(entry: LedgerEntry): boolean {
  return entry.kind === 'revenue' && entry.amountCents > 0;
}

/** Sums revenue (positive) and cost (magnitude of negatives) for entries with lo < tick <= hi. */
function totalsInWindow(entries: readonly LedgerEntry[], lo: number, hi: number): WindowTotals {
  let revenueCents = 0;
  let costCents = 0;
  for (const entry of entries) {
    if (entry.tick <= lo || entry.tick > hi) continue;
    if (isRevenue(entry)) revenueCents += entry.amountCents;
    else if (entry.amountCents < 0) costCents -= entry.amountCents;
  }
  return { revenueCents, costCents };
}

/** Ticks at which cumulative revenue first crossed each milestone. */
function markMilestones(entries: readonly LedgerEntry[], milestones: readonly Milestone[]): Milestone[] {
  const revenue = entries.filter(isRevenue).sort((a, b) => a.tick - b.tick);
  const result = milestones.map((m) => ({ label: m.label, cents: m.cents }) as Milestone);
  let cumulative = 0;
  let next = 0;
  for (const entry of revenue) {
    cumulative += entry.amountCents;
    while (next < result.length && cumulative >= (result[next] as Milestone).cents) {
      (result[next] as Milestone).reachedAtTick = entry.tick;
      next++;
    }
    if (next >= result.length) break;
  }
  return result;
}

function tokenSpendSince(entries: readonly LedgerEntry[], sinceTick: number, tick: number): number {
  let spent = 0;
  for (const entry of entries) {
    if (entry.kind !== 'token-cost' || entry.tick < sinceTick || entry.tick > tick) continue;
    if (entry.amountCents < 0) spent -= entry.amountCents;
  }
  return spent;
}

export function computeTreasury(entries: readonly LedgerEntry[], tick: number, opts: TreasuryOptions): Treasury {
  const startingBalance = opts.startingBalanceCents ?? 0;
  let balanceCents = startingBalance;
  let lifetimeRevenueCents = 0;
  let lifetimeCostCents = 0;
  for (const entry of entries) {
    if (entry.tick > tick) continue;
    balanceCents += entry.amountCents;
    if (isRevenue(entry)) lifetimeRevenueCents += entry.amountCents;
    else if (entry.amountCents < 0) lifetimeCostCents -= entry.amountCents;
  }

  const daily = totalsInWindow(entries, tick - TICKS_PER_DAY, tick);
  const dailyProfitCents = daily.revenueCents - daily.costCents;

  const runwayTicks =
    dailyProfitCents < 0 ? Math.max(0, Math.floor((balanceCents * TICKS_PER_DAY) / -dailyProfitCents)) : null;

  const remainingToTarget = opts.targetCents - balanceCents;
  let etaTicksToTarget: number | null = null;
  if (remainingToTarget <= 0) etaTicksToTarget = 0;
  else if (dailyProfitCents > 0) etaTicksToTarget = Math.ceil((remainingToTarget * TICKS_PER_DAY) / dailyProfitCents);

  const spentToday = tokenSpendSince(entries, dayStartTick(tick), tick);

  return {
    balanceCents,
    lifetimeRevenueCents,
    lifetimeCostCents,
    targetCents: opts.targetCents,
    milestones: markMilestones(entries, opts.milestones ?? DEFAULT_MILESTONES),
    dailyRevenueCents: daily.revenueCents,
    dailyCostCents: daily.costCents,
    dailyProfitCents,
    dailyTokenBudgetRemainingCents: Math.max(0, opts.dailyTokenBudgetCents - spentToday),
    runwayTicks,
    etaTicksToTarget,
  };
}

function roiOf(profitCents: number, costCents: number): number {
  return profitCents / Math.max(costCents, 1);
}

function wasPublished(listing: Listing): boolean {
  return listing.publishedAtTick !== undefined || listing.status === 'live' || listing.status === 'delisted';
}

export function computeVentureMetrics(
  venture: Venture,
  entries: readonly LedgerEntry[],
  listings: readonly Listing[],
  tick: number,
  windowTicks: number,
): VentureMetrics {
  const own = entries.filter((e) => e.ventureId === venture.id && e.tick <= tick);
  const lifetime = totalsInWindow(own, Number.NEGATIVE_INFINITY, tick);
  const trailing = totalsInWindow(own, tick - Math.max(1, windowTicks), tick);

  let lastSaleTick: number | null = null;
  for (const entry of own) {
    if (isRevenue(entry) && (lastSaleTick === null || entry.tick > lastSaleTick)) lastSaleTick = entry.tick;
  }

  const ownListings = listings.filter((l) => l.ventureId === venture.id);
  let unitsSold = 0;
  let impressions = 0;
  let clicks = 0;
  for (const listing of ownListings) {
    unitsSold += listing.stats.sales;
    impressions += listing.stats.impressions;
    clicks += listing.stats.clicks;
  }

  const profitCents = lifetime.revenueCents - lifetime.costCents;
  const trailingProfit = trailing.revenueCents - trailing.costCents;
  return {
    revenueCents: lifetime.revenueCents,
    costCents: lifetime.costCents,
    profitCents,
    roi: roiOf(profitCents, lifetime.costCents),
    unitsProduced: ownListings.length,
    unitsPublished: ownListings.filter(wasPublished).length,
    unitsSold,
    impressions,
    clicks,
    conversionRate: unitsSold / Math.max(clicks, 1),
    trailingRevenueCents: trailing.revenueCents,
    trailingCostCents: trailing.costCents,
    trailingRoi: roiOf(trailingProfit, trailing.costCents),
    ticksSinceLastSale: lastSaleTick === null ? null : tick - lastSaleTick,
  };
}

const MILLION_CENTS = 1_000_000_00;
const BILLION_CENTS = 1_000_000_000_00;
const TRILLION_CENTS = 1_000_000_000_000_00;

function withThousands(whole: number): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * "$1,234.56" below one million dollars; "$1.2M", "$1.2B", "$1.0T" above.
 * Negative amounts keep their sign: "-$0.42".
 */
export function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$--';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  if (abs >= TRILLION_CENTS) return `${sign}$${(abs / TRILLION_CENTS).toFixed(1)}T`;
  if (abs >= BILLION_CENTS) return `${sign}$${(abs / BILLION_CENTS).toFixed(1)}B`;
  if (abs >= MILLION_CENTS) return `${sign}$${(abs / MILLION_CENTS).toFixed(1)}M`;
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}$${withThousands(dollars)}.${rem.toString().padStart(2, '0')}`;
}
