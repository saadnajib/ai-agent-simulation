import { describe, expect, it } from 'vitest';
import { VENTURE_KINDS } from '@eternity/core';
import { createAdapterRegistry, KNOWN_PLATFORMS } from '../registry.js';
import { DraftOnlyAdapter } from '../draftOnly.js';
import { MockAdapter } from '../mock.js';
import { EtsyAdapter } from '../etsy.js';
import { PrintifyAdapter } from '../printify.js';
import { GumroadAdapter } from '../gumroad.js';
import { fakeFetch, sampleListing } from './helpers.js';

const noFetch = fakeFetch(() => ({ status: 500, text: 'should not be called' }));

describe('registry in sim mode', () => {
  const reg = createAdapterRegistry({}, { mode: 'sim', fetchImpl: noFetch.fetch });

  it('resolves every platform to the mock adapter', () => {
    for (const p of KNOWN_PLATFORMS) expect(reg.get(p)).toBeInstanceOf(MockAdapter);
    expect(reg.get('mock').platform).toBe('mock');
  });

  it('returns mock as the primary platform for every kind', () => {
    for (const kind of VENTURE_KINDS) expect(reg.primaryPlatformFor(kind)).toBe('mock');
    expect(reg.fulfilmentPlatformFor('pod-store')).toBe('mock');
    expect(reg.fulfilmentPlatformFor('affiliate-blog')).toBeUndefined();
  });

  it('lists mock first and describes every real platform honestly (nothing connected)', () => {
    const caps = reg.capabilities();
    expect(caps[0]?.platform).toBe('mock');
    expect(caps[0]?.connected).toBe(true);
    const real = caps.slice(1);
    expect(real.map((c) => c.platform)).toEqual(KNOWN_PLATFORMS);
    expect(real.every((c) => c.connected === false)).toBe(true);
  });

  it('never calls fetch', async () => {
    const res = await reg.get('etsy').createListing(sampleListing(), []);
    expect(res.ok).toBe(true);
    expect(noFetch.calls).toHaveLength(0);
  });
});

describe('registry in live mode with no credentials', () => {
  const reg = createAdapterRegistry({}, { mode: 'live', fetchImpl: noFetch.fetch });

  it('resolves API platforms to draft-only adapters', () => {
    expect(reg.get('etsy')).toBeInstanceOf(DraftOnlyAdapter);
    expect(reg.get('printify')).toBeInstanceOf(DraftOnlyAdapter);
    expect(reg.get('wordpress')).toBeInstanceOf(DraftOnlyAdapter);
    expect(reg.get('lemonsqueezy')).toBeInstanceOf(DraftOnlyAdapter);
  });

  it('keeps the playbook preference as primary so the Airlock gets the right manual payload', () => {
    expect(reg.primaryPlatformFor('pod-store')).toBe('etsy');
    expect(reg.primaryPlatformFor('game-assets')).toBe('itch');
    expect(reg.primaryPlatformFor('thumbnail-service')).toBe('fiverr');
    expect(reg.primaryPlatformFor('affiliate-blog')).toBe('wordpress');
    expect(reg.primaryPlatformFor('software-templates')).toBe('gumroad');
    expect(reg.primaryPlatformFor('music-packs')).toBe('gumroad');
    expect(reg.fulfilmentPlatformFor('pod-store')).toBe('printify');
  });

  it('reports hasApi=false and all can=false for Fiverr and DistroKid', () => {
    for (const p of ['fiverr', 'distrokid'] as const) {
      const cap = reg.get(p).capability();
      expect(cap.hasApi).toBe(false);
      expect(cap.connected).toBe(false);
      expect(Object.values(cap.can).every((v) => v === false)).toBe(true);
      expect(cap.tosNotes.join(' ')).toMatch(/human/i);
      expect(cap.tosNotes.join(' ')).toMatch(/ban/i);
    }
  });

  it('carries the contract fee table into capabilities', () => {
    const byPlatform = Object.fromEntries(reg.capabilities().map((c) => [c.platform, c.fees]));
    expect(byPlatform.etsy).toEqual({ rate: 0.095, fixedCents: 45 });
    expect(byPlatform.fiverr).toEqual({ rate: 0.2, fixedCents: 0 });
    expect(byPlatform.gumroad).toEqual({ rate: 0.1, fixedCents: 50 });
    expect(byPlatform.itch).toEqual({ rate: 0.1, fixedCents: 0 });
    expect(byPlatform.lemonsqueezy).toEqual({ rate: 0.05, fixedCents: 50 });
    expect(byPlatform.wordpress).toEqual({ rate: 0, fixedCents: 0 });
    expect(byPlatform.printify).toEqual({ rate: 0, fixedCents: 0 });
  });

  it('returns a manual payload from a draft-only adapter', async () => {
    const res = await reg.get('etsy').createListing(sampleListing(), []);
    expect(res.ok).toBe(false);
    expect(res.manual?.instructions).toContain('1.');
    expect(res.manual?.payload.title).toBe('Vintage Botanical Cat Tee');
  });
});

describe('registry in live mode with partial credentials', () => {
  const env = {
    PRINTIFY_API_TOKEN: 'pfy_token',
    PRINTIFY_SHOP_ID: '123',
    GUMROAD_ACCESS_TOKEN: 'gr_token',
    ETSY_API_KEY: 'key-only-no-oauth',
  };
  const reg = createAdapterRegistry(env, { mode: 'live', fetchImpl: noFetch.fetch });

  it('uses real adapters only where the full credential set is present', () => {
    expect(reg.get('printify')).toBeInstanceOf(PrintifyAdapter);
    expect(reg.get('gumroad')).toBeInstanceOf(GumroadAdapter);
    expect(reg.get('etsy')).toBeInstanceOf(DraftOnlyAdapter);
    expect(reg.get('etsy')).not.toBeInstanceOf(EtsyAdapter);
  });

  it('falls through the preference list to a connected platform that can publish', () => {
    // etsy is not connected, printify is: pod-store publishes through Printify's channel.
    expect(reg.primaryPlatformFor('pod-store')).toBe('printify');
    // gumroad is connected but cannot create listings via API, so preference order wins.
    expect(reg.primaryPlatformFor('software-templates')).toBe('gumroad');
    expect(reg.get('gumroad').capability().can.createListing).toBe(false);
  });

  it('caches adapter instances', () => {
    expect(reg.get('printify')).toBe(reg.get('printify'));
  });

  it('marks connected platforms in capabilities without leaking secrets', () => {
    const caps = reg.capabilities();
    const printify = caps.find((c) => c.platform === 'printify');
    expect(printify?.connected).toBe(true);
    expect(JSON.stringify(caps)).not.toContain('pfy_token');
    expect(JSON.stringify(caps)).not.toContain('gr_token');
  });
});

describe('registry with a fully connected etsy', () => {
  it('prefers etsy for pod-store', () => {
    const env = { ETSY_API_KEY: 'k', ETSY_ACCESS_TOKEN: 't', ETSY_SHOP_ID: '9', PRINTIFY_API_TOKEN: 'p', PRINTIFY_SHOP_ID: '1' };
    const reg = createAdapterRegistry(env, { mode: 'live', fetchImpl: noFetch.fetch });
    expect(reg.get('etsy')).toBeInstanceOf(EtsyAdapter);
    expect(reg.primaryPlatformFor('pod-store')).toBe('etsy');
  });
});
