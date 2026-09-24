/**
 * DraftOnlyAdapter: the adapter used whenever the station cannot act on a
 * platform by itself (no API, or API exists but no credentials). Every call
 * returns a `manual` action: a numbered checklist plus a payload the human can
 * paste into the platform's seller dashboard in under two minutes.
 *
 * Also exports the manual payload/checklist builders so the real adapters can
 * fall back to them for the parts of a platform that have no API.
 */
import type { Listing, Platform, PlatformCapability } from '@eternity/core';
import type { AssetFile, ManualAction, PlatformAdapter, PublishResult, SaleRecord } from './types.js';
import { centsToDollars } from './util.js';

export const PLATFORM_LABELS: Record<Platform, string> = {
  etsy: 'Etsy',
  printify: 'Printify',
  printful: 'Printful',
  fiverr: 'Fiverr',
  itch: 'itch.io',
  gumroad: 'Gumroad',
  lemonsqueezy: 'Lemon Squeezy',
  wordpress: 'WordPress',
  'amazon-associates': 'Amazon Associates',
  'unity-asset-store': 'Unity Asset Store',
  distrokid: 'DistroKid',
  pinterest: 'Pinterest',
  x: 'X',
  mock: 'Mock market',
};

export const PLATFORM_DASHBOARDS: Record<Platform, string> = {
  etsy: 'https://www.etsy.com/your/shops/me/tools/listings',
  printify: 'https://printify.com/app/products',
  printful: 'https://www.printful.com/dashboard/sync',
  fiverr: 'https://www.fiverr.com/users/me/manage_gigs',
  itch: 'https://itch.io/game/new',
  gumroad: 'https://app.gumroad.com/products/new',
  lemonsqueezy: 'https://app.lemonsqueezy.com/products',
  wordpress: '(your site)/wp-admin/post-new.php',
  'amazon-associates': 'https://affiliate-program.amazon.com/home',
  'unity-asset-store': 'https://publisher.unity.com/packages',
  distrokid: 'https://distrokid.com/new/',
  pinterest: 'https://www.pinterest.com/pin-creation-tool/',
  x: 'https://x.com/compose/post',
  mock: 'n/a',
};

/** Builds the paste-ready payload for a listing. Shared by all manual paths. */
export function buildManualPayload(listing: Listing, assets: AssetFile[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  const assetPaths = assets.length > 0 ? assets.map((a) => a.path) : listing.assets;
  return {
    platform: listing.platform,
    listingId: listing.id,
    ventureId: listing.ventureId,
    title: listing.title,
    description: listing.description,
    tags: listing.tags,
    tagsCsv: listing.tags.join(', '),
    priceCents: listing.priceCents,
    price: `$${centsToDollars(listing.priceCents)}`,
    niche: listing.niche,
    assets: assetPaths,
    ...extra,
  };
}

/** Numbers the steps and appends the "report back" step every manual action needs. */
export function buildChecklist(platform: Platform, steps: readonly string[]): string {
  const label = PLATFORM_LABELS[platform];
  const all = [
    `Log in to ${label} as the human seller of record (${PLATFORM_DASHBOARDS[platform]}).`,
    ...steps,
    'Paste the resulting public URL and external id back into this Airlock request, then approve it.',
  ];
  return all.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

/** Generic listing steps used when a platform has no bespoke checklist. */
export function genericListingSteps(listing: Listing, assets: AssetFile[]): string[] {
  const files = (assets.length > 0 ? assets.map((a) => a.path) : listing.assets).join(', ') || '(no files attached)';
  return [
    'Start a new listing / product.',
    `Title (paste exactly): ${listing.title}`,
    `Description: paste the "description" field from the payload below.`,
    `Tags: ${listing.tags.join(', ') || '(none)'}`,
    `Price: $${centsToDollars(listing.priceCents)}`,
    `Upload these files from the venture workspace: ${files}`,
    'Publish the listing.',
  ];
}

export function manualResult(instructions: string, payload: Record<string, unknown>, error?: string): PublishResult {
  const manual: ManualAction = { instructions, payload };
  return error ? { ok: false, manual, error } : { ok: false, manual };
}

export type StepBuilder = (listing: Listing, assets: AssetFile[]) => string[];

export interface DraftOnlyOptions {
  /** Steps for creating a listing. Defaults to the generic checklist. */
  createSteps?: StepBuilder;
  /** Steps for updating a live listing. */
  updateSteps?: (listing: Listing, changes: Partial<Listing>) => string[];
  /** Steps for taking a listing down. */
  delistSteps?: (listing: Listing) => string[];
  /** Extra payload fields merged into every manual payload (e.g. a butler command). */
  extraPayload?: (listing: Listing, assets: AssetFile[]) => Record<string, unknown>;
}

/**
 * Wraps a capability description and turns every action into a manual task.
 * `capability.connected` is whatever the wrapped capability says (false for a
 * missing credential, true for a manual-only platform whose account exists).
 */
export class DraftOnlyAdapter implements PlatformAdapter {
  readonly platform: Platform;
  private readonly cap: PlatformCapability;
  private readonly opts: DraftOnlyOptions;

  constructor(capability: PlatformCapability, opts: DraftOnlyOptions = {}) {
    this.platform = capability.platform;
    this.cap = { ...capability, can: { createListing: false, updateListing: false, readSales: false, fulfilOrder: false } };
    this.opts = opts;
  }

  capability(): PlatformCapability {
    return { ...this.cap, can: { ...this.cap.can }, tosNotes: [...this.cap.tosNotes], fees: { ...this.cap.fees } };
  }

  async createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult> {
    const steps = (this.opts.createSteps ?? genericListingSteps)(listing, assets);
    const extra = this.opts.extraPayload?.(listing, assets) ?? {};
    return manualResult(buildChecklist(this.platform, steps), buildManualPayload(listing, assets, { action: 'create', ...extra }));
  }

  async updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult> {
    const steps = this.opts.updateSteps?.(listing, changes) ?? defaultUpdateSteps(listing, changes);
    const payload = buildManualPayload(listing, [], { action: 'update', externalId: listing.externalId, url: listing.url, changes });
    return manualResult(buildChecklist(this.platform, steps), payload);
  }

  async delist(listing: Listing): Promise<PublishResult> {
    const steps = this.opts.delistSteps?.(listing) ?? defaultDelistSteps(listing);
    const payload = buildManualPayload(listing, [], { action: 'delist', externalId: listing.externalId, url: listing.url });
    return manualResult(buildChecklist(this.platform, steps), payload);
  }

  async readSales(_sinceIso: string): Promise<SaleRecord[]> {
    return [];
  }
}

function defaultUpdateSteps(listing: Listing, changes: Partial<Listing>): string[] {
  const where = listing.url ? `Open ${listing.url}` : `Find the listing titled "${listing.title}"`;
  const fields = Object.entries(changes)
    .filter(([key]) => ['title', 'description', 'tags', 'priceCents'].includes(key))
    .map(([key, value]) => `Set ${key}: ${formatChange(key, value)}`);
  return [`${where} and click Edit.`, ...(fields.length > 0 ? fields : ['Apply the changes in the payload below.']), 'Save the listing.'];
}

function defaultDelistSteps(listing: Listing): string[] {
  const where = listing.url ? `Open ${listing.url}` : `Find the listing titled "${listing.title}"`;
  return [`${where}.`, 'Deactivate (or unpublish) the listing. Do not delete it; keep its stats.'];
}

function formatChange(key: string, value: unknown): string {
  if (key === 'priceCents' && typeof value === 'number') return `$${centsToDollars(value)}`;
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : JSON.stringify(value);
}
