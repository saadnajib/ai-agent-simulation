import { describe, expect, it } from 'vitest';
import { MockAdapter } from '../mock.js';
import { sampleListing } from './helpers.js';

describe('MockAdapter', () => {
  it('publishes with a fake url and tracks live listings', async () => {
    const mock = new MockAdapter();
    const res = await mock.createListing(sampleListing(), []);
    expect(res).toEqual({ ok: true, externalId: 'mock_lst_abc123', url: 'https://mock.eternity.local/listing/lst_abc123' });
    expect(mock.liveCount()).toBe(1);
    await mock.delist(sampleListing({ externalId: 'mock_lst_abc123' }));
    expect(mock.liveCount()).toBe(0);
  });

  it('rejects empty titles and free listings', async () => {
    const mock = new MockAdapter();
    expect((await mock.createListing(sampleListing({ title: ' ' }), [])).ok).toBe(false);
    expect((await mock.createListing(sampleListing({ priceCents: 0 }), [])).ok).toBe(false);
  });

  it('has no sales of its own (demand comes from the core market model)', async () => {
    expect(await new MockAdapter().readSales('2026-01-01T00:00:00Z')).toEqual([]);
  });
});
