import { describe, expect, it } from 'vitest';
import { ItchAdapter, ITCH_BASE_URL } from '../itch.js';
import { fakeFetch, sampleListing } from './helpers.js';

describe('ItchAdapter', () => {
  it('returns butler instructions and never publishes by itself', async () => {
    const ff = fakeFetch(() => ({ status: 500, text: 'no' }));
    const adapter = new ItchAdapter({ env: { ITCH_API_KEY: 'itch_secret', ITCH_USERNAME: 'pixelforge' }, fetchImpl: ff.fetch });
    expect(adapter.capability()).toMatchObject({ connected: true, hasApi: true, can: { createListing: false, readSales: false } });
    const res = await adapter.createListing(sampleListing({ platform: 'itch', title: 'Dungeon Tileset Pack' }), []);
    expect(res.ok).toBe(false);
    expect(res.manual?.payload.butlerPush).toBe('butler push ./dist/dungeon-tileset-pack pixelforge/dungeon-tileset-pack:assets');
    expect(res.manual?.instructions).toContain('butler push ./dist/dungeon-tileset-pack pixelforge/dungeon-tileset-pack:assets');
    expect(res.manual?.instructions).toContain('Create new project');
    expect(ff.calls).toHaveLength(0);
  });

  it('is manual without a key and readSales is always empty', async () => {
    const adapter = new ItchAdapter({ env: {}, fetchImpl: fakeFetch([]).fetch });
    expect(adapter.capability().connected).toBe(false);
    expect(await adapter.readSales('2026-01-01T00:00:00Z')).toEqual([]);
    expect(await adapter.readGameStats()).toEqual([]);
  });

  it('reads aggregate game stats from /my-games with bearer auth', async () => {
    const ff = fakeFetch(() => ({
      json: { games: [{ id: 1, title: 'Dungeon Tileset Pack', url: 'https://pixelforge.itch.io/dungeon', published: true, purchases_count: 4, views_count: 120, downloads_count: 9, earnings: [{ amount: 3200, currency: 'USD' }] }] },
    }));
    const stats = await new ItchAdapter({ env: { ITCH_API_KEY: 'itch_secret' }, fetchImpl: ff.fetch }).readGameStats();
    expect(ff.calls[0]).toMatchObject({ method: 'GET', url: `${ITCH_BASE_URL}/my-games` });
    expect(ff.calls[0]!.headers.authorization).toBe('Bearer itch_secret');
    expect(stats).toEqual([{ gameId: '1', title: 'Dungeon Tileset Pack', url: 'https://pixelforge.itch.io/dungeon', published: true, purchases: 4, views: 120, downloads: 9, earningsCents: 3200 }]);
  });

  it('returns [] stats on a non-2xx', async () => {
    const ff = fakeFetch(() => ({ status: 403, text: 'forbidden' }));
    expect(await new ItchAdapter({ env: { ITCH_API_KEY: 'k' }, fetchImpl: ff.fetch }).readGameStats()).toEqual([]);
  });
});
