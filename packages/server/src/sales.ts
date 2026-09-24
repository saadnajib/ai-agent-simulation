/**
 * Revenue: the simulated market in sim mode, adapter polling in live mode.
 * Every sale becomes ledger entries (revenue, platform fee, fulfilment cost,
 * refund) plus a `sale` event for the game to float over the room.
 */
import type { Listing, MarketModel, SaleEvent } from '@eternity/core';
import { KIND_ECONOMICS, type KindEconomics, type VentureKind } from '@eternity/core';
import type { AdapterRegistry } from '@eternity/adapters';
import type { World } from './state.js';

export const LIVE_POLL_INTERVAL_TICKS = 60;

/** Overrides that scale baseline impressions for every kind (sim only, labelled in the HUD). */
export function demandOverrides(multiplier: number): Partial<Record<VentureKind, Partial<KindEconomics>>> {
  const overrides: Partial<Record<VentureKind, Partial<KindEconomics>>> = {};
  for (const kind of Object.keys(KIND_ECONOMICS) as VentureKind[]) {
    overrides[kind] = { baseDailyImpressions: KIND_ECONOMICS[kind].baseDailyImpressions * multiplier };
  }
  return overrides;
}

function producerOf(world: World, listingId: string): string | undefined {
  for (const task of world.tasks.values()) {
    if (task.output?.data['listingId'] === listingId && task.assignedTo) return task.assignedTo;
  }
  return undefined;
}

function bookSale(world: World, listing: Listing, sale: Omit<SaleEvent, 'listingId' | 'ventureId' | 'platform' | 'tick'>, memoPrefix: string): void {
  const refs = { ventureId: listing.ventureId, listingId: listing.id } as const;
  world.record({ kind: 'revenue', amountCents: sale.grossCents, memo: `${memoPrefix}: ${sale.units} x "${listing.title}"`, ...refs });
  if (sale.feeCents > 0) world.record({ kind: 'platform-fee', amountCents: -sale.feeCents, memo: `${listing.platform} fees on "${listing.title}"`, ...refs });
  if (sale.fulfilmentCents > 0) world.record({ kind: 'fulfilment-cost', amountCents: -sale.fulfilmentCents, memo: `fulfilment for "${listing.title}"`, ...refs });
  if (sale.refundCents > 0) world.record({ kind: 'refund', amountCents: -sale.refundCents, memo: `${sale.refundedUnits} refund(s) on "${listing.title}"`, ...refs });

  listing.stats.sales += sale.units;
  listing.stats.revenueCents += sale.grossCents;
  world.putListing(listing);

  const producer = producerOf(world, listing.id);
  if (producer) {
    const agent = world.agents.get(producer);
    if (agent) {
      agent.stats.revenueAttributedCents += sale.netCents;
      world.putAgent(agent, false);
    }
  }
  world.bus.emit({
    type: 'sale',
    ventureId: listing.ventureId,
    listingId: listing.id,
    platform: listing.platform,
    grossCents: sale.grossCents,
    netCents: sale.netCents,
    itemTitle: listing.title,
    tick: world.tick,
  });
}

/** One market tick over live listings. Returns the sales booked. */
export function simulateSales(world: World, market: MarketModel): SaleEvent[] {
  const live = [...world.listings.values()].filter((l) => l.status === 'live');
  if (live.length === 0) return [];
  const result = market.simulateTick(live, world.tick, world.rng('market'));
  for (const listing of live) {
    const impressions = result.impressions[listing.id] ?? 0;
    const clicks = result.clicks[listing.id] ?? 0;
    if (impressions === 0 && clicks === 0) continue;
    listing.stats.impressions += impressions;
    listing.stats.clicks += clicks;
    // Impression-only changes persist quietly; clicks and sales are worth a frame.
    world.putListing(listing, clicks > 0);
  }
  for (const sale of result.sales) {
    const listing = world.listings.get(sale.listingId);
    if (!listing) continue;
    bookSale(world, listing, sale, 'sim sale');
  }
  return result.sales;
}

/** Polls every connected platform for sales since the last poll. */
export async function pollLiveSales(world: World, registry: AdapterRegistry, seenOrders: Set<string>, sinceIso: string): Promise<number> {
  const byExternal = new Map<string, Listing>();
  const platforms = new Set<Listing['platform']>();
  for (const listing of world.listings.values()) {
    if (listing.status !== 'live') continue;
    platforms.add(listing.platform);
    if (listing.externalId) byExternal.set(`${listing.platform}:${listing.externalId}`, listing);
  }
  let booked = 0;
  for (const platform of platforms) {
    const adapter = registry.get(platform);
    if (!adapter.capability().can.readSales) continue;
    let records;
    try {
      records = await adapter.readSales(sinceIso);
    } catch (error) {
      world.log('warn', `readSales failed for ${platform}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const record of records) {
      const key = `${platform}:${record.externalOrderId}`;
      if (seenOrders.has(key)) continue;
      const listing = byExternal.get(`${platform}:${record.listingExternalId}`);
      if (!listing) continue;
      seenOrders.add(key);
      const fulfilmentCents = record.fulfilmentCents ?? record.units * listing.unitCostCents;
      bookSale(
        world,
        listing,
        { units: record.units, grossCents: record.grossCents, feeCents: record.feeCents, fulfilmentCents, refundCents: 0, refundedUnits: 0, netCents: record.grossCents - record.feeCents - fulfilmentCents },
        `${platform} order ${record.externalOrderId}`,
      );
      booked++;
    }
  }
  return booked;
}
