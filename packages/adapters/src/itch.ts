/**
 * itch.io adapter (game asset packs).
 *
 * itch.io has a server-side API (https://itch.io/api/1/...) but it is built
 * for purchase verification and stats, not for publishing:
 *   - project pages are created in the dashboard by a human;
 *   - files are uploaded with the `butler` CLI (`butler push`), which is the
 *     supported automation path and is what `createListing` hands back;
 *   - `/game/{id}/purchases` requires a buyer email or user_id, so there is no
 *     "list every sale" endpoint. `readSales` therefore returns [] and
 *     `readGameStats` exposes the aggregate counters from `/my-games`.
 *
 * Auth: `Authorization: Bearer <api key>` against https://itch.io/api/1/key/...
 * (the legacy form puts the key in the path; the header form keeps it out of
 * logs). UNVERIFIED: field names of `/my-games` (purchases_count, views_count,
 * downloads_count, earnings[]) follow the public reference as of 2025.
 *
 * Env: ITCH_API_KEY (optional, enables stats), ITCH_USERNAME (used in the
 * butler push target), ITCH_CHANNEL (default "assets").
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { buildChecklist, buildManualPayload, manualResult } from './draftOnly.js';
import { PLATFORM_FEES } from './fees.js';
import { http, pickArray, pickNumber, pickString } from './http.js';
import type { AdapterContext, AssetFile, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { centsToDollars, hasAll, slugify } from './util.js';

export const ITCH_BASE_URL = 'https://itch.io/api/1/key';
export const ITCH_REQUIRED_ENV = ['ITCH_API_KEY'] as const;

export const ITCH_TOS_NOTES = [
  'Project pages must be created by the human account owner in the itch.io dashboard; there is no create-project API.',
  'File uploads are automated with the butler CLI (butler push), which itch.io supports and documents.',
  'itch.io takes a configurable revenue share (default 10%) and pays out to a verified human account.',
  'Asset packs must state the licence clearly; AI-generated content must be tagged as such per itch.io policy.',
  'Sales cannot be listed per order through the API; only per-game aggregate counters are available.',
];

export function itchCapability(connected: boolean): PlatformCapability {
  return {
    platform: 'itch',
    connected,
    hasApi: true,
    can: { createListing: false, updateListing: false, readSales: false, fulfilOrder: false },
    tosNotes: [...ITCH_TOS_NOTES],
    fees: { ...PLATFORM_FEES.itch },
  };
}

export function itchConnected(env: AdapterContext['env']): boolean {
  return hasAll(env, ITCH_REQUIRED_ENV);
}

export interface ItchGameStats {
  gameId: string;
  title: string;
  url?: string;
  published: boolean;
  purchases: number;
  views: number;
  downloads: number;
  earningsCents: number;
}

export function butlerPushCommand(listing: Listing, username: string, channel: string): string {
  const slug = slugify(listing.title);
  return `butler push ./dist/${slug} ${username}/${slug}:${channel}`;
}

export class ItchAdapter implements PlatformAdapter {
  readonly platform = 'itch' as const;
  private readonly apiKey: string;
  private readonly username: string;
  private readonly channel: string;
  private readonly fetchImpl: typeof fetch;

  constructor(ctx: AdapterContext) {
    this.apiKey = ctx.env.ITCH_API_KEY ?? '';
    this.username = ctx.env.ITCH_USERNAME ?? '<your-itch-username>';
    this.channel = ctx.env.ITCH_CHANNEL ?? 'assets';
    this.fetchImpl = ctx.fetchImpl;
  }

  capability(): PlatformCapability {
    return itchCapability(this.apiKey !== '');
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    const slug = slugify(listing.title);
    const push = butlerPushCommand(listing, this.username, this.channel);
    const files = (assets.length > 0 ? assets.map((a) => a.path) : listing.assets).join(', ') || '(none)';
    const steps = [
      `Dashboard > Create new project. Title: ${listing.title}; Project URL: ${slug}; Classification: Assets; Kind: Downloadable.`,
      `Pricing: Paid, $${centsToDollars(listing.priceCents)} (or "$0 or donate" if the playbook says free-with-tips).`,
      `Description: paste the "description" field; Tags: ${listing.tags.join(', ') || '(none)'}; tick "AI generated" disclosure if applicable.`,
      'Save as Draft, then install butler (https://itch.io/docs/butler/) and run `butler login` once.',
      `Zip the pack from the workspace (${files}) into ./dist/${slug}/ and run: ${push}`,
      'Set visibility to Public on the project page.',
    ];
    const payload = buildManualPayload(listing, assets, { action: 'create', slug, butlerPush: push, channel: this.channel });
    return manualResult(buildChecklist('itch', steps), payload);
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    const steps = [
      listing.url ? `Open ${listing.url}/edit.` : `Dashboard > "${listing.title}" > Edit.`,
      'Apply the fields in "changes" from the payload below.',
      `For new files run: ${butlerPushCommand(listing, this.username, this.channel)}`,
      'Save.',
    ];
    const payload = buildManualPayload(listing, [], { action: 'update', externalId: listing.externalId, changes });
    return manualResult(buildChecklist('itch', steps), payload);
  }

  async delist(listing: Listing): Promise<PublishResult> {
    const steps = [listing.url ? `Open ${listing.url}/edit.` : `Dashboard > "${listing.title}" > Edit.`, 'Set Visibility to Restricted or Draft. Do not delete the page; keep the stats.'];
    const payload = buildManualPayload(listing, [], { action: 'delist', externalId: listing.externalId, url: listing.url });
    return manualResult(buildChecklist('itch', steps), payload);
  }

  async readSales(_sinceIso: string): Promise<SaleRecord[]> {
    return [];
  }

  /** Extension: aggregate counters per game from GET /my-games. Empty when not connected or on error. */
  async readGameStats(): Promise<ItchGameStats[]> {
    if (this.apiKey === '') return [];
    const headers = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    const res = await http(this.fetchImpl, `${ITCH_BASE_URL}/my-games`, { method: 'GET', headers });
    if (!res.ok) return [];
    return pickArray(res.json, 'games').map(gameToStats);
  }
}

function gameToStats(game: unknown): ItchGameStats {
  const earnings = pickArray(game, 'earnings');
  const earningsCents = earnings.reduce<number>((sum, e) => sum + (pickNumber(e, 'amount') ?? 0), 0);
  const url = pickString(game, 'url');
  return {
    gameId: pickString(game, 'id') ?? '',
    title: pickString(game, 'title') ?? '',
    ...(url ? { url } : {}),
    published: Boolean(game && typeof game === 'object' && (game as { published?: unknown }).published),
    purchases: pickNumber(game, 'purchases_count') ?? 0,
    views: pickNumber(game, 'views_count') ?? 0,
    downloads: pickNumber(game, 'downloads_count') ?? 0,
    earningsCents,
  };
}

export function createItchAdapter(ctx: AdapterContext): ItchAdapter {
  return new ItchAdapter(ctx);
}
