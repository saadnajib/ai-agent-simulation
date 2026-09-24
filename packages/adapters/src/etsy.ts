/**
 * Etsy Open API v3 adapter.
 *
 * Base: https://openapi.etsy.com/v3/application
 * Auth: `x-api-key: <keystring>` on every call plus `Authorization: Bearer
 * <oauth2 access token>` for shop-scoped calls. Token refresh is the server's
 * job (tokens expire hourly); pass a fresh ETSY_ACCESS_TOKEN in env.
 *
 * Endpoints used:
 *   POST  /shops/{shop}/listings                    createDraftListing (x-www-form-urlencoded)
 *   POST  /shops/{shop}/listings/{id}/images        uploadListingImage (multipart: image, rank)
 *   POST  /shops/{shop}/listings/{id}/files         uploadListingFile (multipart: file, name) for digital listings
 *   PATCH /shops/{shop}/listings/{id}               updateListing (x-www-form-urlencoded; state=active|inactive)
 *   GET   /shops/{shop}/receipts?min_created=&limit= getShopReceipts
 *
 * Env: ETSY_API_KEY, ETSY_ACCESS_TOKEN, ETSY_SHOP_ID (required);
 *      ETSY_TAXONOMY_ID (required to create; category id);
 *      ETSY_SHIPPING_PROFILE_ID + ETSY_READINESS_STATE_ID (physical listings only);
 *      ETSY_RETURN_POLICY_ID (optional); ETSY_WHEN_MADE (default made_to_order).
 *
 * Fees per sale are not in the receipts payload, so `readSales` estimates
 * them from the fee table (6.5% transaction + 3% + $0.25 payment).
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { buildChecklist, buildManualPayload, manualResult } from './draftOnly.js';
import { PLATFORM_FEES, platformFeeCents } from './fees.js';
import { describeFailure, failure, http, pickArray, pickNumber, pickString } from './http.js';
import type { HttpResult } from './http.js';
import type { AdapterContext, AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { centsToDollars, fileName, hasAll, isImageMime, isoToUnixSeconds } from './util.js';

export const ETSY_BASE_URL = 'https://openapi.etsy.com/v3/application';
export const ETSY_REQUIRED_ENV = ['ETSY_API_KEY', 'ETSY_ACCESS_TOKEN', 'ETSY_SHOP_ID'] as const;

const ETSY_MAX_TAGS = 13;
const ETSY_MAX_TAG_LENGTH = 20;

export const ETSY_TOS_NOTES = [
  'The seller of record must be a human who owns the shop; the station acts only as a tool on their behalf.',
  'AI-assisted designs must be disclosed under Etsy Creativity Standards (state your role: designer, producer, sourcer).',
  'One shop per person unless additional shops are disclosed to Etsy; do not open shops on behalf of the venture.',
  'Etsy charges $0.20 per listing activation plus 6.5% transaction and 3% + $0.25 payment processing.',
  'Trademarked characters, brands and celebrity likenesses are removed and can suspend the shop.',
  'API access tokens expire hourly and must be refreshed by the server; never share the keystring.',
];

export function etsyCapability(connected: boolean): PlatformCapability {
  return {
    platform: 'etsy',
    connected,
    hasApi: true,
    can: { createListing: connected, updateListing: connected, readSales: connected, fulfilOrder: false },
    tosNotes: [...ETSY_TOS_NOTES],
    fees: { ...PLATFORM_FEES.etsy },
  };
}

export function etsyConnected(env: AdapterContext['env']): boolean {
  return hasAll(env, ETSY_REQUIRED_ENV);
}

export function etsyListingSteps(listing: Listing, assets: AssetFile[]): string[] {
  const files = (assets.length > 0 ? assets.map((a) => a.path) : listing.assets).join(', ') || '(none)';
  return [
    'Shop Manager > Listings > Add a listing.',
    `Upload photos/mockups: ${files}`,
    `Title (max 140 chars): ${listing.title}`,
    'About this listing: "I designed it" / "Made to order"; tick the AI-assisted disclosure if artwork was generated.',
    `Description: paste the "description" field from the payload.`,
    `Tags (13 max, 20 chars each): ${etsyTags(listing.tags).join(', ')}`,
    `Price: $${centsToDollars(listing.priceCents)}`,
    'Pick the shipping profile (or "Digital files" for downloads) and Publish (Etsy charges $0.20).',
  ];
}

export class EtsyAdapter implements PlatformAdapter {
  readonly platform = 'etsy' as const;
  private readonly env: AdapterContext['env'];
  private readonly fetchImpl: typeof fetch;
  private readonly shopId: string;

  constructor(ctx: AdapterContext) {
    this.env = ctx.env;
    this.fetchImpl = ctx.fetchImpl;
    this.shopId = ctx.env.ETSY_SHOP_ID ?? '';
  }

  capability(): PlatformCapability {
    return etsyCapability(etsyConnected(this.env));
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    const taxonomyId = this.env.ETSY_TAXONOMY_ID;
    if (!taxonomyId) return this.manualFallback(listing, assets, 'ETSY_TAXONOMY_ID is not set; the category id is required by createDraftListing');

    const draft = await this.createDraft(listing, taxonomyId);
    if (!draft.ok) return draft.result;
    const listingId = draft.value;

    const imagesOk = await this.uploadImages(listingId, assets.filter((a) => isImageMime(a.mime) && a.bytes));
    if (!imagesOk.ok) return { ...imagesOk.result, externalId: listingId };

    if (!this.isPhysical()) {
      const filesOk = await this.uploadFiles(listingId, assets.filter((a) => !isImageMime(a.mime) && a.bytes));
      if (!filesOk.ok) return { ...filesOk.result, externalId: listingId };
    }

    const activated = await this.setState(listingId, 'active');
    if (!activated.ok) return { ...failure(describeFailure('etsy', 'activate listing', activated)), externalId: listingId };
    return { ok: true, externalId: listingId, url: pickString(activated.json, 'url') ?? `https://www.etsy.com/listing/${listingId}` };
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    if (!listing.externalId) return failure('etsy: listing has no externalId to update');
    const form = new URLSearchParams();
    if (changes.title !== undefined) form.set('title', changes.title);
    if (changes.description !== undefined) form.set('description', changes.description);
    if (changes.tags !== undefined) form.set('tags', etsyTags(changes.tags).join(','));
    if (changes.priceCents !== undefined) form.set('price', centsToDollars(changes.priceCents));
    if ([...form.keys()].length === 0) return { ok: true, externalId: listing.externalId, url: listing.url };

    const res = await this.form('PATCH', `/shops/${this.shopId}/listings/${listing.externalId}`, form);
    if (!res.ok) return failure(describeFailure('etsy', 'update listing', res));
    return { ok: true, externalId: listing.externalId, url: pickString(res.json, 'url') ?? listing.url };
  }

  async delist(listing: Listing): Promise<PublishResult> {
    if (!listing.externalId) return failure('etsy: listing has no externalId to deactivate');
    const res = await this.setState(listing.externalId, 'inactive');
    if (!res.ok) return failure(describeFailure('etsy', 'deactivate listing', res));
    return { ok: true, externalId: listing.externalId };
  }

  async readSales(sinceIso: string): Promise<SaleRecord[]> {
    const minCreated = isoToUnixSeconds(sinceIso);
    const res = await this.get(`/shops/${this.shopId}/receipts?min_created=${minCreated}&limit=100`);
    if (!res.ok) return [];
    return pickArray(res.json, 'results').flatMap(receiptToSales);
  }

  private async createDraft(listing: Listing, taxonomyId: string): Promise<Step<string>> {
    const form = this.draftForm(listing, taxonomyId);
    const res = await this.form('POST', `/shops/${this.shopId}/listings`, form);
    if (!res.ok) return { ok: false, result: failure(describeFailure('etsy', 'createDraftListing', res)) };
    const id = pickString(res.json, 'listing_id');
    if (!id) return { ok: false, result: failure('etsy: createDraftListing response had no listing_id') };
    return { ok: true, value: id };
  }

  private draftForm(listing: Listing, taxonomyId: string): URLSearchParams {
    const form = new URLSearchParams();
    form.set('quantity', '999');
    form.set('title', listing.title);
    form.set('description', listing.description);
    form.set('price', centsToDollars(listing.priceCents));
    form.set('who_made', 'i_did');
    form.set('when_made', this.env.ETSY_WHEN_MADE ?? 'made_to_order');
    form.set('taxonomy_id', taxonomyId);
    form.set('is_supply', 'false');
    form.set('should_auto_renew', 'false');
    if (listing.tags.length > 0) form.set('tags', etsyTags(listing.tags).join(','));
    if (this.env.ETSY_RETURN_POLICY_ID) form.set('return_policy_id', this.env.ETSY_RETURN_POLICY_ID);
    if (this.isPhysical()) {
      form.set('type', 'physical');
      form.set('shipping_profile_id', this.env.ETSY_SHIPPING_PROFILE_ID!);
      if (this.env.ETSY_READINESS_STATE_ID) form.set('readiness_state_id', this.env.ETSY_READINESS_STATE_ID);
    } else {
      form.set('type', 'download');
    }
    return form;
  }

  private async uploadImages(listingId: string, images: AssetFile[]): Promise<Step<void>> {
    let rank = 1;
    for (const image of images) {
      const body = new FormData();
      body.set('image', new Blob([image.bytes!], { type: image.mime }), fileName(image.path));
      body.set('rank', String(rank));
      const res = await this.multipart(`/shops/${this.shopId}/listings/${listingId}/images`, body);
      if (!res.ok) return { ok: false, result: failure(describeFailure('etsy', `upload image ${fileName(image.path)}`, res)) };
      rank += 1;
    }
    return { ok: true, value: undefined };
  }

  private async uploadFiles(listingId: string, files: AssetFile[]): Promise<Step<void>> {
    for (const file of files) {
      const body = new FormData();
      body.set('file', new Blob([file.bytes!], { type: file.mime }), fileName(file.path));
      body.set('name', fileName(file.path));
      const res = await this.multipart(`/shops/${this.shopId}/listings/${listingId}/files`, body);
      if (!res.ok) return { ok: false, result: failure(describeFailure('etsy', `upload file ${fileName(file.path)}`, res)) };
    }
    return { ok: true, value: undefined };
  }

  private setState(listingId: string, state: 'active' | 'inactive'): Promise<HttpResult> {
    const form = new URLSearchParams({ state });
    return this.form('PATCH', `/shops/${this.shopId}/listings/${listingId}`, form);
  }

  private manualFallback(listing: Listing, assets: AssetFile[], reason: string): PublishResult {
    const instructions = buildChecklist('etsy', etsyListingSteps(listing, assets));
    return manualResult(instructions, buildManualPayload(listing, assets, { action: 'create' }), `etsy: ${reason}`);
  }

  private isPhysical(): boolean {
    return Boolean(this.env.ETSY_SHIPPING_PROFILE_ID);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'x-api-key': this.env.ETSY_API_KEY ?? '',
      Authorization: `Bearer ${this.env.ETSY_ACCESS_TOKEN ?? ''}`,
      Accept: 'application/json',
      ...extra,
    };
  }

  private form(method: string, path: string, form: URLSearchParams): Promise<HttpResult> {
    const headers = this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
    return http(this.fetchImpl, `${ETSY_BASE_URL}${path}`, { method, headers, body: form.toString() });
  }

  private multipart(path: string, body: FormData): Promise<HttpResult> {
    return http(this.fetchImpl, `${ETSY_BASE_URL}${path}`, { method: 'POST', headers: this.headers(), body });
  }

  private get(path: string): Promise<HttpResult> {
    return http(this.fetchImpl, `${ETSY_BASE_URL}${path}`, { method: 'GET', headers: this.headers() });
  }
}

type Step<T> = { ok: true; value: T } | { ok: false; result: PublishResult };

/** Etsy allows 13 tags of 20 characters; trim rather than fail. */
export function etsyTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const clean = tag.trim().slice(0, ETSY_MAX_TAG_LENGTH);
    if (clean === '' || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    out.push(clean);
    if (out.length === ETSY_MAX_TAGS) break;
  }
  return out;
}

