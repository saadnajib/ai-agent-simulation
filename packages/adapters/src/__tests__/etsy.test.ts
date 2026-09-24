import { describe, expect, it } from 'vitest';
import { EtsyAdapter, ETSY_BASE_URL, etsyTags } from '../etsy.js';
import { fakeFetch, png, sampleListing } from './helpers.js';

const env = { ETSY_API_KEY: 'keystring', ETSY_ACCESS_TOKEN: 'oauth_tok', ETSY_SHOP_ID: '777', ETSY_TAXONOMY_ID: '2078' };

function happyPath() {
  return fakeFetch((call) => {
    if (call.method === 'POST' && call.url.endsWith('/shops/777/listings')) return { json: { listing_id: 123456, state: 'draft' } };
    if (call.url.endsWith('/listings/123456/images')) return { json: { listing_image_id: 1 } };
    if (call.url.endsWith('/listings/123456/files')) return { json: { listing_file_id: 2 } };
    if (call.method === 'PATCH') return { json: { listing_id: 123456, state: 'active', url: 'https://www.etsy.com/listing/123456/vintage-botanical-cat-tee' } };
    return { status: 404, text: 'unexpected ' + call.url };
  });
}

describe('EtsyAdapter.createListing', () => {
  it('creates a draft (form-urlencoded), uploads images and files (multipart), then activates', async () => {
    const ff = happyPath();
    const adapter = new EtsyAdapter({ env, fetchImpl: ff.fetch });
    const svg = { path: 'art/cat.svg', mime: 'application/zip', bytes: new Uint8Array([1, 2]) };
    const res = await adapter.createListing(sampleListing(), [png(), svg]);

    expect(res).toEqual({ ok: true, externalId: '123456', url: 'https://www.etsy.com/listing/123456/vintage-botanical-cat-tee' });
    expect(ff.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${ETSY_BASE_URL}/shops/777/listings`,
      `POST ${ETSY_BASE_URL}/shops/777/listings/123456/images`,
      `POST ${ETSY_BASE_URL}/shops/777/listings/123456/files`,
      `PATCH ${ETSY_BASE_URL}/shops/777/listings/123456`,
    ]);
    for (const call of ff.calls) {
      expect(call.headers['x-api-key']).toBe('keystring');
      expect(call.headers.authorization).toBe('Bearer oauth_tok');
    }

    const draft = ff.calls[0]!;
    expect(draft.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(draft.body).toMatchObject({
      quantity: '999',
      title: 'Vintage Botanical Cat Tee',
      price: '24.99',
      who_made: 'i_did',
      when_made: 'made_to_order',
      taxonomy_id: '2078',
      type: 'download',
      tags: 'cat shirt,botanical,vintage tee,cottagecore',
    });
    expect(draft.body).not.toHaveProperty('shipping_profile_id');

    const image = ff.calls[1]!.rawBody as FormData;
    expect(image).toBeInstanceOf(FormData);
    expect(image.get('rank')).toBe('1');
    expect((image.get('image') as File).name).toBe('cat-front.png');
    expect(ff.calls[1]!.headers['content-type']).toBeUndefined();

    const file = ff.calls[2]!.rawBody as FormData;
    expect((file.get('file') as File).name).toBe('cat.svg');
    expect(file.get('name')).toBe('cat.svg');

    expect(ff.calls[3]!.body).toEqual({ state: 'active' });
  });

  it('creates a physical listing with shipping profile and readiness state when configured', async () => {
    const ff = happyPath();
    const physicalEnv = { ...env, ETSY_SHIPPING_PROFILE_ID: '55', ETSY_READINESS_STATE_ID: '66', ETSY_RETURN_POLICY_ID: '88' };
    await new EtsyAdapter({ env: physicalEnv, fetchImpl: ff.fetch }).createListing(sampleListing(), [png()]);
    expect(ff.calls[0]!.body).toMatchObject({ type: 'physical', shipping_profile_id: '55', readiness_state_id: '66', return_policy_id: '88' });
    // no digital file upload for physical goods
    expect(ff.calls.some((c) => c.url.endsWith('/files'))).toBe(false);
  });

  it('returns ok:false with the error body on non-2xx', async () => {
    const ff = fakeFetch(() => ({ status: 400, json: { error: 'taxonomy_id is invalid' } }));
    const res = await new EtsyAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), [png()]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 400');
    expect(res.error).toContain('taxonomy_id is invalid');
    expect(res.error).not.toContain('oauth_tok');
  });

  it('keeps the draft id when a later step fails', async () => {
    const ff = fakeFetch((call) => (call.url.endsWith('/images') ? { status: 500, text: 'upload failed' } : { json: { listing_id: 9 } }));
    const res = await new EtsyAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), [png()]);
    expect(res).toMatchObject({ ok: false, externalId: '9', error: expect.stringContaining('upload failed') });
  });

  it('falls back to a manual payload when the taxonomy id is missing', async () => {
    const ff = happyPath();
    const { ETSY_TAXONOMY_ID: _omit, ...noTaxonomy } = env;
    const res = await new EtsyAdapter({ env: noTaxonomy, fetchImpl: ff.fetch }).createListing(sampleListing(), [png()]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ETSY_TAXONOMY_ID');
    expect(res.manual?.instructions).toContain('AI-assisted');
    expect(res.manual?.payload.title).toBe('Vintage Botanical Cat Tee');
    expect(ff.calls).toHaveLength(0);
  });
});

describe('EtsyAdapter other operations', () => {
  it('updates with PATCH form fields and deactivates on delist', async () => {
    const ff = fakeFetch(() => ({ json: { listing_id: 5, url: 'https://www.etsy.com/listing/5' } }));
    const adapter = new EtsyAdapter({ env, fetchImpl: ff.fetch });
    const listing = sampleListing({ externalId: '5' });
    expect(await adapter.updateListing(listing, { priceCents: 1999, title: 'T' })).toEqual({ ok: true, externalId: '5', url: 'https://www.etsy.com/listing/5' });
    expect(ff.calls[0]).toMatchObject({ method: 'PATCH', url: `${ETSY_BASE_URL}/shops/777/listings/5`, body: { price: '19.99', title: 'T' } });
    expect(await adapter.delist(listing)).toEqual({ ok: true, externalId: '5' });
    expect(ff.calls[1]!.body).toEqual({ state: 'inactive' });
  });

  it('reads receipts into per-transaction sale records with estimated fees', async () => {
    const ff = fakeFetch(() => ({
      json: {
        results: [
          {
            receipt_id: 900,
            created_timestamp: 1758000000,
            transactions: [
              { transaction_id: 1, listing_id: 5, quantity: 2, price: { amount: 2499, divisor: 100 } },
              { transaction_id: 2, listing_id: 6, quantity: 1, price: { amount: 1000, divisor: 100 } },
            ],
          },
        ],
      },
    }));
    const sales = await new EtsyAdapter({ env, fetchImpl: ff.fetch }).readSales('2026-09-01T00:00:00Z');
    expect(ff.calls[0]!.url).toBe(`${ETSY_BASE_URL}/shops/777/receipts?min_created=${Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000)}&limit=100`);
    expect(sales).toEqual([
      { externalOrderId: '900:1', listingExternalId: '5', units: 2, grossCents: 4998, feeCents: 520, occurredAt: new Date(1758000000 * 1000).toISOString() },
      { externalOrderId: '900:2', listingExternalId: '6', units: 1, grossCents: 1000, feeCents: 140, occurredAt: new Date(1758000000 * 1000).toISOString() },
    ]);
  });

  it('trims tags to Etsy limits', () => {
    const tags = etsyTags(['a very long tag name that exceeds twenty', 'dup', 'DUP', '', ...Array.from({ length: 20 }, (_, i) => `t${i}`)]);
    expect(tags).toHaveLength(13);
    expect(tags[0]).toHaveLength(20);
    expect(tags.filter((t) => t.toLowerCase() === 'dup')).toHaveLength(1);
  });

  it('capability says human seller of record and AI disclosure', () => {
    const cap = new EtsyAdapter({ env, fetchImpl: fakeFetch([]).fetch }).capability();
    expect(cap.connected).toBe(true);
    expect(cap.tosNotes.join(' ')).toMatch(/seller of record/);
    expect(cap.tosNotes.join(' ')).toMatch(/AI-assisted/);
    expect(cap.tosNotes.join(' ')).toMatch(/One shop per person/);
  });
});
