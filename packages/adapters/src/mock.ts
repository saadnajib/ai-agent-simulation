/**
 * MockAdapter: used for every platform in `sim` mode. It never touches the
 * network. Publishing succeeds instantly with a fake URL; demand and sales are
 * simulated by @eternity/core's market model inside the server, so
 * `readSales` is always empty here.
 */
import type { Listing, Platform, PlatformCapability } from '@eternity/core';
import { PLATFORM_FEES } from './fees.js';
import type { AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';

export const MOCK_BASE_URL = 'https://mock.eternity.local';

export function mockCapability(): PlatformCapability {
  return {
    platform: 'mock',
    connected: true,
    hasApi: true,
    can: { createListing: true, updateListing: true, readSales: true, fulfilOrder: true },
    tosNotes: [
      'Simulated marketplace. Nothing is published anywhere; demand comes from the core market model.',
      'Numbers produced in sim mode are pessimistic estimates, not forecasts.',
    ],
    fees: { ...PLATFORM_FEES.mock },
  };
}

export class MockAdapter implements PlatformAdapter {
  readonly platform: Platform = 'mock';
  /** Listings this adapter has "published", for inspection in tests and the UI. */
  private readonly published = new Map<string, { listing: Listing; assets: string[] }>();

  capability(): PlatformCapability {
    return mockCapability();
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    if (!listing.title.trim()) return { ok: false, error: 'mock: listing title is empty' };
    if (listing.priceCents <= 0) return { ok: false, error: 'mock: price must be positive' };
    const externalId = `mock_${listing.id}`;
    this.published.set(externalId, { listing, assets: assets.map((a) => a.path) });
    return { ok: true, externalId, url: `${MOCK_BASE_URL}/listing/${encodeURIComponent(listing.id)}` };
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    const externalId = listing.externalId ?? `mock_${listing.id}`;
    const current = this.published.get(externalId);
    if (current) this.published.set(externalId, { ...current, listing: { ...current.listing, ...changes } });
    return { ok: true, externalId, url: listing.url ?? `${MOCK_BASE_URL}/listing/${encodeURIComponent(listing.id)}` };
  }

  async delist(listing: Listing): Promise<PublishResult> {
    const externalId = listing.externalId ?? `mock_${listing.id}`;
    this.published.delete(externalId);
    return { ok: true, externalId };
  }

  async readSales(_sinceIso: string): Promise<SaleRecord[]> {
    return [];
  }

  /** Number of listings currently live on the mock market. */
  liveCount(): number {
    return this.published.size;
  }
}

export function createMockAdapter(): MockAdapter {
  return new MockAdapter();
}
