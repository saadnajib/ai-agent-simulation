/**
 * Printify REST API v1 adapter (print-on-demand fulfilment).
 *
 * Base: https://api.printify.com/v1  Auth: `Authorization: Bearer <token>`.
 * Printify is explicitly built for automation, so the whole product lifecycle
 * can run without a human once the shop is connected to a sales channel
 * (usually Etsy). Publishing pushes the product to that channel.
 *
 * Endpoints used (verified against the public reference where the network
 * allowed; anything marked UNVERIFIED is our best reading of the docs):
 *   POST   /uploads/images.json                              { file_name, contents(base64) | url }
 *   GET    /catalog/blueprints/{bp}/print_providers/{pp}/variants.json
 *   POST   /shops/{shop}/products.json                        create product
 *   POST   /shops/{shop}/products/{id}/publish.json           { title, description, images, variants, tags, keyFeatures, shipping_template }
 *   PUT    /shops/{shop}/products/{id}.json                   update product
 *   POST   /shops/{shop}/products/{id}/unpublish.json         unpublish
 *   GET    /shops/{shop}/orders.json?limit=&page=             orders (newest first)
 *
 * Env: PRINTIFY_API_TOKEN, PRINTIFY_SHOP_ID (required),
 *      PRINTIFY_BLUEPRINT_ID (default 6, Gildan 5000 unisex tee),
 *      PRINTIFY_PRINT_PROVIDER_ID (default 99, Printify Choice),
 *      PRINTIFY_MAX_VARIANTS (default 12).
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { PLATFORM_FEES } from './fees.js';
import { describeFailure, failure, http, jsonHeaders, pickArray, pickNumber, pickString } from './http.js';
import type { HttpResult } from './http.js';
import type { AdapterContext, AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { envNumber, fileName, hasAll, isImageMime, toBase64 } from './util.js';

export const PRINTIFY_BASE_URL = 'https://api.printify.com/v1';
export const PRINTIFY_REQUIRED_ENV = ['PRINTIFY_API_TOKEN', 'PRINTIFY_SHOP_ID'] as const;

const DEFAULT_BLUEPRINT_ID = 6;
const DEFAULT_PRINT_PROVIDER_ID = 99;
const DEFAULT_MAX_VARIANTS = 12;

export const PRINTIFY_TOS_NOTES = [
  'Printify permits API automation of product creation, publishing and order handling.',
  'Printify only fulfils: the storefront (usually Etsy) has its own seller-of-record and disclosure rules.',
  'Uploaded artwork must be yours to use commercially; trademarked or celebrity content gets products removed.',
  'Base cost per unit is charged when an order is placed; keep listing price above base cost plus channel fees.',
];

export function printifyCapability(connected: boolean): PlatformCapability {
  return {
    platform: 'printify',
    connected,
    hasApi: true,
    can: { createListing: connected, updateListing: connected, readSales: connected, fulfilOrder: connected },
    tosNotes: [...PRINTIFY_TOS_NOTES],
    fees: { ...PLATFORM_FEES.printify },
  };
}

export function printifyConnected(env: AdapterContext['env']): boolean {
  return hasAll(env, PRINTIFY_REQUIRED_ENV);
}

interface UploadedImage {
  id: string;
  fileName: string;
}

export class PrintifyAdapter implements PlatformAdapter {
  readonly platform = 'printify' as const;
  private readonly token: string;
  private readonly shopId: string;
  private readonly blueprintId: number;
  private readonly printProviderId: number;
  private readonly maxVariants: number;
  private readonly fetchImpl: typeof fetch;

  constructor(ctx: AdapterContext) {
    this.token = ctx.env.PRINTIFY_API_TOKEN ?? '';
    this.shopId = ctx.env.PRINTIFY_SHOP_ID ?? '';
    this.blueprintId = envNumber(ctx.env, 'PRINTIFY_BLUEPRINT_ID') ?? DEFAULT_BLUEPRINT_ID;
    this.printProviderId = envNumber(ctx.env, 'PRINTIFY_PRINT_PROVIDER_ID') ?? DEFAULT_PRINT_PROVIDER_ID;
    this.maxVariants = envNumber(ctx.env, 'PRINTIFY_MAX_VARIANTS') ?? DEFAULT_MAX_VARIANTS;
    this.fetchImpl = ctx.fetchImpl;
  }

  capability(): PlatformCapability {
    return printifyCapability(this.token !== '' && this.shopId !== '');
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    const images = assets.filter((a) => isImageMime(a.mime) && a.bytes && a.bytes.length > 0);
    if (images.length === 0) return failure('printify: createListing needs at least one image asset with bytes');

    const uploaded = await this.uploadImages(images);
    if (!uploaded.ok) return uploaded.result;

    const variantIds = await this.fetchVariantIds();
    if (!variantIds.ok) return variantIds.result;

    const created = await this.createProduct(listing, uploaded.value, variantIds.value);
    if (!created.ok) return created.result;

    const published = await this.publishProduct(created.value.id);
    if (!published.ok) return { ...published.result, externalId: created.value.id };

    return { ok: true, externalId: created.value.id, url: created.value.url };
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    if (!listing.externalId) return failure('printify: listing has no externalId to update');
    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body.title = changes.title;
    if (changes.description !== undefined) body.description = changes.description;
    if (changes.tags !== undefined) body.tags = changes.tags;
    if (Object.keys(body).length === 0) return { ok: true, externalId: listing.externalId, url: listing.url };

    const res = await this.call('PUT', `/shops/${this.shopId}/products/${listing.externalId}.json`, body);
    if (!res.ok) return failure(describeFailure('printify', 'update product', res));
    return { ok: true, externalId: listing.externalId, url: listing.url };
  }

  async delist(listing: Listing): Promise<PublishResult> {
    if (!listing.externalId) return failure('printify: listing has no externalId to unpublish');
    const res = await this.call('POST', `/shops/${this.shopId}/products/${listing.externalId}/unpublish.json`, {});
    if (!res.ok) return failure(describeFailure('printify', 'unpublish product', res));
    return { ok: true, externalId: listing.externalId };
  }

  async readSales(sinceIso: string): Promise<SaleRecord[]> {
    const since = Date.parse(sinceIso);
    const res = await this.call('GET', `/shops/${this.shopId}/orders.json?limit=100`);
    if (!res.ok) return [];
    const orders = pickArray(res.json, 'data');
    const sales: SaleRecord[] = [];
    for (const order of orders) {
      const createdAt = pickString(order, 'created_at') ?? '';
      const createdMs = Date.parse(createdAt);
      if (Number.isFinite(since) && Number.isFinite(createdMs) && createdMs < since) continue;
      sales.push(...orderToSales(order, createdAt));
    }
    return sales;
  }

  private async uploadImages(images: AssetFile[]): Promise<Step<UploadedImage[]>> {
    const uploaded: UploadedImage[] = [];
    for (const image of images) {
      const body = { file_name: fileName(image.path), contents: toBase64(image.bytes!) };
      const res = await this.call('POST', '/uploads/images.json', body);
      if (!res.ok) return { ok: false, result: failure(describeFailure('printify', `upload ${fileName(image.path)}`, res)) };
      const id = pickString(res.json, 'id');
      if (!id) return { ok: false, result: failure('printify: upload response had no image id') };
      uploaded.push({ id, fileName: fileName(image.path) });
    }
    return { ok: true, value: uploaded };
  }

  private async fetchVariantIds(): Promise<Step<number[]>> {
    const path = `/catalog/blueprints/${this.blueprintId}/print_providers/${this.printProviderId}/variants.json`;
    const res = await this.call('GET', path);
    if (!res.ok) return { ok: false, result: failure(describeFailure('printify', 'fetch catalog variants', res)) };
    const ids = pickArray(res.json, 'variants')
      .map((v) => pickNumber(v, 'id'))
      .filter((id): id is number => id !== undefined)
      .slice(0, this.maxVariants);
    if (ids.length === 0) return { ok: false, result: failure('printify: catalog returned no variants for the configured blueprint/provider') };
    return { ok: true, value: ids };
  }

  private async createProduct(listing: Listing, images: UploadedImage[], variantIds: number[]): Promise<Step<{ id: string; url?: string }>> {
    const body = buildProductBody(listing, images, variantIds, this.blueprintId, this.printProviderId);
    const res = await this.call('POST', `/shops/${this.shopId}/products.json`, body);
    if (!res.ok) return { ok: false, result: failure(describeFailure('printify', 'create product', res)) };
    const id = pickString(res.json, 'id');
    if (!id) return { ok: false, result: failure('printify: create product response had no id') };
    const url = pickString(res.json, 'external', 'handle');
    return { ok: true, value: url ? { id, url } : { id } };
  }

  private async publishProduct(productId: string): Promise<Step<void>> {
    const flags = { title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true };
    const res = await this.call('POST', `/shops/${this.shopId}/products/${productId}/publish.json`, flags);
    if (!res.ok) return { ok: false, result: failure(describeFailure('printify', 'publish product', res)) };
    return { ok: true, value: undefined };
  }

  private call(method: string, path: string, body?: unknown): Promise<HttpResult> {
    const init: RequestInit = { method, headers: jsonHeaders({ Authorization: `Bearer ${this.token}` }) };
    if (body !== undefined) init.body = JSON.stringify(body);
    return http(this.fetchImpl, `${PRINTIFY_BASE_URL}${path}`, init);
  }
}

type Step<T> = { ok: true; value: T } | { ok: false; result: PublishResult };

export function buildProductBody(
  listing: Listing,
  images: UploadedImage[],
  variantIds: number[],
  blueprintId: number,
  printProviderId: number,
): Record<string, unknown> {
  const front = images[0]!;
  return {
    title: listing.title,
    description: listing.description,
    tags: listing.tags,
    blueprint_id: blueprintId,
    print_provider_id: printProviderId,
    variants: variantIds.map((id) => ({ id, price: listing.priceCents, is_enabled: true })),
    print_areas: [
      {
        variant_ids: variantIds,
        placeholders: [{ position: 'front', images: [{ id: front.id, x: 0.5, y: 0.5, scale: 1, angle: 0 }] }],
      },
    ],
  };
}

function orderToSales(order: unknown, occurredAt: string): SaleRecord[] {
  const orderId = pickString(order, 'id') ?? '';
  const items = pickArray(order, 'line_items');
  return items.map((item, index) => {
    const units = pickNumber(item, 'quantity') ?? 1;
    const unitPrice = pickNumber(item, 'metadata', 'price') ?? 0;
    const cost = pickNumber(item, 'cost') ?? 0;
    const shipping = pickNumber(item, 'shipping_cost') ?? 0;
    return {
      externalOrderId: items.length > 1 ? `${orderId}#${index}` : orderId,
      listingExternalId: pickString(item, 'product_id') ?? '',
      units,
      grossCents: Math.round(unitPrice * units),
      feeCents: 0,
      fulfilmentCents: Math.round(cost * units + shipping),
      occurredAt,
    };
  });
}

export function createPrintifyAdapter(ctx: AdapterContext): PrintifyAdapter {
  return new PrintifyAdapter(ctx);
}
