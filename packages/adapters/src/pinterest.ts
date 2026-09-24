/**
 * Pinterest API v5 adapter (promotion channel, not a sales channel).
 *
 * Base: https://api.pinterest.com/v5  Auth: `Authorization: Bearer <token>`
 * with the `pins:write` and `boards:read` scopes.
 *
 * Endpoints used:
 *   POST   /pins        { board_id, title, description, link, alt_text, media_source: { source_type: 'image_base64', content_type, data } }
 *   PATCH  /pins/{id}   { title, description }
 *   DELETE /pins/{id}
 *
 * UNVERIFIED: exact field list of the create-pin body follows the v5 docs as
 * of 2025; `image_base64` is the documented way to send bytes directly.
 * Without PINTEREST_ACCESS_TOKEN + PINTEREST_BOARD_ID the adapter is manual.
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { buildChecklist, buildManualPayload, manualResult } from './draftOnly.js';
import { PLATFORM_FEES } from './fees.js';
import { describeFailure, failure, http, jsonHeaders, pickString } from './http.js';
import type { HttpResult } from './http.js';
import type { AdapterContext, AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { hasAll, isImageMime, toBase64 } from './util.js';

export const PINTEREST_BASE_URL = 'https://api.pinterest.com/v5';
export const PINTEREST_REQUIRED_ENV = ['PINTEREST_ACCESS_TOKEN', 'PINTEREST_BOARD_ID'] as const;

export const PINTEREST_TOS_NOTES = [
  'Pinterest allows API posting from an approved developer app; spammy repetitive pins get accounts limited.',
  'Affiliate links are allowed but must be disclosed and must not be cloaked; keep pin descriptions honest.',
  'Pinterest is a traffic source, not a store: revenue is attributed to the linked listing, never to the pin.',
];

export function pinterestCapability(connected: boolean): PlatformCapability {
  return {
    platform: 'pinterest',
    connected,
    hasApi: true,
    can: { createListing: connected, updateListing: connected, readSales: false, fulfilOrder: false },
    tosNotes: [...PINTEREST_TOS_NOTES],
    fees: { ...PLATFORM_FEES.pinterest },
  };
}

export function pinterestConnected(env: AdapterContext['env']): boolean {
  return hasAll(env, PINTEREST_REQUIRED_ENV);
}

export function pinterestPinSteps(listing: Listing, assets: AssetFile[]): string[] {
  const image = assets.find((a) => isImageMime(a.mime))?.path ?? listing.assets[0] ?? '(no image)';
  return [
    'Create > Create Pin.',
    `Upload image (2:3 ratio works best): ${image}`,
    `Title: ${listing.title}`,
    'Description: paste the "description" field and add #tags from the payload.',
    `Destination link: ${listing.url ?? '(the live listing URL)'}`,
    'Pick the venture board and Publish.',
  ];
}

export class PinterestAdapter implements PlatformAdapter {
  readonly platform = 'pinterest' as const;
  private readonly token: string;
  private readonly boardId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(ctx: AdapterContext) {
    this.token = ctx.env.PINTEREST_ACCESS_TOKEN ?? '';
    this.boardId = ctx.env.PINTEREST_BOARD_ID ?? '';
    this.fetchImpl = ctx.fetchImpl;
  }

  capability(): PlatformCapability {
    return pinterestCapability(this.token !== '' && this.boardId !== '');
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    if (!this.capability().connected) return this.manual(listing, assets);
    const image = assets.find((a) => isImageMime(a.mime) && a.bytes && a.bytes.length > 0);
    if (!image) return this.manual(listing, assets, 'pinterest: a pin needs an image asset with bytes');

    const body = {
      board_id: this.boardId,
      title: listing.title.slice(0, 100),
      description: [listing.description, listing.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ')].join('\n\n').slice(0, 800),
      alt_text: listing.title.slice(0, 500),
      ...(listing.url ? { link: listing.url } : {}),
      media_source: { source_type: 'image_base64', content_type: image.mime, data: toBase64(image.bytes!) },
    };
    const res = await this.call('POST', '/pins', body);
    if (!res.ok) return failure(describeFailure('pinterest', 'create pin', res));
    const id = pickString(res.json, 'id');
    if (!id) return failure('pinterest: create pin response had no id');
    return { ok: true, externalId: id, url: `https://www.pinterest.com/pin/${id}/` };
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    if (!listing.externalId) return failure('pinterest: pin has no externalId to update');
    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body.title = changes.title.slice(0, 100);
    if (changes.description !== undefined) body.description = changes.description.slice(0, 800);
    if (Object.keys(body).length === 0) return { ok: true, externalId: listing.externalId, url: listing.url };
    const res = await this.call('PATCH', `/pins/${listing.externalId}`, body);
    if (!res.ok) return failure(describeFailure('pinterest', 'update pin', res));
    return { ok: true, externalId: listing.externalId, url: listing.url };
  }

  async delist(listing: Listing): Promise<PublishResult> {
    if (!listing.externalId) return failure('pinterest: pin has no externalId to delete');
    const res = await this.call('DELETE', `/pins/${listing.externalId}`);
    if (!res.ok) return failure(describeFailure('pinterest', 'delete pin', res));
    return { ok: true, externalId: listing.externalId };
  }

  async readSales(_sinceIso: string): Promise<SaleRecord[]> {
    return [];
  }

  private manual(listing: Listing, assets: AssetFile[], error?: string): PublishResult {
    return manualResult(buildChecklist('pinterest', pinterestPinSteps(listing, assets)), buildManualPayload(listing, assets, { action: 'create' }), error);
  }

  private call(method: string, path: string, body?: unknown): Promise<HttpResult> {
    const init: RequestInit = { method, headers: jsonHeaders({ Authorization: `Bearer ${this.token}` }) };
    if (body !== undefined) init.body = JSON.stringify(body);
    return http(this.fetchImpl, `${PINTEREST_BASE_URL}${path}`, init);
  }
}

export function createPinterestAdapter(ctx: AdapterContext): PinterestAdapter {
  return new PinterestAdapter(ctx);
}
