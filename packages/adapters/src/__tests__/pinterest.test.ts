import { describe, expect, it } from 'vitest';
import { PinterestAdapter, PINTEREST_BASE_URL } from '../pinterest.js';
import { fakeFetch, png, sampleListing } from './helpers.js';

const env = { PINTEREST_ACCESS_TOKEN: 'pin_secret', PINTEREST_BOARD_ID: 'board1' };

describe('PinterestAdapter', () => {
  it('creates a pin with base64 media and bearer auth', async () => {
    const ff = fakeFetch(() => ({ status: 201, json: { id: '9876' } }));
    const listing = sampleListing({ platform: 'pinterest', url: 'https://www.etsy.com/listing/1' });
    const res = await new PinterestAdapter({ env, fetchImpl: ff.fetch }).createListing(listing, [png()]);
    expect(res).toEqual({ ok: true, externalId: '9876', url: 'https://www.pinterest.com/pin/9876/' });
    expect(ff.calls[0]).toMatchObject({ method: 'POST', url: `${PINTEREST_BASE_URL}/pins` });
    expect(ff.calls[0]!.headers.authorization).toBe('Bearer pin_secret');
    expect(ff.calls[0]!.body).toMatchObject({ board_id: 'board1', title: 'Vintage Botanical Cat Tee', link: 'https://www.etsy.com/listing/1', media_source: { source_type: 'image_base64', content_type: 'image/png' } });
    expect((ff.calls[0]!.body as { description: string }).description).toContain('#catshirt');
  });

  it('is manual without credentials', async () => {
    const ff = fakeFetch([]);
    const adapter = new PinterestAdapter({ env: {}, fetchImpl: ff.fetch });
    expect(adapter.capability()).toMatchObject({ connected: false, hasApi: true, can: { createListing: false } });
    const res = await adapter.createListing(sampleListing(), [png()]);
    expect(res.ok).toBe(false);
    expect(res.manual?.instructions).toContain('Create Pin');
    expect(ff.calls).toHaveLength(0);
  });

  it('returns ok:false with error text on non-2xx', async () => {
    const ff = fakeFetch(() => ({ status: 429, json: { code: 2, message: 'Rate limited' } }));
    const res = await new PinterestAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), [png()]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 429');
    expect(res.error).toContain('Rate limited');
  });

  it('deletes pins on delist', async () => {
    const ff = fakeFetch(() => ({ status: 204, text: '' }));
    const res = await new PinterestAdapter({ env, fetchImpl: ff.fetch }).delist(sampleListing({ externalId: '9876' }));
    expect(res).toEqual({ ok: true, externalId: '9876' });
    expect(ff.calls[0]).toMatchObject({ method: 'DELETE', url: `${PINTEREST_BASE_URL}/pins/9876` });
  });
});
