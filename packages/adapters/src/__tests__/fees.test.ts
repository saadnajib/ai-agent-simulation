import { describe, expect, it } from 'vitest';
import { PLATFORM_FEES, platformFeeCents } from '../fees.js';

describe('fees', () => {
  it('matches the CONTRACTS.md numbers', () => {
    expect(PLATFORM_FEES.etsy).toEqual({ rate: 0.095, fixedCents: 45 });
    expect(PLATFORM_FEES.fiverr).toEqual({ rate: 0.2, fixedCents: 0 });
    expect(PLATFORM_FEES.itch).toEqual({ rate: 0.1, fixedCents: 0 });
    expect(PLATFORM_FEES.gumroad).toEqual({ rate: 0.1, fixedCents: 50 });
    expect(PLATFORM_FEES.lemonsqueezy).toEqual({ rate: 0.05, fixedCents: 50 });
    expect(PLATFORM_FEES.wordpress).toEqual({ rate: 0, fixedCents: 0 });
    expect(PLATFORM_FEES['amazon-associates']).toEqual({ rate: 0, fixedCents: 0 });
    expect(PLATFORM_FEES.printify).toEqual({ rate: 0, fixedCents: 0 });
    expect(PLATFORM_FEES.printful).toEqual({ rate: 0, fixedCents: 0 });
    expect(PLATFORM_FEES.mock).toEqual({ rate: 0.1, fixedCents: 0 });
  });

  it('computes integer fees and never charges on zero', () => {
    expect(platformFeeCents('etsy', 2499)).toBe(282);
    expect(platformFeeCents('gumroad', 1000)).toBe(150);
    expect(platformFeeCents('gumroad', 0)).toBe(0);
  });
});
