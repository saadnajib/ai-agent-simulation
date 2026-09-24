/**
 * Cost model and per-kind unit economics.
 *
 * Everything here is deliberately pessimistic-realistic. The point of the
 * station is to show what these businesses actually return, not to flatter
 * them. Each number carries a one-line note on where it comes from.
 */
import type { Platform, TaskKind, VentureKind } from './types.js';

// ---------------------------------------------------------------------------
// Model prices
// ---------------------------------------------------------------------------

export interface ModelPrice {
  inputCentsPerMTok: number;
  outputCentsPerMTok: number;
}

/** Cents per million tokens. 'scripted' is the free deterministic brain used in sim mode. */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5': { inputCentsPerMTok: 500, outputCentsPerMTok: 2500 },
  'claude-sonnet-5': { inputCentsPerMTok: 200, outputCentsPerMTok: 1000 },
  'claude-haiku-4-5': { inputCentsPerMTok: 100, outputCentsPerMTok: 500 },
  scripted: { inputCentsPerMTok: 0, outputCentsPerMTok: 0 },
};

/** Model used for budgeting estimates when the real model is not known yet. */
export const DEFAULT_ESTIMATE_MODEL = 'claude-sonnet-5';

export function priceFor(model: string): ModelPrice {
  const price = MODEL_PRICES[model];
  if (price !== undefined) return price;
  // Unknown model ids are billed at the most expensive tier so budgets stay honest.
  return MODEL_PRICES['claude-opus-5'] as ModelPrice;
}

/** Exact cost in whole cents (rounded up so budgets never under-count). */
export function tokenCostCents(model: string, tokensIn: number, tokensOut: number): number {
  const price = priceFor(model);
  const raw =
    (Math.max(0, tokensIn) * price.inputCentsPerMTok + Math.max(0, tokensOut) * price.outputCentsPerMTok) / 1_000_000;
  return Math.ceil(raw);
}

// ---------------------------------------------------------------------------
// Task token budgets
// ---------------------------------------------------------------------------

export interface TaskTokenProfile {
  /** Total tokens (input + output) a typical run of this task consumes. */
  totalTokens: number;
  /** Fraction of the total that is output. Prompts and file reads dominate input. */
  outputShare: number;
}

/**
 * Typical token consumption by task kind. Ranges from the spec: research
 * 3-6k, design/write 6-15k, review 2-4k, publish 1k, overseer epoch 20k. The
 * midpoint is used so the estimate is neither best nor worst case.
 */
export const TASK_TOKEN_PROFILES: Record<TaskKind, TaskTokenProfile> = {
  'research-niche': { totalTokens: 4_500, outputShare: 0.3 },
  'analyse-competitors': { totalTokens: 4_500, outputShare: 0.3 },
  'design-artwork': { totalTokens: 10_500, outputShare: 0.4 },
  'create-mockups': { totalTokens: 6_000, outputShare: 0.3 },
  'create-asset-pack': { totalTokens: 12_000, outputShare: 0.45 },
  'design-thumbnail': { totalTokens: 8_000, outputShare: 0.4 },
  'write-article': { totalTokens: 12_000, outputShare: 0.5 },
  'build-template': { totalTokens: 15_000, outputShare: 0.5 },
  'compose-track': { totalTokens: 9_000, outputShare: 0.4 },
  'write-listing': { totalTokens: 6_000, outputShare: 0.4 },
  'publish-listing': { totalTokens: 1_000, outputShare: 0.2 },
  'fulfil-order': { totalTokens: 8_000, outputShare: 0.4 },
  'optimise-listing': { totalTokens: 6_000, outputShare: 0.3 },
  promote: { totalTokens: 6_000, outputShare: 0.4 },
  'review-output': { totalTokens: 3_000, outputShare: 0.25 },
  'overseer-epoch': { totalTokens: 20_000, outputShare: 0.2 },
};

/** Rough per-task cost used for budgeting before a task runs (and as the sim-mode charge). */
export function estimateTaskCostCents(kind: TaskKind, model: string): number {
  const profile = TASK_TOKEN_PROFILES[kind];
  const tokensOut = Math.round(profile.totalTokens * profile.outputShare);
  const tokensIn = profile.totalTokens - tokensOut;
  return tokenCostCents(model, tokensIn, tokensOut);
}

// ---------------------------------------------------------------------------
// Platform fees
// ---------------------------------------------------------------------------

export interface PlatformFee {
  /** Fraction of gross taken by the platform. */
  rate: number;
  /** Fixed cents per order (listing fee, payment processing minimum, etc.). */
  fixedCents: number;
}

