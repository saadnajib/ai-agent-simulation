/**
 * @eternity/adapters public surface.
 *
 * PlatformAdapter interface, the registry that picks an adapter per platform
 * and run mode, the mock adapter for sim, the draft-only adapter for anything
 * the station cannot operate itself, and the real adapters.
 */
export type {
  AdapterContext,
  AdapterEnv,
  AdapterRegistry,
  AssetFile,
  FetchImpl,
  ManualAction,
  PlatformAdapter,
  PublishResult,
  RegistryOptions,
  SaleRecord,
} from './types.js';

export { createAdapterRegistry, buildLiveAdapter, PLATFORM_PREFERENCES, FULFILMENT_PLATFORMS, KNOWN_PLATFORMS } from './registry.js';
export { PLATFORM_FEES, feesFor, platformFeeCents } from './fees.js';
export type { PlatformFee } from './fees.js';

export { MockAdapter, createMockAdapter, mockCapability, MOCK_BASE_URL } from './mock.js';
export {
  DraftOnlyAdapter,
  buildManualPayload,
  buildChecklist,
  genericListingSteps,
  manualResult,
  PLATFORM_LABELS,
  PLATFORM_DASHBOARDS,
} from './draftOnly.js';
export type { DraftOnlyOptions, StepBuilder } from './draftOnly.js';

export { PrintifyAdapter, createPrintifyAdapter, printifyCapability, printifyConnected, PRINTIFY_BASE_URL, PRINTIFY_REQUIRED_ENV, PRINTIFY_TOS_NOTES } from './printify.js';
export { EtsyAdapter, createEtsyAdapter, etsyCapability, etsyConnected, etsyListingSteps, etsyTags, ETSY_BASE_URL, ETSY_REQUIRED_ENV, ETSY_TOS_NOTES } from './etsy.js';
export { GumroadAdapter, createGumroadAdapter, gumroadCapability, gumroadConnected, gumroadListingSteps, GUMROAD_BASE_URL, GUMROAD_REQUIRED_ENV, GUMROAD_TOS_NOTES } from './gumroad.js';
export { ItchAdapter, createItchAdapter, itchCapability, itchConnected, butlerPushCommand, ITCH_BASE_URL, ITCH_REQUIRED_ENV, ITCH_TOS_NOTES } from './itch.js';
export type { ItchGameStats } from './itch.js';
export { WordPressAdapter, createWordPressAdapter, wordpressCapability, wordpressConnected, articleHtml, WORDPRESS_REQUIRED_ENV, WORDPRESS_TOS_NOTES } from './wordpress.js';
export { FiverrAdapter, createFiverrAdapter, fiverrCapability, fiverrGigSteps, FIVERR_TOS_NOTES } from './fiverr.js';
export { DistroKidAdapter, createDistroKidAdapter, distrokidCapability, distrokidReleaseSteps, DISTROKID_TOS_NOTES } from './distrokid.js';
export { PinterestAdapter, createPinterestAdapter, pinterestCapability, pinterestConnected, pinterestPinSteps, PINTEREST_BASE_URL, PINTEREST_REQUIRED_ENV, PINTEREST_TOS_NOTES } from './pinterest.js';
export { profileCapability } from './profiles.js';
export { markdownToHtml, slugify, centsToDollars } from './util.js';
