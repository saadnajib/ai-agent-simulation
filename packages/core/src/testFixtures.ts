/**
 * Small builders for tests. Not exported from the package index.
 */
import type {
  AllocationPolicy,
  LedgerEntry,
  Listing,
  StationState,
  Venture,
  VentureKind,
  VentureMetrics,
  VentureStatus,
} from './types.js';
import { DEFAULT_POLICY } from './allocation.js';
import { computeTreasury } from './ledger.js';
import { tickToSimTime } from './simTime.js';
import { PLAYBOOKS } from './playbooks.js';

export function emptyMetrics(overrides: Partial<VentureMetrics> = {}): VentureMetrics {
  return {
    revenueCents: 0,
    costCents: 0,
    profitCents: 0,
    roi: 0,
    unitsProduced: 0,
    unitsPublished: 3,
    unitsSold: 0,
    impressions: 0,
    clicks: 0,
    conversionRate: 0,
    trailingRevenueCents: 0,
    trailingCostCents: 0,
    trailingRoi: 0,
    ticksSinceLastSale: null,
    ...overrides,
  };
}

export interface VentureOverrides {
  id?: string;
  kind?: VentureKind;
  name?: string;
  thesis?: string;
  status?: VentureStatus;
  createdAtTick?: number;
  metrics?: Partial<VentureMetrics>;
}

export function makeVenture(o: VentureOverrides = {}): Venture {
  const kind = o.kind ?? 'pod-store';
  return {
    id: o.id ?? `ven_${kind}`,
    kind,
    name: o.name ?? `Test ${kind}`,
    thesis: o.thesis ?? 'test thesis',
    roomId: PLAYBOOKS[kind].roomId,
    status: o.status ?? 'active',
    createdAtTick: o.createdAtTick ?? 0,
    budgetShare: 0,
    crew: [],
    storefronts: [],
    metrics: emptyMetrics(o.metrics),
  };
}

export interface ListingOverrides {
  id?: string;
  ventureId?: string;
  platform?: Listing['platform'];
  kind?: VentureKind;
  quality?: number;
  niche?: string;
  status?: Listing['status'];
  priceCents?: number;
  unitCostCents?: number;
  createdAtTick?: number;
  publishedAtTick?: number;
  stats?: Partial<Listing['stats']>;
}

export function makeListing(o: ListingOverrides = {}): Listing {
  return {
    id: o.id ?? 'lst_1',
    ventureId: o.ventureId ?? 'ven_1',
    storefrontId: 'sf_1',
    platform: o.platform ?? 'etsy',
    title: 'Test listing',
    description: 'A test listing',
    tags: ['test'],
    priceCents: o.priceCents ?? 2499,
    unitCostCents: o.unitCostCents ?? 1600,
    quality: o.quality ?? 0.8,
    niche: o.niche ?? 'test niche',
    kind: o.kind,
    status: o.status ?? 'live',
    createdAtTick: o.createdAtTick ?? 0,
    publishedAtTick: 'publishedAtTick' in o ? o.publishedAtTick : (o.createdAtTick ?? 0),
    assets: [],
    stats: { impressions: 0, clicks: 0, sales: 0, revenueCents: 0, ...(o.stats ?? {}) },
  };
}

let entrySeq = 0;

export function makeEntry(
  tick: number,
  kind: LedgerEntry['kind'],
  amountCents: number,
  ventureId?: string,
): LedgerEntry {
  entrySeq++;
  return {
    id: `led_${entrySeq}`,
    tick,
    ts: tickToSimTime(tick),
    kind,
    amountCents,
    ventureId,
    memo: `${kind} ${amountCents}`,
    source: 'sim',
  };
}

export function makeState(
  ventures: Venture[],
  tick: number,
  policy: Partial<AllocationPolicy> = {},
): StationState {
  const fullPolicy = { ...DEFAULT_POLICY, ...policy };
  return {
    mode: 'sim',
    clock: { tick, simTime: tickToSimTime(tick), paused: false, speed: 1 },
    treasury: computeTreasury([], tick, { targetCents: 1e14, dailyTokenBudgetCents: 500 }),
    policy: fullPolicy,
    ventures,
    agents: [],
    tasks: [],
    listings: [],
    approvals: [],
    ledger: [],
    directives: [],
  };
}
