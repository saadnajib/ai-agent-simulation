/**
 * Eternity Station — shared domain model.
 *
 * Everything the server persists, the Overseer reasons about, and the game
 * renders is described here. Keep this file free of IO and framework types.
 *
 * Money is always integer cents. Time is measured in ticks (1 tick = 1
 * simulated hour) plus a wall-clock ISO timestamp where useful.
 */

// ---------------------------------------------------------------------------
// Station geography
// ---------------------------------------------------------------------------

/** Every room on the station. The Overseer core sits at the centre. */
export type RoomId =
  | 'core' // Overseer (HERMES). Centre of the station.
  | 'airlock' // Human approval queue. Nothing leaves the station without passing here.
  | 'reactor' // Treasury + token budget. Power for the station.
  | 'observatory' // Research / niche scouting / trend + keyword analysis.
  | 'print-foundry' // Print-on-demand design studio (Etsy stores).
  | 'pixel-forge' // 2D game asset production (itch.io, Gumroad).
  | 'thumbnail-bay' // Thumbnail / creative-service fulfilment (Fiverr-style gigs).
  | 'scriptorium' // Affiliate + SEO blog writing.
  | 'prototype-lab' // Software templates / micro-tools.
  | 'sound-deck' // Music loops, SFX packs, stock tracks.
  | 'broadcast-tower' // Distribution: social, Pinterest, SEO, listing optimisation.
  | 'quarters'; // Idle crew rest here between assignments.

export const ROOM_IDS: readonly RoomId[] = [
  'core',
  'airlock',
  'reactor',
  'observatory',
  'print-foundry',
  'pixel-forge',
  'thumbnail-bay',
  'scriptorium',
  'prototype-lab',
  'sound-deck',
  'broadcast-tower',
  'quarters',
] as const;

export interface RoomSpec {
  id: RoomId;
  name: string;
  /** One-line purpose shown in the UI tooltip. */
  purpose: string;
  /** Which venture kind this room produces for (undefined = shared infrastructure). */
  ventureKind?: VentureKind;
  /** Roles that normally work in this room. */
  roles: AgentRole[];
}

// ---------------------------------------------------------------------------
// Ventures (the businesses)
// ---------------------------------------------------------------------------

export type VentureKind =
  | 'pod-store' // Print-on-demand storefront (Etsy + Printify/Printful).
  | 'game-assets' // 2D sprite/tileset packs sold on itch.io / Gumroad.
  | 'thumbnail-service' // Paid YouTube thumbnail gigs.
  | 'affiliate-blog' // SEO articles monetised by affiliate commissions.
  | 'software-templates' // Boilerplates, Notion templates, micro-tools.
  | 'music-packs'; // Royalty-free loops / SFX / stock tracks.

export const VENTURE_KINDS: readonly VentureKind[] = [
  'pod-store',
  'game-assets',
  'thumbnail-service',
  'affiliate-blog',
  'software-templates',
  'music-packs',
] as const;

export type VentureStatus =
  | 'incubating' // Research phase; no listings yet.
  | 'active' // Producing + publishing.
  | 'scaling' // Proven ROI; gets extra budget.
  | 'paused' // Human paused it.
  | 'killed'; // Overseer or human shut it down for negative ROI.

export type Platform =
  | 'etsy'
  | 'printify'
  | 'printful'
  | 'fiverr'
  | 'itch'
  | 'gumroad'
  | 'lemonsqueezy'
  | 'wordpress'
  | 'amazon-associates'
  | 'unity-asset-store'
  | 'distrokid'
  | 'pinterest'
  | 'x'
  | 'mock';

export interface Storefront {
  id: string;
  ventureId: string;
  platform: Platform;
  name: string;
  /** External shop/account identifier when connected. */
  externalId?: string;
  url?: string;
  /** false => adapter is in draft-only mode; publish produces an Airlock payload for a human. */
  connected: boolean;
}

