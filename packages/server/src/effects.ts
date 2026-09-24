/**
 * Side effects of finished tasks on station state: listings are created from
 * listing copy and articles, reviews set quality, optimisations update
 * listings, and publishing runs through the Airlock and the platform adapter.
 */
import type { ApprovalRequest, CrewAgent, Listing, Platform, RiskLevel, Task, TaskOutput, VentureKind } from '@eternity/core';
import { KIND_ECONOMICS } from '@eternity/core';
import type { AdapterRegistry, AssetFile, PublishResult } from '@eternity/adapters';
import type { Airlock } from './airlock.js';
import type { World } from './state.js';

const REF_KEYS = ['listingRef', 'targetRef', 'articleRef', 'productRef'] as const;

export interface EffectResult {
  /** False when a review blocked the product; dependents should be cancelled. */
  approved: boolean;
  note?: string;
}

export function applyOutputEffects(world: World, task: Task, output: TaskOutput): EffectResult {
  switch (task.kind) {
    case 'write-listing':
      return createListingFromCopy(world, task, output);
    case 'write-article':
      return createArticleListing(world, task, output);
    case 'review-output':
      return applyReview(world, task, output);
    case 'optimise-listing':
      return applyOptimisation(world, task, output);
    default:
      return { approved: true };
  }
}

