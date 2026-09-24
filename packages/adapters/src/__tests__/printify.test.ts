import { describe, expect, it } from 'vitest';
import { PrintifyAdapter, PRINTIFY_BASE_URL } from '../printify.js';
import { fakeFetch, png, sampleListing, throwingFetch } from './helpers.js';

const env = { PRINTIFY_API_TOKEN: 'pfy_secret', PRINTIFY_SHOP_ID: '4242', PRINTIFY_BLUEPRINT_ID: '6', PRINTIFY_PRINT_PROVIDER_ID: '99' };

function happyPath() {
  return fakeFetch((call) => {
    if (call.url.endsWith('/uploads/images.json')) return { json: { id: 'img_1', file_name: 'cat-front.png' } };
    if (call.url.includes('/catalog/blueprints/6/print_providers/99/variants.json')) {
      return { json: { variants: [{ id: 401 }, { id: 402 }, { id: 403 }] } };
    }
    if (call.url.endsWith('/shops/4242/products.json')) return { json: { id: 'prod_9', external: { handle: 'https://www.etsy.com/listing/555' } } };
    if (call.url.endsWith('/products/prod_9/publish.json')) return { json: {} };
    return { status: 404, text: 'unexpected ' + call.url };
  });
}

describe('PrintifyAdapter.createListing', () => {
  it('uploads, reads catalog variants, creates and publishes with bearer auth', async () => {
    const ff = happyPath();
    const adapter = new PrintifyAdapter({ env, fetchImpl: ff.fetch });
    const res = await adapter.createListing(sampleListing({ platform: 'printify' }), [png()]);

    expect(res).toEqual({ ok: true, externalId: 'prod_9', url: 'https://www.etsy.com/listing/555' });
    expect(ff.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${PRINTIFY_BASE_URL}/uploads/images.json`,
      `GET ${PRINTIFY_BASE_URL}/catalog/blueprints/6/print_providers/99/variants.json`,
      `POST ${PRINTIFY_BASE_URL}/shops/4242/products.json`,
      `POST ${PRINTIFY_BASE_URL}/shops/4242/products/prod_9/publish.json`,
    ]);
    for (const call of ff.calls) expect(call.headers.authorization).toBe('Bearer pfy_secret');

    const upload = ff.calls[0]!.body as Record<string, unknown>;
    expect(upload.file_name).toBe('cat-front.png');
    expect(typeof upload.contents).toBe('string');

    const product = ff.calls[2]!.body as Record<string, unknown>;
    expect(product).toMatchObject({ title: 'Vintage Botanical Cat Tee', blueprint_id: 6, print_provider_id: 99, tags: ['cat shirt', 'botanical', 'vintage tee', 'cottagecore'] });
    expect(product.variants).toEqual([
      { id: 401, price: 2499, is_enabled: true },
      { id: 402, price: 2499, is_enabled: true },
      { id: 403, price: 2499, is_enabled: true },
    ]);
    expect(product.print_areas).toEqual([
      { variant_ids: [401, 402, 403], placeholders: [{ position: 'front', images: [{ id: 'img_1', x: 0.5, y: 0.5, scale: 1, angle: 0 }] }] },
    ]);

    expect(ff.calls[3]!.body).toEqual({ title: true, description: true, images: true, variants: true, tags: true, keyFeatures: true, shipping_template: true });
  });

  it('returns ok:false with the response text on a non-2xx, never throws', async () => {
    const ff = fakeFetch(() => ({ status: 401, json: { message: 'Unauthenticated.' } }));
    const adapter = new PrintifyAdapter({ env, fetchImpl: ff.fetch });
    const res = await adapter.createListing(sampleListing(), [png()]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 401');
    expect(res.error).toContain('Unauthenticated');
    expect(res.error).not.toContain('pfy_secret');
  });

  it('surfaces network failures as errors', async () => {
    const adapter = new PrintifyAdapter({ env, fetchImpl: throwingFetch('ECONNRESET') });
    const res = await adapter.createListing(sampleListing(), [png()]);
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('ECONNRESET') });
  });

  it('refuses to create without an image', async () => {
    const ff = happyPath();
    const res = await new PrintifyAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), []);
    expect(res.ok).toBe(false);
    expect(ff.calls).toHaveLength(0);
  });

  it('keeps the product id when publish fails so the human can retry', async () => {
    const ff = fakeFetch((call) => {
      if (call.url.endsWith('/publish.json')) return { status: 422, json: { message: 'Shop not connected to a sales channel' } };
      if (call.url.includes('/variants.json')) return { json: { variants: [{ id: 1 }] } };
      if (call.url.endsWith('/products.json')) return { json: { id: 'prod_9' } };
      return { json: { id: 'img_1' } };
    });
    const res = await new PrintifyAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), [png()]);
    expect(res.ok).toBe(false);
    expect(res.externalId).toBe('prod_9');
    expect(res.error).toContain('sales channel');
  });
});

describe('PrintifyAdapter other operations', () => {
  it('updates via PUT and unpublishes via POST', async () => {
    const ff = fakeFetch(() => ({ json: {} }));
    const adapter = new PrintifyAdapter({ env, fetchImpl: ff.fetch });
    const listing = sampleListing({ externalId: 'prod_9', url: 'https://x' });
    expect(await adapter.updateListing(listing, { title: 'New' })).toEqual({ ok: true, externalId: 'prod_9', url: 'https://x' });
    expect(ff.calls[0]).toMatchObject({ method: 'PUT', url: `${PRINTIFY_BASE_URL}/shops/4242/products/prod_9.json`, body: { title: 'New' } });
    expect(await adapter.delist(listing)).toEqual({ ok: true, externalId: 'prod_9' });
    expect(ff.calls[1]).toMatchObject({ method: 'POST', url: `${PRINTIFY_BASE_URL}/shops/4242/products/prod_9/unpublish.json` });
  });

  it('maps orders to sale records per line item and filters by since', async () => {
    const ff = fakeFetch(() => ({
      json: {
        data: [
          {
            id: 'ord_1',
            created_at: '2026-09-20 10:00:00+00:00',
            line_items: [{ product_id: 'prod_9', quantity: 2, cost: 1150, shipping_cost: 450, metadata: { price: 2499 } }],
          },
          { id: 'ord_old', created_at: '2026-01-01 10:00:00+00:00', line_items: [{ product_id: 'prod_9', quantity: 1, cost: 1150, metadata: { price: 2499 } }] },
        ],
      },
    }));
    const sales = await new PrintifyAdapter({ env, fetchImpl: ff.fetch }).readSales('2026-09-01T00:00:00Z');
    expect(ff.calls[0]!.url).toBe(`${PRINTIFY_BASE_URL}/shops/4242/orders.json?limit=100`);
    expect(sales).toEqual([
      { externalOrderId: 'ord_1', listingExternalId: 'prod_9', units: 2, grossCents: 4998, feeCents: 0, fulfilmentCents: 2750, occurredAt: '2026-09-20 10:00:00+00:00' },
    ]);
  });

  it('returns no sales on an API error', async () => {
    const ff = fakeFetch(() => ({ status: 500, text: 'boom' }));
    expect(await new PrintifyAdapter({ env, fetchImpl: ff.fetch }).readSales('2026-09-01T00:00:00Z')).toEqual([]);
  });

  it('reports capability from env', () => {
    expect(new PrintifyAdapter({ env, fetchImpl: fakeFetch([]).fetch }).capability()).toMatchObject({ platform: 'printify', connected: true, hasApi: true, can: { createListing: true, fulfilOrder: true } });
    expect(new PrintifyAdapter({ env: {}, fetchImpl: fakeFetch([]).fetch }).capability().connected).toBe(false);
  });
});