/** Rolling metrics; recomputed from the ledger + listing stats each epoch. */
export interface VentureMetrics {
  revenueCents: number;
  costCents: number; // token spend + platform fees + fulfilment cost
  profitCents: number; // revenue - cost
  /** profitCents / max(costCents, 1). Negative until a venture pays back. */
  roi: number;
  unitsProduced: number;
  unitsPublished: number;
  unitsSold: number;
  impressions: number;
  clicks: number;
  conversionRate: number; // unitsSold / max(clicks, 1)
  /** Trailing-window figures used by the allocator (window length in ticks is policy-defined). */
  trailingRevenueCents: number;
  trailingCostCents: number;
  trailingRoi: number;
  /** Ticks since the last sale; large values are a kill signal. */
  ticksSinceLastSale: number | null;
}

export interface Venture {
  id: string;
  kind: VentureKind;
  name: string;
  /** The niche/thesis this venture is testing, e.g. "vintage botanical cat tees". */
  thesis: string;
  roomId: RoomId;
  status: VentureStatus;
  createdAtTick: number;
  /** Share of the station's token budget the allocator currently assigns (0..1). */
  budgetShare: number;
  /** Agent ids currently assigned. */
  crew: string[];
  storefronts: Storefront[];
  metrics: VentureMetrics;
  /** Why the venture is in its current status, written by the Overseer. */
  statusReason?: string;
}

// ---------------------------------------------------------------------------
// Listings (what is actually for sale)
// ---------------------------------------------------------------------------

export type ListingStatus = 'draft' | 'awaiting-approval' | 'live' | 'delisted' | 'rejected';

export interface Listing {
  id: string;
  ventureId: string;
  storefrontId: string;
  platform: Platform;
  title: string;
  description: string;
  tags: string[];
  priceCents: number;
  /** Cost to fulfil one unit (POD base price, payout fee, etc.). */
  unitCostCents: number;
  /** 0..1 quality score assigned by the reviewer agent; drives simulated demand. */
  quality: number;
  /** Niche key used by the market simulator for saturation. */
  niche: string;
  status: ListingStatus;
  createdAtTick: number;
  publishedAtTick?: number;
  externalId?: string;
  url?: string;
  /** Paths (relative to WORKSPACE_ROOT) of the deliverable files. */
  assets: string[];
  stats: {
    impressions: number;
    clicks: number;
    sales: number;
    revenueCents: number;
  };
}

// ---------------------------------------------------------------------------
// Crew (the agents)
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'overseer'
  | 'scout' // market research
  | 'designer' // POD artwork
  | 'pixel-artist' // game assets
  | 'thumbnail-artist'
  | 'writer' // blog / listing copy
  | 'engineer' // software templates
  | 'composer' // music
  | 'marketer' // distribution
  | 'reviewer'; // QA: scores quality, blocks junk before the Airlock

export const AGENT_ROLES: readonly AgentRole[] = [
  'overseer',
  'scout',
  'designer',
  'pixel-artist',
  'thumbnail-artist',
  'writer',
  'engineer',
  'composer',
  'marketer',
  'reviewer',
] as const;

export type AgentStatus =
  | 'idle'
  | 'walking'
  | 'working'
  | 'blocked' // waiting on approval / external dependency
  | 'resting' // budget exhausted or cooling down after failures
  | 'offline';

export interface GridPosition {
  x: number;
  y: number;
}

export interface CrewAgent {
  id: string;
  name: string;
  role: AgentRole;
  /** Room the agent is currently in (or walking toward). */
  roomId: RoomId;
  ventureId?: string;
  status: AgentStatus;
  currentTaskId?: string;
  /** Tile coordinates on the station map, owned by the server so all clients agree. */
  position: GridPosition;
  /** Short line shown in the speech bubble. */
  speech?: string;
  /** Model used in live mode; 'scripted' in sim mode. */
  brain: string;
  stats: {
    tasksCompleted: number;
    tasksFailed: number;
    tokensIn: number;
    tokensOut: number;
    costCents: number;
    revenueAttributedCents: number;
  };
  hiredAtTick: number;
}

