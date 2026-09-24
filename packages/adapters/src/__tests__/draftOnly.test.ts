import { describe, expect, it } from 'vitest';
import { DraftOnlyAdapter, buildChecklist, buildManualPayload } from '../draftOnly.js';
import { etsyCapability } from '../etsy.js';
import { png, sampleListing } from './helpers.js';

describe('DraftOnlyAdapter', () => {
  const adapter = new DraftOnlyAdapter(etsyCapability(false));

  it('forces every can.* flag to false and keeps tosNotes and fees', () => {
    const cap = adapter.capability();
    expect(cap.platform).toBe('etsy');
    expect(cap.connected).toBe(false);
    expect(cap.can).toEqual({ createListing: false, updateListing: false, readSales: false, fulfilOrder: false });
    expect(cap.tosNotes.length).toBeGreaterThan(2);
    expect(cap.fees).toEqual({ rate: 0.095, fixedCents: 45 });
  });

  it('createListing returns a numbered checklist and a paste-ready payload', async () => {
    const listing = sampleListing();
    const res = await adapter.createListing(listing, [png(), png('art/mockup-1.png')]);
    expect(res.ok).toBe(false);
    expect(res.error).toBeUndefined();
    const manual = res.manual!;
    const lines = manual.instructions.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(6);
    lines.forEach((line, i) => expect(line.startsWith(`${i + 1}. `)).toBe(true));
    expect(manual.instructions).toContain('Vintage Botanical Cat Tee');
    expect(manual.instructions).toContain('$24.99');
    expect(manual.instructions).toContain('art/cat-front.png');
    expect(lines[lines.length - 1]).toMatch(/Airlock/);

    expect(manual.payload).toMatchObject({
      platform: 'etsy',
      listingId: 'lst_abc123',
      ventureId: 'ven_pod1',
      title: listing.title,
      description: listing.description,
      tags: listing.tags,
      tagsCsv: 'cat shirt, botanical, vintage tee, cottagecore',
      priceCents: 2499,
      price: '$24.99',
      assets: ['art/cat-front.png', 'art/mockup-1.png'],
      action: 'create',
    });
  });

  it('falls back to listing.assets when no asset files are passed', async () => {
    const res = await adapter.createListing(sampleListing(), []);
    expect(res.manual?.payload.assets).toEqual(['art/cat-front.png', 'art/mockup-1.png']);
  });

  it('updateListing spells out the changed fields', async () => {
    const res = await adapter.updateListing(sampleListing({ url: 'https://www.etsy.com/listing/1' }), { priceCents: 1999, tags: ['a', 'b'] });
    expect(res.manual?.instructions).toContain('https://www.etsy.com/listing/1');
    expect(res.manual?.instructions).toContain('$19.99');
    expect(res.manual?.instructions).toContain('a, b');
    expect(res.manual?.payload.changes).toEqual({ priceCents: 1999, tags: ['a', 'b'] });
  });

  it('delist asks to deactivate, not delete', async () => {
    const res = await adapter.delist(sampleListing({ externalId: '77' }));
    expect(res.manual?.instructions).toMatch(/Deactivate/);
    expect(res.manual?.payload.externalId).toBe('77');
  });

  it('readSales is empty', async () => {
    expect(await adapter.readSales('2026-01-01T00:00:00Z')).toEqual([]);
  });

  it('accepts custom steps and extra payload', async () => {
    const custom = new DraftOnlyAdapter(etsyCapability(false), {
      createSteps: () => ['Do the thing.'],
      extraPayload: () => ({ butlerPush: 'butler push x' }),
    });
    const res = await custom.createListing(sampleListing(), []);
    expect(res.manual?.instructions).toBe(buildChecklist('etsy', ['Do the thing.']));
    expect(res.manual?.payload.butlerPush).toBe('butler push x');
  });

  it('buildManualPayload merges extras last', () => {
    const payload = buildManualPayload(sampleListing(), [], { title: 'override' });
    expect(payload.title).toBe('override');
  });
});
