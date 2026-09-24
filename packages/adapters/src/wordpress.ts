/**
 * WordPress REST API adapter (affiliate blog).
 *
 * Base: {WORDPRESS_URL}/wp-json/wp/v2  Auth: HTTP Basic with an Application
 * Password (Users > Profile > Application Passwords), sent as
 * `Authorization: Basic base64(user:app-password)`.
 *
 * Endpoints used:
 *   POST   /posts                 create { title, content, status, slug, excerpt, tags[], featured_media }
 *   POST   /posts/{id}            update (WordPress accepts POST/PUT/PATCH)
 *   POST   /media                 upload binary; Content-Disposition: attachment; filename=...
 *   POST   /tags                  create tag by name; 400 term_exists returns data.term_id
 *
 * A blog has no sales: affiliate commissions live in the Amazon Associates /
 * network dashboards, which have no self-serve API. `readSales` returns [].
 *
 * Env: WORDPRESS_URL, WORDPRESS_USER, WORDPRESS_APP_PASSWORD.
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { PLATFORM_FEES } from './fees.js';
import { basicAuth, describeFailure, failure, http, jsonHeaders, pickNumber, pickString } from './http.js';
import type { HttpResult } from './http.js';
import type { AdapterContext, AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { fileName, hasAll, isImageMime, markdownToHtml, slugify } from './util.js';

export const WORDPRESS_REQUIRED_ENV = ['WORDPRESS_URL', 'WORDPRESS_USER', 'WORDPRESS_APP_PASSWORD'] as const;

export const WORDPRESS_TOS_NOTES = [
  'Self-hosted WordPress: automation is unrestricted, but the affiliate networks are not.',
  'Amazon Associates requires a visible disclosure on every page with affiliate links and forbids link cloaking that hides the destination.',
  'Amazon Associates closes accounts with no qualifying sales in the first 180 days; the human owns the account and tax forms.',
  'Google treats scaled AI content built purely for ranking as spam; publish only reviewed, useful articles.',
];

export function wordpressCapability(connected: boolean): PlatformCapability {
  return {
    platform: 'wordpress',
    connected,
    hasApi: true,
    can: { createListing: connected, updateListing: connected, readSales: false, fulfilOrder: false },
    tosNotes: [...WORDPRESS_TOS_NOTES],
    fees: { ...PLATFORM_FEES.wordpress },
  };
}

export function wordpressConnected(env: AdapterContext['env']): boolean {
  return hasAll(env, WORDPRESS_REQUIRED_ENV);
}

export class WordPressAdapter implements PlatformAdapter {
  readonly platform = 'wordpress' as const;
  private readonly baseUrl: string;
  private readonly auth: string;
  private readonly fetchImpl: typeof fetch;
  private readonly connected: boolean;

  constructor(ctx: AdapterContext) {
    this.connected = wordpressConnected(ctx.env);
    this.baseUrl = `${(ctx.env.WORDPRESS_URL ?? '').replace(/\/+$/, '')}/wp-json/wp/v2`;
    this.auth = basicAuth(ctx.env.WORDPRESS_USER ?? '', ctx.env.WORDPRESS_APP_PASSWORD ?? '');
    this.fetchImpl = ctx.fetchImpl;
  }

  capability(): PlatformCapability {
    return wordpressCapability(this.connected);
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    const content = articleHtml(listing, assets);
    if (!content) return failure('wordpress: no article body (attach a text/markdown or text/html asset, or set a description)');

    const featuredMedia = await this.uploadFeaturedImage(assets.find((a) => isImageMime(a.mime) && a.bytes));
    const tagIds = await this.ensureTags(listing.tags);
    const body: Record<string, unknown> = {
      title: listing.title,
      content,
      status: 'publish',
      slug: slugify(listing.title),
      excerpt: listing.description,
      tags: tagIds,
    };
    if (featuredMedia !== undefined) body.featured_media = featuredMedia;

    const res = await this.call('POST', '/posts', body);
    if (!res.ok) return failure(describeFailure('wordpress', 'create post', res));
    return postResult(res);
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    if (!listing.externalId) return failure('wordpress: post has no externalId to update');
    const body: Record<string, unknown> = {};
    if (changes.title !== undefined) body.title = changes.title;
    if (changes.description !== undefined) body.excerpt = changes.description;
    if (changes.tags !== undefined) body.tags = await this.ensureTags(changes.tags);
    if (Object.keys(body).length === 0) return { ok: true, externalId: listing.externalId, url: listing.url };

    const res = await this.call('POST', `/posts/${listing.externalId}`, body);
    if (!res.ok) return failure(describeFailure('wordpress', 'update post', res));
    return postResult(res);
  }

  async delist(listing: Listing): Promise<PublishResult> {
    if (!listing.externalId) return failure('wordpress: post has no externalId to unpublish');
    const res = await this.call('POST', `/posts/${listing.externalId}`, { status: 'draft' });
    if (!res.ok) return failure(describeFailure('wordpress', 'unpublish post', res));
    return { ok: true, externalId: listing.externalId };
  }

  async readSales(_sinceIso: string): Promise<SaleRecord[]> {
    return [];
  }

  private async uploadFeaturedImage(image: AssetFile | undefined): Promise<number | undefined> {
    if (!image || !image.bytes) return undefined;
    const headers = {
      Authorization: this.auth,
      'Content-Type': image.mime,
      'Content-Disposition': `attachment; filename="${fileName(image.path).replace(/"/g, '')}"`,
    };
    const res = await http(this.fetchImpl, `${this.baseUrl}/media`, { method: 'POST', headers, body: image.bytes });
    return res.ok ? pickNumber(res.json, 'id') : undefined;
  }

  /** Resolve tag names to ids, creating missing tags. Tags that fail are skipped, never fatal. */
  private async ensureTags(tags: readonly string[]): Promise<number[]> {
    const ids: number[] = [];
    for (const tag of tags) {
      const id = await this.ensureTag(tag);
      if (id !== undefined) ids.push(id);
    }
    return ids;
  }

  private async ensureTag(name: string): Promise<number | undefined> {
    const res = await this.call('POST', '/tags', { name });
    if (res.ok) return pickNumber(res.json, 'id');
    if (pickString(res.json, 'code') === 'term_exists') return pickNumber(res.json, 'data', 'term_id');
    return undefined;
  }

  private call(method: string, path: string, body: unknown): Promise<HttpResult> {
    const init: RequestInit = { method, headers: jsonHeaders({ Authorization: this.auth }), body: JSON.stringify(body) };
    return http(this.fetchImpl, `${this.baseUrl}${path}`, init);
  }
}

/** Article body: an html asset as-is, a markdown asset converted, else the description as markdown. */
export function articleHtml(listing: Listing, assets: AssetFile[]): string {
  const html = assets.find((a) => a.mime === 'text/html' && a.bytes);
  if (html) return decode(html.bytes!);
  const md = assets.find((a) => (a.mime === 'text/markdown' || a.mime === 'text/plain') && a.bytes);
  if (md) return markdownToHtml(decode(md.bytes!));
  return listing.description.trim() ? markdownToHtml(listing.description) : '';
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function postResult(res: HttpResult): PublishResult {
  const id = pickString(res.json, 'id');
  if (!id) return failure('wordpress: response had no post id');
  const url = pickString(res.json, 'link');
  return url ? { ok: true, externalId: id, url } : { ok: true, externalId: id };
}

export function createWordPressAdapter(ctx: AdapterContext): WordPressAdapter {
  return new WordPressAdapter(ctx);
}