export const PLATFORM_FEES: Record<Platform, PlatformFee> = {
  // Etsy: 6.5% transaction + $0.20 listing + 3% + $0.25 payment processing (Etsy fee schedule).
  etsy: { rate: 0.095, fixedCents: 45 },
  // Printify/Printful charge nothing per sale; the base product cost is the listing's unitCost.
  printify: { rate: 0, fixedCents: 0 },
  printful: { rate: 0, fixedCents: 0 },
  // Fiverr takes a flat 20% of every order (Fiverr seller help centre).
  fiverr: { rate: 0.2, fixedCents: 0 },
  // itch.io defaults to a 10% revenue share (creator-adjustable, 10% is the norm).
  itch: { rate: 0.1, fixedCents: 0 },
  // Gumroad: 10% flat plus payment processing (~$0.50 per charge).
  gumroad: { rate: 0.1, fixedCents: 50 },
  // Lemon Squeezy: 5% + $0.50 per transaction as merchant of record.
  lemonsqueezy: { rate: 0.05, fixedCents: 50 },
  // Self-hosted WordPress: no platform take; hosting is a subscription ledger entry.
  wordpress: { rate: 0, fixedCents: 0 },
  // Amazon Associates: the commission itself is the revenue, nothing is deducted from it.
  'amazon-associates': { rate: 0, fixedCents: 0 },
  // Unity Asset Store keeps 30% of each sale (Unity publisher agreement).
  'unity-asset-store': { rate: 0.3, fixedCents: 0 },
  // DistroKid: annual subscription, 0% of royalties; the subscription is a ledger entry.
  distrokid: { rate: 0, fixedCents: 0 },
  // Social channels do not sell directly.
  pinterest: { rate: 0, fixedCents: 0 },
  x: { rate: 0, fixedCents: 0 },
  // Sim placeholder: a generic 10% marketplace.
  mock: { rate: 0.1, fixedCents: 0 },
};

/** Fee in cents for an order of `grossCents`, rounded up. */
export function platformFeeCents(platform: Platform, grossCents: number, orders = 1): number {
  const fee = PLATFORM_FEES[platform];
  return Math.ceil(grossCents * fee.rate) + fee.fixedCents * Math.max(0, orders);
}

// ---------------------------------------------------------------------------
// Per-kind unit economics
// ---------------------------------------------------------------------------

export interface KindEconomics {
  typicalPriceCents: number;
  unitCostCents: number;
  /** Per live listing, at quality 1, unsaturated niche, day 0. */
  baseDailyImpressions: number;
  baseCtr: number;
  baseConversion: number;
  /** Listing freshness decay half-life in ticks. */
  decayHalfLifeTicks: number;
  /** Impressions scale by 1/(1 + liveListingsInNiche/saturationK). */
  saturationK: number;
  refundRate: number;
  /** How many listings one production cycle yields. */
  unitsPerBatch: number;
  /**
   * Optional ramp: impressions scale by min(1, age/indexingRampTicks) so
   * search-dependent listings (blog posts) earn nothing while they index.
   */
  indexingRampTicks?: number;
}

