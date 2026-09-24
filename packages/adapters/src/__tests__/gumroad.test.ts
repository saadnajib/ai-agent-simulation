import { describe, expect, it } from 'vitest';
import { GumroadAdapter, GUMROAD_BASE_URL } from '../gumroad.js';
import { fakeFetch, sampleListing } from './helpers.js';

const env = { GUMROAD_ACCESS_TOKEN: 'gr_secret' };

describe('GumroadAdapter', () => {
  it('cannot create products via API and returns a manual payload without calling fetch', async () => {
    const ff = fakeFetch(() => ({ status: 500, text: 'no' }));
    const adapter = new GumroadAdapter({ env, fetchImpl: ff.fetch });
    expect(adapter.capability()).toMatchObject({ connected: true, hasApi: true, can: { createListing: false, updateListing: false, readSales: true } });
    const res = await adapter.createListing(sampleListing({ platform: 'gumroad' }), []);
    expect(res.ok).toBe(false);
    expect(res.manual?.instructions).toMatch(/New product/);
    expect(res.manual?.payload).toMatchObject({ platform: 'gumroad', slug: 'vintage-botanical-cat-tee', price: '$24.99' });
    expect(ff.calls).toHaveLength(0);
  });

  it('delists through PUT /products/{id}/disable with bearer auth', async () => {
    const ff = fakeFetch(() => ({ json: { success: true } }));
    const res = await new GumroadAdapter({ env, fetchImpl: ff.fetch }).delist(sampleListing({ externalId: 'abc' }));
    expect(res).toEqual({ ok: true, externalId: 'abc' });
    expect(ff.calls[0]).toMatchObject({ method: 'PUT', url: `${GUMROAD_BASE_URL}/products/abc/disable` });
    expect(ff.calls[0]!.headers.authorization).toBe('Bearer gr_secret');
  });

  it('returns ok:false with error text on non-2xx', async () => {
    const ff = fakeFetch(() => ({ status: 404, json: { success: false, message: 'The product was not found.' } }));
    const res = await new GumroadAdapter({ env, fetchImpl: ff.fetch }).delist(sampleListing({ externalId: 'zzz' }));
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 404');
    expect(res.error).toContain('not found');
  });

  it('reads and paginates sales, keeping cents as reported', async () => {
    const ff = fakeFetch((call) =>
      call.url.includes('page_key=')
        ? { json: { success: true, sales: [{ id: 's2', product_id: 'p1', price: 1500, gumroad_fee: 200, quantity: 1, created_at: '2026-09-21T10:00:00Z' }] } }
        : {
            json: {
              success: true,
              next_page_key: 'k2',
              sales: [
                { id: 's1', product_id: 'p1', price: 1500, gumroad_fee: 200, quantity: 2, created_at: '2026-09-20T10:00:00Z' },
                { id: 's0', product_id: 'p1', price: 1500, gumroad_fee: 200, quantity: 1, created_at: '2026-09-01T01:00:00Z' },
              ],
            },
          },
    );
    const sales = await new GumroadAdapter({ env, fetchImpl: ff.fetch }).readSales('2026-09-01T12:00:00Z');
    expect(ff.calls[0]!.url).toBe(`${GUMROAD_BASE_URL}/sales?after=2026-09-01`);
    expect(ff.calls[1]!.url).toBe(`${GUMROAD_BASE_URL}/sales?after=2026-09-01&page_key=k2`);
    expect(sales.map((s) => s.externalOrderId)).toEqual(['s1', 's2']);
    expect(sales[0]).toEqual({ externalOrderId: 's1', listingExternalId: 'p1', units: 2, grossCents: 1500, feeCents: 200, occurredAt: '2026-09-20T10:00:00Z' });
  });

  it('returns [] when the sales call fails', async () => {
    const ff = fakeFetch(() => ({ status: 401, text: 'nope' }));
    expect(await new GumroadAdapter({ env, fetchImpl: ff.fetch }).readSales('2026-09-01T00:00:00Z')).toEqual([]);
  });
});
