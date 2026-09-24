/**
 * @eternity/adapters public types.
 *
 * These mirror the "@eternity/adapters API" section of
 * docs/architecture/CONTRACTS.md. Anything beyond the contract is marked as
 * an extension and is optional.
 */
import type { Listing, Platform, PlatformCapability, VentureKind } from '@eternity/core';

/** A deliverable file the adapter may upload. `bytes` is absent when only the path is known. */
export interface AssetFile {
  path: string;
  mime: string;
  bytes?: Uint8Array;
}

export interface ManualAction {
  /** Numbered, copy-paste-ready checklist for the human operator. */
  instructions: string;
  /** Everything the human needs to paste: title, description, tags, price, asset paths, ... */
  payload: Record<string, unknown>;
}

export interface PublishResult {
  ok: boolean;
  externalId?: string;
  url?: string;
  /** Present when the adapter cannot act (no API / not connected). The Airlock shows this to the human. */
  manual?: ManualAction;
  error?: string;
}

export interface SaleRecord {
  externalOrderId: string;
  listingExternalId: string;
  units: number;
  grossCents: number;
  feeCents: number;
  occurredAt: string;
  /**
   * Extension (optional): fulfilment cost reported by the platform, e.g. the
   * Printify base cost of a line item. Absent when the platform does not know it.
   */
  fulfilmentCents?: number;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  capability(): PlatformCapability;
  createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult>;
  updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult>;
  delist(listing: Listing): Promise<PublishResult>;
  readSales(sinceIso: string): Promise<SaleRecord[]>;
}

/** process.env passed in by the server. Adapters never read process.env directly. */
export interface AdapterEnv {
  [key: string]: string | undefined;
}

export type FetchImpl = typeof fetch;

/** What every real adapter is constructed with. */
export interface AdapterContext {
  env: AdapterEnv;
  fetchImpl: FetchImpl;
}

export interface AdapterRegistry {
  get(platform: Platform): PlatformAdapter;
  capabilities(): PlatformCapability[];
  /** Which platform a venture kind publishes to first, given what is connected. */
  primaryPlatformFor(kind: VentureKind): Platform;
  /**
   * Extension (optional): the platform that fulfils physical orders for a
   * kind, e.g. pod-store -> printify. Undefined when nothing needs fulfilment.
   */
  fulfilmentPlatformFor(kind: VentureKind): Platform | undefined;
}

export interface RegistryOptions {
  mode: 'sim' | 'live';
  fetchImpl?: FetchImpl;
}
