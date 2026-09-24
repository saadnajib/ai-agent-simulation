/**
 * Fiverr: manual-only.
 *
 * Fiverr has no seller API. Its Terms of Service require the account holder
 * to operate the account personally: no account sharing, no bots, no
 * automated gig management or automated buyer messaging. Violations lead to
 * warnings and permanent bans, which also freeze pending earnings. The
 * station therefore never touches Fiverr; it prepares gig copy, packages and
 * delivery files and the human does everything on the site.
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { DraftOnlyAdapter } from './draftOnly.js';
import { PLATFORM_FEES } from './fees.js';
import type { AssetFile } from './types.js';
import { centsToDollars } from './util.js';

export const FIVERR_TOS_NOTES = [
  'Fiverr exposes no seller API; every gig, order and message is handled by the human account holder.',
  'Fiverr ToS forbid account sharing and automated operation of a seller account; detected automation risks a permanent ban and frozen funds.',
  'Buyer conversations and deliveries must be sent by the human; agents may draft them for copy and paste.',
  'Fiverr keeps 20% of every order; new sellers are limited to 7 active gigs and must maintain response and delivery ratings.',
  'AI-generated deliverables are allowed if the gig says so; misrepresenting them can trigger cancellations.',
];

export function fiverrCapability(): PlatformCapability {
  return {
    platform: 'fiverr',
    connected: false,
    hasApi: false,
    can: { createListing: false, updateListing: false, readSales: false, fulfilOrder: false },
    tosNotes: [...FIVERR_TOS_NOTES],
    fees: { ...PLATFORM_FEES.fiverr },
  };
}

export function fiverrGigSteps(listing: Listing, assets: AssetFile[]): string[] {
  const files = (assets.length > 0 ? assets.map((a) => a.path) : listing.assets).join(', ') || '(none)';
  const price = centsToDollars(listing.priceCents);
  return [
    'Switch to Selling > Gigs > Create a new gig.',
    `Gig title (starts with "I will"): ${listing.title}`,
    `Category: Graphics & Design > Thumbnails Design (or the category the playbook names). Search tags: ${listing.tags.slice(0, 5).join(', ')}`,
    `Pricing: Basic $${price} (1 thumbnail, 2 revisions, 2-day delivery); Standard and Premium at 2x and 4x with more concepts.`,
    'Description and FAQ: paste the "description" field; state that AI tools assist the workflow.',
    'Requirements: ask the buyer for video title, channel link, face photo (optional) and 2 reference thumbnails.',
    `Gallery: upload 3 portfolio images from ${files}.`,
    'Publish the gig. Orders and buyer messages must be answered by you personally.',
  ];
}

export class FiverrAdapter extends DraftOnlyAdapter {
  constructor() {
    super(fiverrCapability(), {
      createSteps: fiverrGigSteps,
      delistSteps: (listing) => [`Selling > Gigs > "${listing.title}" > Pause. Pausing keeps reviews; deleting loses them.`],
    });
  }
}

export function createFiverrAdapter(): FiverrAdapter {
  return new FiverrAdapter();
}
