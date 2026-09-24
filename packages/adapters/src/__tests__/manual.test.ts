import { describe, expect, it } from 'vitest';
import { FiverrAdapter } from '../fiverr.js';
import { DistroKidAdapter } from '../distrokid.js';
import { png, sampleListing } from './helpers.js';

describe('manual-only adapters', () => {
  it('Fiverr: no API, all capabilities false, ToS explains human operation and ban risk', async () => {
    const adapter = new FiverrAdapter();
    const cap = adapter.capability();
    expect(cap).toMatchObject({ platform: 'fiverr', hasApi: false, connected: false, fees: { rate: 0.2, fixedCents: 0 } });
    expect(Object.values(cap.can).every((v) => v === false)).toBe(true);
    expect(cap.tosNotes.join(' ')).toMatch(/human account holder/);
    expect(cap.tosNotes.join(' ')).toMatch(/permanent ban/);

    const res = await adapter.createListing(sampleListing({ platform: 'fiverr', title: 'I will design a YouTube thumbnail', priceCents: 2000 }), [png()]);
    expect(res.ok).toBe(false);
    expect(res.manual?.instructions).toContain('Create a new gig');
    expect(res.manual?.instructions).toContain('Basic $20.00');
    expect(res.manual?.instructions).toContain('I will design a YouTube thumbnail');
    expect(res.manual?.payload.price).toBe('$20.00');
    expect(await adapter.readSales('2026-01-01T00:00:00Z')).toEqual([]);
  });

  it('DistroKid: no API, release checklist names tracks and cover art', async () => {
    const adapter = new DistroKidAdapter();
    const cap = adapter.capability();
    expect(cap).toMatchObject({ platform: 'distrokid', hasApi: false, connected: false });
    expect(Object.values(cap.can).every((v) => v === false)).toBe(true);
    expect(cap.tosNotes.join(' ')).toMatch(/human account holder/);
    expect(cap.tosNotes.join(' ')).toMatch(/termination/);

    const wav = { path: 'tracks/lofi-01.wav', mime: 'audio/wav', bytes: new Uint8Array([1]) };
    const res = await adapter.createListing(sampleListing({ platform: 'distrokid', title: 'Lo-fi Study Loops Vol. 1' }), [wav, png('art/cover.png')]);
    expect(res.manual?.instructions).toContain('tracks/lofi-01.wav');
    expect(res.manual?.instructions).toContain('art/cover.png');
    expect(res.manual?.instructions).toContain('AI-generated');
    const delist = await adapter.delist(sampleListing({ platform: 'distrokid' }));
    expect(delist.manual?.instructions).toContain('Remove from stores');
  });
});