export const KIND_ECONOMICS: Record<VentureKind, KindEconomics> = {
  'pod-store': {
    // Etsy tee median asking price sits around $22-28 (Etsy search sampling, 2025).
    typicalPriceCents: 2499,
    // Printify Bella+Canvas 3001 base ~$11-13 plus the part of shipping the seller eats: ~$16.
    unitCostCents: 1600,
    // Etsy Seller Handbook / seller forums: a new listing without ads sees ~5-30 views a day.
    baseDailyImpressions: 15,
    // Etsy search CTR for unpromoted listings is typically 2-4%.
    baseCtr: 0.03,
    // Etsy seller handbook: typical new-listing conversion 1-3%.
    baseConversion: 0.02,
    // Etsy's recency boost fades over roughly the first month.
    decayHalfLifeTicks: 24 * 30,
    // POD niches saturate fast: ~20 similar listings halve the traffic each one gets.
    saturationK: 20,
    // Apparel POD refund/return rate ~3% (Printify merchant data).
    refundRate: 0.03,
    // One design cycle yields 3 variants (colourways / product types).
    unitsPerBatch: 3,
  },
  'game-assets': {
    // itch.io 2D asset packs cluster at $5-15; $9.99 is the modal price.
    typicalPriceCents: 999,
    // Digital download, no fulfilment cost.
    unitCostCents: 0,
    // itch.io asset pages: long tail, ~10-40 views a day for a fresh pack.
    baseDailyImpressions: 25,
    // Browse-to-page CTR on itch ~5-7% for a pack with a good cover.
    baseCtr: 0.06,
    // Page-to-purchase ~2-4% (itch analytics shared by asset makers).
    baseConversion: 0.03,
    // itch "new" shelf boost lasts ~6 weeks.
    decayHalfLifeTicks: 24 * 45,
    // Pixel-art tileset niches are crowded; ~15 packs per niche halves traffic.
    saturationK: 15,
    // Digital goods refunds are rare but happen: ~2%.
    refundRate: 0.02,
    // One production cycle yields one pack.
    unitsPerBatch: 1,
  },
  'thumbnail-service': {
    // Fiverr thumbnail gigs start at $10-25; $20 basic tier is the common entry point.
    typicalPriceCents: 2000,
    // Fulfilling one order costs roughly one image generation plus a revision round.
    unitCostCents: 150,
    // Fiverr gig impressions without reviews: ~10-30 a day (Fiverr seller analytics).
    baseDailyImpressions: 20,
    // Gig click-through without reviews is ~2-4%.
    baseCtr: 0.03,
    // Buyers rarely order from zero-review sellers: ~1-3% conversion.
    baseConversion: 0.02,
    // Gigs are evergreen but the "new seller" boost fades over two months.
    decayHalfLifeTicks: 24 * 60,
    // The thumbnail category has thousands of gigs; each 10 similar gigs halve exposure.
    saturationK: 10,
    // Fiverr cancellation/refund rate for new sellers ~5%.
    refundRate: 0.05,
    // One cycle yields one gig listing.
    unitsPerBatch: 1,
  },
  'affiliate-blog': {
    // Amazon Associates: 3-4% on a ~$150 average order, i.e. ~$6 per conversion.
    typicalPriceCents: 600,
    // No fulfilment cost; hosting is a subscription.
    unitCostCents: 0,
    // A post on a new domain with no authority earns ~1-5 organic visits a day after indexing.
    baseDailyImpressions: 3,
    // Roughly 8% of readers click an affiliate link (affiliate marketer surveys).
    baseCtr: 0.08,
    // Amazon's 24h cookie converts ~3-5% of clicks.
    baseConversion: 0.04,
    // Evergreen content decays slowly: half its traffic in ~6 months.
    decayHalfLifeTicks: 24 * 180,
    // Comparison keywords are competitive; ~30 posts per niche halves each post's share.
    saturationK: 30,
    // Refunds cancel the commission: ~1% (Amazon returns net of commission).
    refundRate: 0.01,
    // One writing cycle yields two articles.
    unitsPerBatch: 2,
    // Google typically takes 2-6 weeks to index and rank a post on a new domain.
    indexingRampTicks: 24 * 28,
  },
  'software-templates': {
    // Gumroad/Lemon Squeezy boilerplates and Notion templates cluster at $9-29.
    typicalPriceCents: 1900,
    // Digital download, no fulfilment cost.
    unitCostCents: 0,
    // A template with no audience gets ~5-15 marketplace views a day.
    baseDailyImpressions: 10,
    // Discover-page CTR ~3-5%.
    baseCtr: 0.04,
    // Landing-page conversion for cold traffic ~1-3%.
    baseConversion: 0.02,
    // Frameworks move on; a template loses half its relevance in ~2 months.
    decayHalfLifeTicks: 24 * 60,
    // Starter-kit niches are crowded; ~15 similar templates halve traffic.
    saturationK: 15,
    // Digital refunds on Gumroad ~3-5%.
    refundRate: 0.04,
    // One build cycle yields one template.
    unitsPerBatch: 1,
  },
  'music-packs': {
    // Royalty-free loop packs on itch/Gumroad sell at $8-15.
    typicalPriceCents: 1200,
    // Digital download, no fulfilment cost.
    unitCostCents: 0,
    // Music packs get less browse traffic than art: ~5-12 views a day.
    baseDailyImpressions: 8,
    // Audio previews convert browse to page at ~3-5%.
    baseCtr: 0.04,
    // Page-to-purchase ~1-3%.
    baseConversion: 0.02,
    // Music packs are the most evergreen asset: half traffic in ~3 months.
    decayHalfLifeTicks: 24 * 90,
    // Fewer competitors per niche than art: ~15 packs halve traffic.
    saturationK: 15,
    // Digital refunds ~2%.
    refundRate: 0.02,
    // One composition cycle yields two small packs.
    unitsPerBatch: 2,
  },
};

/** Gross margin per unit after platform fees and fulfilment, for the kind's primary platform. */
export function unitMarginCents(kind: VentureKind, platform: Platform): number {
  const econ = KIND_ECONOMICS[kind];
  return econ.typicalPriceCents - platformFeeCents(platform, econ.typicalPriceCents) - econ.unitCostCents;
}

/** Expected sales per day for one live listing at the given quality, unsaturated, day 0. */
export function expectedDailySales(kind: VentureKind, quality: number): number {
  const econ = KIND_ECONOMICS[kind];
  const q = Math.min(1, Math.max(0, quality));
  return econ.baseDailyImpressions * q * q * econ.baseCtr * econ.baseConversion;
}
