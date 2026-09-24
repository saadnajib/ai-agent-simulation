/**
 * Capability profiles for platforms that have no dedicated adapter yet.
 * They are always draft-only; the notes tell the Overseer and the human what
 * the platform allows so nobody assumes automation that does not exist.
 */
import type { Platform, PlatformCapability } from '@eternity/core';
import { PLATFORM_FEES } from './fees.js';

interface Profile {
  hasApi: boolean;
  tosNotes: string[];
}

const PROFILES: Partial<Record<Platform, Profile>> = {
  printful: {
    hasApi: true,
    tosNotes: [
      'Printful has a full REST API (v2) for products and orders; an adapter is not implemented yet, so it runs draft-only.',
      'Printful only fulfils; the storefront keeps its own seller-of-record rules.',
    ],
  },
  lemonsqueezy: {
    hasApi: true,
    tosNotes: [
      'Lemon Squeezy is merchant of record (handles VAT/sales tax) and charges 5% + $0.50.',
      'Its API supports orders, licences and checkouts; product creation is dashboard-only, so listings are manual.',
    ],
  },
  'amazon-associates': {
    hasApi: false,
    tosNotes: [
      'Amazon Associates has no self-serve reporting API for new associates; commissions are read from the dashboard by the human.',
      'Every page with affiliate links needs the required disclosure; accounts without 3 qualifying sales in 180 days are closed.',
      'Do not cloak links, use links in emails or PDFs, or quote prices that can go stale.',
    ],
  },
  'unity-asset-store': {
    hasApi: false,
    tosNotes: [
      'Unity Asset Store submissions go through the Publisher Portal and human review; there is no publishing API.',
      'Unity keeps 30% of each sale; AI-generated assets must be disclosed in the submission form.',
    ],
  },
  x: {
    hasApi: true,
    tosNotes: [
      'X posting requires a paid API tier; the adapter is not implemented, so promotion posts are drafted for the human.',
      'Automated engagement (mass follows, duplicate posts) violates platform rules.',
    ],
  },
};

export function profileCapability(platform: Platform): PlatformCapability {
  const profile = PROFILES[platform] ?? { hasApi: false, tosNotes: ['No adapter for this platform; everything is manual.'] };
  return {
    platform,
    connected: false,
    hasApi: profile.hasApi,
    can: { createListing: false, updateListing: false, readSales: false, fulfilOrder: false },
    tosNotes: [...profile.tosNotes],
    fees: { ...PLATFORM_FEES[platform] },
  };
}