// ---------------------------------------------------------------------------
// Tasks (units of work)
// ---------------------------------------------------------------------------

export type TaskKind =
  // Observatory
  | 'research-niche'
  | 'analyse-competitors'
  // Production
  | 'design-artwork'
  | 'create-mockups'
  | 'create-asset-pack'
  | 'design-thumbnail'
  | 'write-article'
  | 'build-template'
  | 'compose-track'
  // Commercial
  | 'write-listing'
  | 'publish-listing'
  | 'fulfil-order'
  | 'optimise-listing'
  // Distribution
  | 'promote'
  // Governance
  | 'review-output'
  | 'overseer-epoch';

export type TaskStatus =
  | 'queued'
  | 'assigned'
  | 'in-progress'
  | 'awaiting-approval'
  | 'approved'
  | 'rejected'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface TaskOutput {
  summary: string;
  /** Files written to the venture workspace (relative paths). */
  files: string[];
  /** Structured payload; shape depends on TaskKind (see docs/architecture/CONTRACTS.md). */
  data: Record<string, unknown>;
  /** Reviewer-assigned quality 0..1 when applicable. */
  quality?: number;
}

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  ventureId?: string;
  roomId: RoomId;
  /** Role required to execute. */
  role: AgentRole;
  assignedTo?: string;
  status: TaskStatus;
  /** Higher runs first. */
  priority: number;
  input: Record<string, unknown>;
  output?: TaskOutput;
  /** Ids of tasks that must be done first. */
  dependsOn: string[];
  /** Estimated tokens/cents so the allocator can budget before running. */
  estimateCents: number;
  costCents: number;
  attempts: number;
  createdAtTick: number;
  startedAtTick?: number;
  finishedAtTick?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Airlock (human-in-the-loop approvals)
// ---------------------------------------------------------------------------

export type ApprovalKind =
  | 'publish' // put a listing/article/gig live
  | 'spend' // spend real money (ads, samples, subscriptions)
  | 'account' // create/connect an external account
  | 'payout' // move money
  | 'customer' // reply to a real customer / deliver an order
  | 'kill' // Overseer wants to kill a venture with sunk cost above threshold
  | 'hire'; // hire crew beyond the configured cap

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  risk: RiskLevel;
  title: string;
  /** Plain-language summary a human can approve in 10 seconds. */
  summary: string;
  ventureId?: string;
  taskId?: string;
  listingId?: string;
  requestedBy: string; // agent id
  /** Payload the adapter will execute on approval (or hand to the human in draft-only mode). */
  payload: Record<string, unknown>;
  /** When the adapter is not connected, the human must do this by hand. */
  manualInstructions?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestedAtTick: number;
  decidedAt?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Ledger & treasury
// ---------------------------------------------------------------------------

export type LedgerKind =
  | 'revenue'
  | 'token-cost'
  | 'platform-fee'
  | 'fulfilment-cost'
  | 'refund'
  | 'payout'
  | 'subscription'
  | 'adjustment';

export interface LedgerEntry {
  id: string;
  tick: number;
  ts: string; // ISO wall clock
  kind: LedgerKind;
  /** Signed cents: revenue positive, costs negative. */
  amountCents: number;
  ventureId?: string;
  agentId?: string;
  taskId?: string;
  listingId?: string;
  memo: string;
  source: 'sim' | 'live';
}

export interface Milestone {
  label: string;
  cents: number;
  reachedAtTick?: number;
}