function receiptToSales(receipt: unknown): SaleRecord[] {
  const receiptId = pickString(receipt, 'receipt_id') ?? '';
  const created = pickNumber(receipt, 'created_timestamp') ?? pickNumber(receipt, 'create_timestamp') ?? 0;
  const occurredAt = new Date(created * 1000).toISOString();
  const transactions = pickArray(receipt, 'transactions');
  return transactions.map((tx) => {
    const units = pickNumber(tx, 'quantity') ?? 1;
    const grossCents = moneyToCents(tx) * units;
    return {
      externalOrderId: pickString(tx, 'transaction_id') ? `${receiptId}:${pickString(tx, 'transaction_id')}` : receiptId,
      listingExternalId: pickString(tx, 'listing_id') ?? '',
      units,
      grossCents,
      feeCents: platformFeeCents('etsy', grossCents),
      occurredAt,
    };
  });
}

function moneyToCents(tx: unknown): number {
  const amount = pickNumber(tx, 'price', 'amount') ?? 0;
  const divisor = pickNumber(tx, 'price', 'divisor') ?? 100;
  return divisor > 0 ? Math.round((amount / divisor) * 100) : 0;
}

export function createEtsyAdapter(ctx: AdapterContext): EtsyAdapter {
  return new EtsyAdapter(ctx);
}
