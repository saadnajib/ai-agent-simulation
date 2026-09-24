/**
 * Platform fee table: re-exported from @eternity/core (economics.ts) so the
 * ledger and the adapters always agree. The numbers come from
 * docs/architecture/CONTRACTS.md:
 *   etsy 0.095 + 45c, fiverr 0.20, itch 0.10, gumroad 0.10 + 50c,
 *   lemonsqueezy 0.05 + 50c, wordpress 0, amazon-associates 0,
 *   printify/printful 0 (base cost is unitCost), mock 0.10.
 */
import { PLATFORM_FEES } from '@eternity/core';
import type { Platform } from '@eternity/core';

export { PLATFORM_FEES };

export interface PlatformFee {
  rate: number;
  fixedCents: number;
}

export function feesFor(platform: Platform): PlatformFee {
  return { ...PLATFORM_FEES[platform] };
}

/** Fee the platform keeps on one sale of `grossCents`, in integer cents (adapter-side estimate). */
export function platformFeeCents(platform: Platform, grossCents: number): number {
  if (grossCents <= 0) return 0;
  const fee = PLATFORM_FEES[platform];
  return Math.round(grossCents * fee.rate + fee.fixedCents);
}
