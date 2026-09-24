/**
 * DistroKid: manual-only.
 *
 * DistroKid (music distribution to Spotify, Apple Music, etc.) has no public
 * API. Uploads, artist profiles, splits and payouts are done by the human
 * account holder in the web app. Its terms forbid automated uploads and
 * "artificial streaming"; fully AI-generated music is accepted by DistroKid
 * only when it is disclosed and the account holder owns the rights, and
 * individual stores may still reject it.
 *
 * The station prepares the release package (tracks, art, metadata) and the
 * checklist; the human uploads.
 */
import type { Listing, PlatformCapability } from '@eternity/core';
import { DraftOnlyAdapter } from './draftOnly.js';
import { PLATFORM_FEES } from './fees.js';
import type { AssetFile } from './types.js';

export const DISTROKID_TOS_NOTES = [
  'DistroKid has no public API; releases are uploaded by the human account holder in the web app.',
  'Automated account operation or bulk upload scripts violate DistroKid terms and risk account termination and withheld royalties.',
  'Streaming stores pay per stream (~$0.003) and take ~30% before royalties; DistroKid itself keeps 0% on the yearly plan.',
  'AI-generated music must be disclosed; you must own or license every sample and the cover art.',
  'Artificial streaming (bots, stream farms) leads to takedowns and bans across all stores.',
];

export function distrokidCapability(): PlatformCapability {
  return {
    platform: 'distrokid',
    connected: false,
    hasApi: false,
    can: { createListing: false, updateListing: false, readSales: false, fulfilOrder: false },
    tosNotes: [...DISTROKID_TOS_NOTES],
    fees: { ...PLATFORM_FEES.distrokid },
  };
}

export function distrokidReleaseSteps(listing: Listing, assets: AssetFile[]): string[] {
  const audio = assets.filter((a) => a.mime.startsWith('audio/')).map((a) => a.path);
  const art = assets.find((a) => a.mime.startsWith('image/'))?.path ?? '(cover art missing: 3000x3000 JPG required)';
  const tracks = audio.length > 0 ? audio.join(', ') : listing.assets.join(', ') || '(none)';
  return [
    'Upload > New release. Choose Single or Album to match the track count.',
    `Release title: ${listing.title}; Artist name: your artist profile (do not invent a new one).`,
    `Cover art: ${art}`,
    `Tracks (WAV/FLAC, 16-bit 44.1kHz or better): ${tracks}`,
    `Genre and mood tags: ${listing.tags.join(', ') || '(none)'}`,
    'Tick "This release contains AI-generated content" if applicable; confirm you own all rights.',
    'Select all stores, set the release date at least 2 weeks out, and submit.',
    'After delivery, copy the Spotify URL into the Airlock as the listing URL.',
  ];
}

export class DistroKidAdapter extends DraftOnlyAdapter {
  constructor() {
    super(distrokidCapability(), {
      createSteps: distrokidReleaseSteps,
      delistSteps: (listing) => [`My Music > "${listing.title}" > Remove from stores (takedowns take 1-2 weeks).`],
    });
  }
}

export function createDistroKidAdapter(): DistroKidAdapter {
  return new DistroKidAdapter();
}
