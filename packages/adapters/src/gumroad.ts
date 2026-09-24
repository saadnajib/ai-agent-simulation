/**
 * Gumroad API v2 adapter (digital products: templates, asset packs, music).
 *
 * Base: https://api.gumroad.com/v2  Auth: `Authorization: Bearer <access_token>`.
 *
 * Verified: the public v2 API has NO create-product endpoint (POST /v2/products
 * returns 404; see github.com/antiwork/gumroad issue #4019). Products must be
 * created in the dashboard, so `createListing` always returns a manual payload
 * and `can.createListing` is false even when connected. Editing title, price
 * or files is not exposed either, so `updateListing` is manual too.
 *
 * What the API does support and we use:
 *   PUT    /products/{id}/disable         take a product off sale (delist)
 *   PUT    /products/{id}/enable          put it back on sale
 *   GET    /sales?after=YYYY-MM-DD&page_key=   sales with price + gumroad_fee in cents
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { buildChecklist, buildManualPayload, manualResult } from './draftOnly.js';
import { PLATFORM_FEES } from './fees.js';
import { describeFailure, failure, http, pickArray, pickNumber, pickString } from './http.js';
import type { HttpResult } from './http.js';
import type { AdapterContext, AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { centsToDollars, hasAll, isoToDate, slugify } from './util.js';

export const GUMROAD_BASE_URL = 'https://api.gumroad.com/v2';
export const GUMROAD_REQUIRED_ENV = ['GUMROAD_ACCESS_TOKEN'] as const;
const MAX_SALES_PAGES = 20;

export const GUMROAD_TOS_NOTES = [
  'Gumroad has no public API for creating or editing products; a human creates each product in the dashboard.',
  'Automation is allowed for reading sales, licences and enabling/disabling existing products.',
  'Gumroad charges 10% + $0.50 per sale (plus payment processing on some plans); payouts require a verified human account.',
  'AI-generated content is allowed but must not infringe copyright; buyers can refund within the policy window.',
];

export function gumroadCapability(connected: boolean): PlatformCapability {
  return {
    platform: 'gumroad',
    connected,
    hasApi: true,
    can: { createListing: false, updateListing: false, readSales: connected, fulfilOrder: false },
    tosNotes: [...GUMROAD_TOS_NOTES],
    fees: { ...PLATFORM_FEES.gumroad },
  };
}

export function gumroadConnected(env: AdapterContext['env']): boolean {
  return hasAll(env, GUMROAD_REQUIRED_ENV);
}

export function gumroadListingSteps(listing: Listing, assets: AssetFile[]): string[] {
  const files = (assets.length > 0 ? assets.map((a) => a.path) : listing.assets).join(', ') || '(none)';
  return [
    'Products > New product > Digital product.',
    `Name: ${listing.title}`,
    `Price: $${centsToDollars(listing.priceCents)} (tick "Allow customers to pay what they want" only if the playbook says so).`,
    `Suggested URL slug: ${slugify(listing.title)}`,
    `Content tab: upload ${files}`,
    'Description: paste the "description" field from the payload; add the tags as the first line of the description or as product tags.',
    'Add a cover image (first image in the assets list) and a thumbnail.',
    'Publish, then copy the product id from Settings > Advanced (or the URL) for the Airlock.',
  ];
}

export class GumroadAdapter implements PlatformAdapter {
  readonly platform = 'gumroad' as const;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(ctx: AdapterContext) {
    this.token = ctx.env.GUMROAD_ACCESS_TOKEN ?? '';
    this.fetchImpl = ctx.fetchImpl;
  }

  capability(): PlatformCapability {
    return gumroadCapability(this.token !== '');
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    const payload = buildManualPayload(listing, assets, { action: 'create', slug: slugify(listing.title) });
    return manualResult(buildChecklist('gumroad', gumroadListingSteps(listing, assets)), payload);
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    const steps = [
      listing.url ? `Open ${listing.url} and click Edit.` : `Products > "${listing.title}" > Edit.`,
      'Apply the fields in "changes" from the payload below.',
      'Save changes.',
    ];
    const payload = buildManualPayload(listing, [], { action: 'update', externalId: listing.externalId, changes });
    return manualResult(buildChecklist('gumroad', steps), payload);
  }

  async delist(listing: Listing): Promise<PublishResult> {
    if (!listing.externalId) return failure('gumroad: listing has no externalId to disable');
    const res = await this.call('PUT', `/products/${encodeURIComponent(listing.externalId)}/disable`);
    if (!res.ok) return failure(describeFailure('gumroad', 'disable product', res));
    return { ok: true, externalId: listing.externalId };
  }

  /** Extension: re-enable a product that was disabled by `delist`. */
  async relist(listing: Listing): Promise<PublishResult> {
    if (!listing.externalId) return failure('gumroad: listing has no externalId to enable');
    const res = await this.call('PUT', `/products/${encodeURIComponent(listing.externalId)}/enable`);
    if (!res.ok) return failure(describeFailure('gumroad', 'enable product', res));
    return { ok: true, externalId: listing.externalId, url: pickString(res.json, 'product', 'short_url') ?? listing.url };
  }

  async readSales(sinceIso: string): Promise<SaleRecord[]> {
    const sinceMs = Date.parse(sinceIso);
    const after = isoToDate(sinceIso);
    const sales: SaleRecord[] = [];
    let pageKey: string | undefined;
    for (let page = 0; page < MAX_SALES_PAGES; page += 1) {
      const query = pageKey ? `?after=${after}&page_key=${encodeURIComponent(pageKey)}` : `?after=${after}`;
      const res = await this.call('GET', `/sales${query}`);
      if (!res.ok) break;
      sales.push(...pickArray(res.json, 'sales').map(saleToRecord).filter((s) => keepSince(s, sinceMs)));
      pageKey = pickString(res.json, 'next_page_key');
      if (!pageKey) break;
    }
    return sales;
  }

  private call(method: string, path: string): Promise<HttpResult> {
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    return http(this.fetchImpl, `${GUMROAD_BASE_URL}${path}`, { method, headers });
  }
}

function saleToRecord(sale: unknown): SaleRecord {
  return {
    externalOrderId: pickString(sale, 'id') ?? '',
    listingExternalId: pickString(sale, 'product_id') ?? '',
    units: pickNumber(sale, 'quantity') ?? 1,
    grossCents: Math.round(pickNumber(sale, 'price') ?? 0),
    feeCents: Math.round(pickNumber(sale, 'gumroad_fee') ?? 0),
    occurredAt: pickString(sale, 'created_at') ?? new Date(0).toISOString(),
  };
}

function keepSince(sale: SaleRecord, sinceMs: number): boolean {
  if (!Number.isFinite(sinceMs)) return true;
  const ms = Date.parse(sale.occurredAt);
  return !Number.isFinite(ms) || ms >= sinceMs;
}

export function createGumroadAdapter(ctx: AdapterContext): GumroadAdapter {
  return new GumroadAdapter(ctx);
}