export interface Treasury {
  balanceCents: number;
  lifetimeRevenueCents: number;
  lifetimeCostCents: number;
  /** The long-term target. Default 1e14 cents = one trillion dollars. */
  targetCents: number;
  milestones: Milestone[];
  /** Trailing 24-tick (one simulated day) figures. */
  dailyRevenueCents: number;
  dailyCostCents: number;
  dailyProfitCents: number;
  /** Remaining allowance for the current day under DAILY_TOKEN_BUDGET_CENTS. */
  dailyTokenBudgetRemainingCents: number;
  /** Ticks until the balance hits zero at current burn; null if profitable. */
  runwayTicks: number | null;
  /** Ticks to target at current daily profit; null if profit <= 0. */
  etaTicksToTarget: number | null;
}

// ---------------------------------------------------------------------------
// Overseer policy
// ---------------------------------------------------------------------------

export interface AllocationPolicy {
  /** Ticks between allocation epochs. */
  epochTicks: number;
  /** Trailing window (ticks) for ROI measurement. */
  windowTicks: number;
  /** Minimum share every non-killed venture keeps so it can still be measured. */
  explorationFloor: number;
  /** Ventures younger than this are never killed. */
  graceTicks: number;
  /** Kill when trailing ROI < this after the grace period. */
  killRoiThreshold: number;
  /** Kill when no sale for this many ticks after the grace period. */
  killNoSaleTicks: number;
  /** Promote to 'scaling' when trailing ROI >= this. */
  scaleRoiThreshold: number;
  /** Max concurrent ventures. */
  maxVentures: number;
  /** Max crew per venture. */
  maxCrewPerVenture: number;
}

export interface OverseerDirective {
  id: string;
  tick: number;
  /** One-paragraph reasoning shown in the Core panel. */
  rationale: string;
  actions: OverseerAction[];
}

export type OverseerAction =
  | { type: 'set-budget-share'; ventureId: string; share: number }
  | { type: 'set-status'; ventureId: string; status: VentureStatus; reason: string }
  | { type: 'spawn-venture'; kind: VentureKind; thesis: string; name: string }
  | { type: 'assign-agent'; agentId: string; ventureId: string; roomId: RoomId }
  | { type: 'enqueue-task'; task: Omit<Task, 'id' | 'status' | 'attempts' | 'costCents' | 'createdAtTick'> }
  | { type: 'hire'; role: AgentRole; ventureId?: string }
  | { type: 'broadcast'; message: string };

// ---------------------------------------------------------------------------
// Simulation clock & full state
// ---------------------------------------------------------------------------

export type RunMode = 'sim' | 'live';

export interface Clock {
  tick: number;
  /** Simulated ISO date derived from tick (tick 0 = epoch start). */
  simTime: string;
  paused: boolean;
  /** 1 = TICK_HZ ticks per second; 4, 16, 64 for fast-forward. */
  speed: number;
}

export interface StationState {
  mode: RunMode;
  clock: Clock;
  treasury: Treasury;
  policy: AllocationPolicy;
  ventures: Venture[];
  agents: CrewAgent[];
  tasks: Task[];
  listings: Listing[];
  approvals: ApprovalRequest[];
  /** Most recent ledger entries (server decides how many to ship in a snapshot). */
  ledger: LedgerEntry[];
  /** Most recent directives, newest last. */
  directives: OverseerDirective[];
}

// ---------------------------------------------------------------------------
// Adapter capability description (used by UI + Overseer to know what is real)
// ---------------------------------------------------------------------------

export interface PlatformCapability {
  platform: Platform;
  /** True when credentials are present and the API is usable. */
  connected: boolean;
  /** Does the platform expose a seller API at all? Fiverr/DistroKid: no. */
  hasApi: boolean;
  /** What the adapter can do right now. */
  can: {
    createListing: boolean;
    updateListing: boolean;
    readSales: boolean;
    fulfilOrder: boolean;
  };
  /** Human-readable Terms-of-Service constraint the Overseer must respect. */
  tosNotes: string[];
  /** Platform take rate as a fraction plus fixed fee cents, for the ledger. */
  fees: { rate: number; fixedCents: number };
}
