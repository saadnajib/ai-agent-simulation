/**
 * Adapter registry: resolves a Platform to the adapter that should handle it
 * given the run mode and the credentials present in `env`.
 *
 *   sim  -> every platform resolves to the MockAdapter.
 *   live -> real adapter when its credentials are present, otherwise a
 *           DraftOnlyAdapter wrapping the platform's honest capability.
 *
 * `primaryPlatformFor(kind)` walks a per-kind preference list and returns the
 * first platform that is connected and can create listings; when nothing is
 * connected it returns the first preference so the Airlock gets a manual
 * payload for the platform the playbook actually wants.
 */
import type { Platform, PlatformCapability, VentureKind } from '@eternity/core';
import { DraftOnlyAdapter } from './draftOnly.js';
import { createDistroKidAdapter } from './distrokid.js';
import { createEtsyAdapter, etsyCapability, etsyConnected, etsyListingSteps } from './etsy.js';
import { createFiverrAdapter } from './fiverr.js';
import { createGumroadAdapter, gumroadCapability, gumroadConnected, gumroadListingSteps } from './gumroad.js';
import { createItchAdapter } from './itch.js';
import { createMockAdapter, mockCapability } from './mock.js';
import { createPinterestAdapter } from './pinterest.js';
import { createPrintifyAdapter, printifyCapability, printifyConnected } from './printify.js';
import { profileCapability } from './profiles.js';
import type { AdapterContext, AdapterEnv, AdapterRegistry, PlatformAdapter, RegistryOptions } from './types.js';
import { createWordPressAdapter, wordpressCapability, wordpressConnected } from './wordpress.js';

/** Ordered publishing preference per venture kind (first = preferred). */
export const PLATFORM_PREFERENCES: Record<VentureKind, readonly Platform[]> = {
  'pod-store': ['etsy', 'printify'],
  'game-assets': ['itch', 'gumroad'],
  'thumbnail-service': ['fiverr'],
  'affiliate-blog': ['wordpress'],
  'software-templates': ['gumroad', 'lemonsqueezy'],
  'music-packs': ['gumroad', 'itch'],
};

/** Platforms that fulfil physical orders for a kind. */
export const FULFILMENT_PLATFORMS: Partial<Record<VentureKind, Platform>> = {
  'pod-store': 'printify',
};

/** Every platform the registry knows how to describe, in display order. */
export const KNOWN_PLATFORMS: readonly Platform[] = [
  'etsy',
  'printify',
  'printful',
  'gumroad',
  'itch',
  'lemonsqueezy',
  'wordpress',
  'amazon-associates',
  'fiverr',
  'distrokid',
  'unity-asset-store',
  'pinterest',
  'x',
];

export function createAdapterRegistry(env: AdapterEnv, opts: RegistryOptions): AdapterRegistry {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function' && opts.mode === 'live') {
    throw new Error('createAdapterRegistry: live mode needs a fetch implementation (opts.fetchImpl or globalThis.fetch)');
  }
  const ctx: AdapterContext = { env, fetchImpl };
  return opts.mode === 'sim' ? simRegistry(ctx) : liveRegistry(ctx);
}

function simRegistry(ctx: AdapterContext): AdapterRegistry {
  const mock = createMockAdapter();
  return {
    get: () => mock,
    capabilities: () => [mockCapability(), ...KNOWN_PLATFORMS.map((p) => describePlatform(p, ctx))],
    primaryPlatformFor: () => 'mock',
    fulfilmentPlatformFor: (kind) => (FULFILMENT_PLATFORMS[kind] ? 'mock' : undefined),
  };
}

function liveRegistry(ctx: AdapterContext): AdapterRegistry {
  const cache = new Map<Platform, PlatformAdapter>();
  const get = (platform: Platform): PlatformAdapter => {
    let adapter = cache.get(platform);
    if (!adapter) {
      adapter = buildLiveAdapter(platform, ctx);
      cache.set(platform, adapter);
    }
    return adapter;
  };
  return {
    get,
    capabilities: () => KNOWN_PLATFORMS.map((p) => get(p).capability()),
    primaryPlatformFor: (kind) => choosePrimary(kind, get),
    fulfilmentPlatformFor: (kind) => FULFILMENT_PLATFORMS[kind],
  };
}

function choosePrimary(kind: VentureKind, get: (p: Platform) => PlatformAdapter): Platform {
  const prefs = PLATFORM_PREFERENCES[kind];
  const connected = prefs.find((p) => {
    const cap = get(p).capability();
    return cap.connected && cap.can.createListing;
  });
  return connected ?? prefs[0]!;
}

/** Live adapter for a platform: real when credentials exist, otherwise draft-only with the honest capability. */
export function buildLiveAdapter(platform: Platform, ctx: AdapterContext): PlatformAdapter {
  switch (platform) {
    case 'mock':
      return createMockAdapter();
    case 'printify':
      return printifyConnected(ctx.env) ? createPrintifyAdapter(ctx) : new DraftOnlyAdapter(printifyCapability(false));
    case 'etsy':
      return etsyConnected(ctx.env) ? createEtsyAdapter(ctx) : new DraftOnlyAdapter(etsyCapability(false), { createSteps: etsyListingSteps });
    case 'gumroad':
      return gumroadConnected(ctx.env) ? createGumroadAdapter(ctx) : new DraftOnlyAdapter(gumroadCapability(false), { createSteps: gumroadListingSteps });
    case 'itch':
      // Never connected for publishing: the itch adapter is manual either way and adds stats when a key exists.
      return createItchAdapter(ctx);
    case 'wordpress':
      return wordpressConnected(ctx.env) ? createWordPressAdapter(ctx) : new DraftOnlyAdapter(wordpressCapability(false));
    case 'pinterest':
      return createPinterestAdapter(ctx);
    case 'fiverr':
      return createFiverrAdapter();
    case 'distrokid':
      return createDistroKidAdapter();
    default:
      return new DraftOnlyAdapter(profileCapability(platform));
  }
}

/** Capability a platform would have in live mode with the given env (used by the sim registry for the UI). */
function describePlatform(platform: Platform, ctx: AdapterContext): PlatformCapability {
  return buildLiveAdapter(platform, ctx).capability();
}