function assetPaths(world: World, ventureId: string, files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  return files.filter((f): f is string => typeof f === 'string').map((f) => (f.startsWith(`${ventureId}/`) ? f : `${ventureId}/${f}`));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function newListing(world: World, task: Task, fields: Omit<Listing, 'id' | 'status' | 'createdAtTick' | 'stats' | 'ventureId'>): Listing | null {
  const venture = world.venture(task.ventureId);
  if (!venture) return null;
  const listing: Listing = {
    id: world.id('lst'),
    ventureId: venture.id,
    ...fields,
    status: 'draft',
    createdAtTick: world.tick,
    stats: { impressions: 0, clicks: 0, sales: 0, revenueCents: 0 },
  };
  world.putListing(listing);
  return listing;
}

function createListingFromCopy(world: World, task: Task, output: TaskOutput): EffectResult {
  const venture = world.venture(task.ventureId);
  const data = asRecord(output.data['listing']);
  if (!venture || !data) return { approved: false, note: 'write-listing produced no listing object' };
  const kind = (typeof data['kind'] === 'string' ? data['kind'] : venture.kind) as VentureKind;
  const storefront = venture.storefronts[0];
  const platform = (typeof data['platform'] === 'string' ? data['platform'] : storefront?.platform ?? 'mock') as Platform;
  const tags = Array.isArray(data['tags']) ? data['tags'].filter((t): t is string => typeof t === 'string').slice(0, 13) : [];
  const listing = newListing(world, task, {
    storefrontId: str(data['storefrontId'], storefront?.id ?? ''),
    platform,
    title: str(data['title'], venture.thesis).slice(0, 140),
    description: str(data['description'], ''),
    tags,
    priceCents: Math.max(1, Math.round(num(data['priceCents'], KIND_ECONOMICS[kind].typicalPriceCents))),
    unitCostCents: Math.max(0, Math.round(num(data['unitCostCents'], KIND_ECONOMICS[kind].unitCostCents))),
    quality: Math.min(1, Math.max(0, num(data['quality'], 0.5))),
    niche: str(data['niche'], venture.thesis),
    kind,
    assets: assetPaths(world, venture.id, data['assets']),
  });
  if (!listing) return { approved: false, note: 'venture missing' };
  output.data['listingId'] = listing.id;
  return { approved: true };
}

function createArticleListing(world: World, task: Task, output: TaskOutput): EffectResult {
  const venture = world.venture(task.ventureId);
  if (!venture) return { approved: false, note: 'venture missing' };
  const storefront = venture.storefronts[0];
  const title = str(output.data['title'], venture.thesis);
  const links = Array.isArray(output.data['affiliateLinks']) ? output.data['affiliateLinks'].length : 0;
  const listing = newListing(world, task, {
    storefrontId: storefront?.id ?? '',
    platform: storefront?.platform ?? 'wordpress',
    title: title.slice(0, 140),
    description: `${num(output.data['wordCount'], 0)} words, ${links} affiliate links. Slug: ${str(output.data['slug'], '')}`,
    tags: [],
    priceCents: KIND_ECONOMICS['affiliate-blog'].typicalPriceCents,
    unitCostCents: 0,
    quality: 0.5,
    niche: str(output.data['niche'], venture.thesis),
    kind: 'affiliate-blog',
    assets: assetPaths(world, venture.id, output.files),
  });
  if (!listing) return { approved: false, note: 'venture missing' };
  output.data['listingId'] = listing.id;
  return { approved: true };
}

/** Listing produced by one of the tasks this task references. */
export function findListingForTask(world: World, task: Task): Listing | undefined {
  for (const key of REF_KEYS) {
    const ref = task.input[key];
    if (typeof ref !== 'string') continue;
    const upstream = world.tasks.get(ref);
    const id = upstream?.output?.data['listingId'];
    if (typeof id === 'string') {
      const listing = world.listings.get(id);
      if (listing) return listing;
    }
  }
  const direct = task.input['listingId'] ?? task.output?.data['listingId'];
  return typeof direct === 'string' ? world.listings.get(direct) : undefined;
}

function applyReview(world: World, task: Task, output: TaskOutput): EffectResult {
  const quality = Math.min(1, Math.max(0, num(output.data['quality'], output.quality ?? 0.5)));
  const approved = output.data['approved'] !== false;
  const listing = findListingForTask(world, task);
  if (listing) {
    listing.quality = quality;
    if (!approved && listing.status === 'draft') listing.status = 'rejected';
    world.putListing(listing);
  }
  return approved ? { approved: true } : { approved: false, note: `review blocked the product (quality ${quality.toFixed(2)})` };
}

function applyOptimisation(world: World, task: Task, output: TaskOutput): EffectResult {
  const listing = findListingForTask(world, task);
  const changes = asRecord(output.data['changes']);
  if (!listing || !changes) return { approved: true };
  if (typeof changes['title'] === 'string') listing.title = changes['title'].slice(0, 140);
  if (typeof changes['description'] === 'string') listing.description = changes['description'];
  if (Array.isArray(changes['tags'])) listing.tags = changes['tags'].filter((t): t is string => typeof t === 'string').slice(0, 13);
  world.putListing(listing);
  return { approved: true };
}

// ---------------------------------------------------------------------------
// Publishing through the Airlock
// ---------------------------------------------------------------------------

function listingAssets(listing: Listing): AssetFile[] {
  return listing.assets.map((path) => ({ path, mime: mimeFor(path) }));
}

function mimeFor(path: string): string {
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.md')) return 'text/markdown';
  if (path.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

function publishRisk(world: World, connected: boolean): RiskLevel {
  if (world.mode === 'sim') return 'low';
  return connected ? 'medium' : 'low';
}

/** Parks a publish task in the Airlock. Returns null (with the task failed) when there is nothing to publish. */
export async function beginPublish(world: World, airlock: Airlock, registry: AdapterRegistry, task: Task, agent: CrewAgent): Promise<ApprovalRequest | null> {
  const listing = findListingForTask(world, task);
  const venture = world.venture(task.ventureId);
  if (!listing || !venture) return null;
  if (listing.status === 'rejected') return null;
  const adapter = registry.get(listing.platform);
  const capability = adapter.capability();
  const connected = capability.connected && capability.can.createListing;
  let manualInstructions: string | undefined;
  if (!connected) {
    const draft = await adapter.createListing(listing, listingAssets(listing));
    manualInstructions = draft.manual?.instructions ?? `Publish "${listing.title}" on ${listing.platform} by hand, then approve this request.`;
  }
  listing.status = 'awaiting-approval';
  world.putListing(listing);
  const request = airlock.request({
    kind: 'publish',
    risk: publishRisk(world, connected),
    title: `Publish "${listing.title}" to ${listing.platform}`,
    summary: `${venture.name} wants to list "${listing.title}" at $${(listing.priceCents / 100).toFixed(2)} on ${listing.platform} (${listing.tags.length} tags, ${listing.assets.length} assets, quality ${listing.quality.toFixed(2)}).`,
    payload: {
      listingId: listing.id,
      platform: listing.platform,
      title: listing.title,
      description: listing.description,
      tags: listing.tags,
      priceCents: listing.priceCents,
      assets: listing.assets,
      connected,
    },
    requestedBy: agent.id,
    ventureId: venture.id,
    taskId: task.id,
    listingId: listing.id,
    ...(manualInstructions ? { manualInstructions } : {}),
  });
  return request;
}

export interface PublishOutcome {
  ok: boolean;
  listing: Listing;
  output?: TaskOutput;
  error?: string;
}

/** Runs the platform adapter after approval, or records a manual publish. */
export async function completePublish(world: World, registry: AdapterRegistry, approval: ApprovalRequest, listing: Listing): Promise<PublishOutcome> {
  const connected = approval.payload['connected'] === true;
  let result: PublishResult;
  if (connected) {
    try {
      result = await registry.get(listing.platform).createListing(listing, listingAssets(listing));
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!result.ok && !result.manual) {
      return { ok: false, listing, error: result.error ?? 'adapter rejected the listing' };
    }
  } else {
    const noteUrl = approval.note ? /https?:\/\/\S+/.exec(approval.note)?.[0] : undefined;
    result = { ok: true, ...(noteUrl ? { url: noteUrl } : {}) };
  }
  listing.status = 'live';
  listing.publishedAtTick = world.tick;
  if (result.externalId) listing.externalId = result.externalId;
  if (result.url) listing.url = result.url;
  world.putListing(listing);
  const venture = world.venture(listing.ventureId);
  if (venture && venture.status === 'incubating') {
    venture.status = 'active';
    venture.statusReason = 'first listing live';
    world.putVenture(venture);
  }
  const data: Record<string, unknown> = { listingId: listing.id, approvalId: approval.id };
  if (listing.externalId) data['externalId'] = listing.externalId;
  if (listing.url) data['url'] = listing.url;
  return { ok: true, listing, output: { summary: `Published "${listing.title}" to ${listing.platform}.`, files: [], data } };
}
