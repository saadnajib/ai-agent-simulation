/**
 * Mock world for developing the client without a server (`?mock=1`).
 *
 * `createMockState` fabricates a plausible StationState; `createMockTransport`
 * plays a fake server: it emits ticks, walks agents along real paths from
 * core's findPath, makes sales, writes the ledger, issues directives and
 * answers commands locally so every dock control can be exercised.
 */
import {
  DEFAULT_MILESTONES,
  DEFAULT_POLICY,
  ROOM_IDS,
  ROOM_SPECS,
  buildStationMap,
  computeTreasury,
  computeVentureMetrics,
  createRng,
  findPath,
  tickToSimTime,
  type AgentRole,
  type AgentStatus,
  type ApprovalRequest,
  type CrewAgent,
  type GridPosition,
  type LedgerEntry,
  type Listing,
  type OverseerDirective,
  type Platform,
  type RoomId,
  type Rng,
  type StationCommand,
  type StationEvent,
  type StationMap,
  type StationState,
  type Task,
  type TaskKind,
  type Treasury,
  type Venture,
  type VentureKind,
  type VentureStatus,
} from '@eternity/core';
import type { Transport } from './net.js';
import { expectedTickMs } from './store.js';

const TARGET_CENTS = 1e14;
const DAILY_TOKEN_BUDGET_CENTS = 2000;
const START_TICK = 412;
const WINDOW_TICKS = DEFAULT_POLICY.windowTicks;

interface VentureSeed {
  id: string;
  kind: VentureKind;
  name: string;
  thesis: string;
  status: VentureStatus;
  createdAtTick: number;
  budgetShare: number;
  platform: Platform;
  liveListings: number;
  priceCents: number;
  unitCostCents: number;
  quality: number;
  salesPerDay: number;
  statusReason?: string;
}

const VENTURE_SEEDS: VentureSeed[] = [
  {
    id: 'ven_vega01',
    kind: 'pod-store',
    name: 'Vega Prints',
    thesis: 'Vintage botanical cat tees for indoor gardeners',
    status: 'active',
    createdAtTick: 12,
    budgetShare: 0.32,
    platform: 'etsy',
    liveListings: 6,
    priceCents: 2499,
    unitCostCents: 1310,
    quality: 0.68,
    salesPerDay: 0.9,
  },
  {
    id: 'ven_altr02',
    kind: 'game-assets',
    name: 'Altair Sprites',
    thesis: '16x16 top-down dungeon tilesets with matching UI kits',
    status: 'scaling',
    createdAtTick: 40,
    budgetShare: 0.46,
    platform: 'itch',
    liveListings: 4,
    priceCents: 1200,
    unitCostCents: 0,
    quality: 0.81,
    salesPerDay: 1.6,
    statusReason: 'Trailing ROI +0.74 over 7 days; doubling down.',
  },
  {
    id: 'ven_rigl03',
    kind: 'affiliate-blog',
    name: 'Rigel Journal',
    thesis: 'Budget home-espresso gear reviews with Amazon links',
    status: 'incubating',
    createdAtTick: 350,
    budgetShare: 0.22,
    platform: 'wordpress',
    liveListings: 0,
    priceCents: 0,
    unitCostCents: 0,
    quality: 0.6,
    salesPerDay: 0,
  },
];

interface CrewSeed {
  id: string;
  name: string;
  role: AgentRole;
  roomId: RoomId;
  ventureId?: string;
  status: AgentStatus;
  speech?: string;
}

const CREW_SEEDS: CrewSeed[] = [
  { id: 'agt_hermes', name: 'HERMES', role: 'overseer', roomId: 'core', status: 'working', speech: 'Capital follows evidence.' },
  { id: 'agt_vela', name: 'Vela', role: 'scout', roomId: 'observatory', status: 'working', speech: 'Espresso niche: 41 searches/day, weak competition.' },
  { id: 'agt_lyra', name: 'Lyra', role: 'scout', roomId: 'observatory', status: 'idle' },
  { id: 'agt_orion', name: 'Orion', role: 'designer', roomId: 'print-foundry', ventureId: 'ven_vega01', status: 'working', speech: 'Monstera cat, take three.' },
  { id: 'agt_cass', name: 'Cass', role: 'writer', roomId: 'print-foundry', ventureId: 'ven_vega01', status: 'working' },
  { id: 'agt_mira', name: 'Mira', role: 'reviewer', roomId: 'print-foundry', ventureId: 'ven_vega01', status: 'blocked', speech: 'Waiting on the Airlock.' },
  { id: 'agt_pix', name: 'Pix', role: 'pixel-artist', roomId: 'pixel-forge', ventureId: 'ven_altr02', status: 'working', speech: 'Tileset 4: lava biome.' },
  { id: 'agt_rook', name: 'Rook', role: 'reviewer', roomId: 'pixel-forge', ventureId: 'ven_altr02', status: 'working' },
  { id: 'agt_sol', name: 'Sol', role: 'writer', roomId: 'scriptorium', ventureId: 'ven_rigl03', status: 'working', speech: 'Draft: best grinders under $150.' },
  { id: 'agt_echo', name: 'Echo', role: 'marketer', roomId: 'broadcast-tower', ventureId: 'ven_altr02', status: 'idle' },
];

const LISTING_TITLES: Record<VentureKind, string[]> = {
  'pod-store': ['Monstera Cat Tee', 'Fern Study Cat Mug', 'Botanical Cat Tote', 'Cactus Cat Sticker Sheet', 'Orchid Cat Hoodie', 'Herbarium Cat Print'],
  'game-assets': ['Dungeon Tileset Vol. 1', 'Crypt UI Kit', 'Lava Biome Pack', 'Forest Ruins Tileset', 'Torch and Trap Sprites'],
  'thumbnail-service': ['YouTube Thumbnail, 24h turnaround'],
  'affiliate-blog': ['Best Grinders Under $150', 'Gaggia Classic vs Bambino'],
  'software-templates': ['SaaS Starter Kit'],
  'music-packs': ['Lo-fi Loops Vol. 1'],
};

const SPEECH_LINES: Record<AgentRole, string[]> = {
  overseer: ['Kill the losers, feed the winners.', 'Epoch in 6 hours.', 'Runway is not a strategy.', 'Show me the ledger.'],
  scout: ['Demand score 0.62.', 'Competition is thin here.', 'Keywords logged.', 'Trend is flat, skipping.'],
  designer: ['Adjusting the palette.', 'Mockups rendering.', 'Line weight looks right.'],
  'pixel-artist': ['Sixteen frames, no jitter.', 'Tiles seamless.', 'Palette locked at 32.'],
  'thumbnail-artist': ['Bigger face, brighter text.', 'Delivered in 3 hours.'],
  writer: ['1,400 words, one CTA.', 'Tags rewritten.', 'Headline A beats B.'],
  engineer: ['Tests green.', 'Template scaffolded.'],
  composer: ['120 BPM, C minor.', 'Loop exported.'],
  marketer: ['Pinned to 3 boards.', 'CTR up 0.4 points.', 'Queueing tomorrow’s posts.'],
  reviewer: ['Quality 0.74, approved.', 'Rejected: text unreadable.', 'Checking for trademark issues.'],
};

const TASK_TITLES: Partial<Record<TaskKind, string>> = {
  'research-niche': 'Research niche',
  'design-artwork': 'Design artwork',
  'create-mockups': 'Create mockups',
  'write-listing': 'Write listing copy',
  'review-output': 'Review output',
  'publish-listing': 'Publish listing',
  'create-asset-pack': 'Build asset pack',
  'write-article': 'Write article',
  promote: 'Promote on Pinterest',
};

function id(rng: Rng, prefix: string): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[rng.int(0, alphabet.length - 1)];
  return `${prefix}_${out}`;
}

function iso(tick: number): string {
  return tickToSimTime(tick);
}

function roomFor(kind: VentureKind): RoomId {
  for (const roomId of ROOM_IDS) if (ROOM_SPECS[roomId].ventureKind === kind) return roomId;
  return 'quarters';
}

function emptyMetrics(): Venture['metrics'] {
  return {
    revenueCents: 0,
    costCents: 0,
    profitCents: 0,
    roi: 0,
    unitsProduced: 0,
    unitsPublished: 0,
    unitsSold: 0,
    impressions: 0,
    clicks: 0,
    conversionRate: 0,
    trailingRevenueCents: 0,
    trailingCostCents: 0,
    trailingRoi: 0,
    ticksSinceLastSale: null,
  };
}

function buildVentures(): Venture[] {
  return VENTURE_SEEDS.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    thesis: s.thesis,
    roomId: roomFor(s.kind),
    status: s.status,
    createdAtTick: s.createdAtTick,
    budgetShare: s.budgetShare,
    crew: CREW_SEEDS.filter((c) => c.ventureId === s.id).map((c) => c.id),
    storefronts: [
      { id: `sf_${s.id}`, ventureId: s.id, platform: s.platform, name: s.name, connected: false, url: `https://example.invalid/${s.id}` },
    ],
    metrics: emptyMetrics(),
    ...(s.statusReason ? { statusReason: s.statusReason } : {}),
  }));
}

function buildListings(rng: Rng): Listing[] {
  const listings: Listing[] = [];
  for (const seed of VENTURE_SEEDS) {
    const titles = LISTING_TITLES[seed.kind];
    for (let i = 0; i < seed.liveListings; i++) {
      const title = titles[i % titles.length] ?? `${seed.name} item ${i + 1}`;
      listings.push({
        id: id(rng, 'lst'),
        ventureId: seed.id,
        storefrontId: `sf_${seed.id}`,
        platform: seed.platform,
        title,
        description: `${title}. ${seed.thesis}.`,
        tags: seed.thesis.toLowerCase().split(' ').slice(0, 5),
        priceCents: seed.priceCents,
        unitCostCents: seed.unitCostCents,
        quality: Math.min(0.95, seed.quality + rng.normal(0, 0.05)),
        niche: seed.thesis.split(' ').slice(0, 2).join('-').toLowerCase(),
        kind: seed.kind,
        status: 'live',
        createdAtTick: seed.createdAtTick + 30 + i * 20,
        publishedAtTick: seed.createdAtTick + 48 + i * 20,
        url: `https://example.invalid/${seed.platform}/${i}`,
        assets: [`${seed.id}/${i}/artwork.svg`],
        stats: { impressions: 0, clicks: 0, sales: 0, revenueCents: 0 },
      });
    }
  }
  return listings;
}

function saleEntries(rng: Rng, listing: Listing, tick: number): LedgerEntry[] {
  const gross = listing.priceCents;
  const fee = Math.round(gross * (listing.platform === 'etsy' ? 0.095 : 0.1)) + (listing.platform === 'etsy' ? 45 : 0);
  const base = { tick, ts: iso(tick), ventureId: listing.ventureId, listingId: listing.id, source: 'sim' as const };
  const entries: LedgerEntry[] = [
    { id: id(rng, 'led'), ...base, kind: 'revenue', amountCents: gross, memo: `Sale: ${listing.title}` },
    { id: id(rng, 'led'), ...base, kind: 'platform-fee', amountCents: -fee, memo: `${listing.platform} fees` },
  ];
  if (listing.unitCostCents > 0) {
    entries.push({ id: id(rng, 'led'), ...base, kind: 'fulfilment-cost', amountCents: -listing.unitCostCents, memo: 'Print and ship' });
  }
  listing.stats.sales += 1;
  listing.stats.revenueCents += gross;
  return entries;
}

/** Replays history from tick 0 so the treasury, metrics and milestones are consistent. */
function buildLedger(rng: Rng, listings: Listing[], tick: number): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const seedById = new Map(VENTURE_SEEDS.map((s) => [s.id, s] as const));
  for (let t = 0; t <= tick; t++) {
    for (const seed of VENTURE_SEEDS) {
      if (t < seed.createdAtTick) continue;
      const crew = CREW_SEEDS.filter((c) => c.ventureId === seed.id).length;
      const cost = rng.poisson(crew * 1.6);
      if (cost > 0) {
        entries.push({ id: id(rng, 'led'), tick: t, ts: iso(t), kind: 'token-cost', amountCents: -cost, ventureId: seed.id, memo: 'Worker tokens', source: 'sim' });
      }
    }
    if (t % 24 === 0) {
      entries.push({ id: id(rng, 'led'), tick: t, ts: iso(t), kind: 'token-cost', amountCents: -rng.int(6, 14), agentId: 'agt_hermes', memo: 'Overseer epoch', source: 'sim' });
    }
    for (const listing of listings) {
      if (listing.publishedAtTick === undefined || t < listing.publishedAtTick) continue;
      const seed = seedById.get(listing.ventureId);
      if (seed === undefined) continue;
      const perTick = (seed.salesPerDay / 24 / Math.max(1, seed.liveListings)) * (0.6 + listing.quality);
      if (rng.chance(perTick)) entries.push(...saleEntries(rng, listing, t));
    }
    for (const listing of listings) {
      if (listing.publishedAtTick !== undefined && t >= listing.publishedAtTick) {
        const imp = rng.poisson(0.8 + listing.quality);
        listing.stats.impressions += imp;
        if (imp > 0 && rng.chance(0.03 * imp)) listing.stats.clicks += 1;
      }
    }
  }
  return entries;
}

function buildTasks(rng: Rng, tick: number): Task[] {
  const mk = (kind: TaskKind, ventureId: string, roomId: RoomId, role: AgentRole, status: Task['status'], assignedTo?: string, extra?: string): Task => ({
    id: id(rng, 'tsk'),
    kind,
    title: `${TASK_TITLES[kind] ?? kind}${extra ? `: ${extra}` : ''}`,
    ventureId,
    roomId,
    role,
    status,
    priority: 5,
    input: {},
    dependsOn: [],
    estimateCents: rng.int(4, 30),
    costCents: status === 'done' ? rng.int(3, 28) : 0,
    attempts: status === 'failed' ? 2 : 1,
    createdAtTick: tick - rng.int(2, 40),
    ...(assignedTo ? { assignedTo } : {}),
  });
  return [
    mk('design-artwork', 'ven_vega01', 'print-foundry', 'designer', 'in-progress', 'agt_orion', 'Monstera cat'),
    mk('write-listing', 'ven_vega01', 'print-foundry', 'writer', 'in-progress', 'agt_cass', 'Fern mug'),
    mk('publish-listing', 'ven_vega01', 'print-foundry', 'reviewer', 'awaiting-approval', 'agt_mira', 'Orchid hoodie'),
    mk('design-artwork', 'ven_vega01', 'print-foundry', 'designer', 'done', 'agt_orion', 'Cactus stickers'),
    mk('create-asset-pack', 'ven_altr02', 'pixel-forge', 'pixel-artist', 'in-progress', 'agt_pix', 'Lava biome'),
    mk('review-output', 'ven_altr02', 'pixel-forge', 'reviewer', 'in-progress', 'agt_rook', 'Forest ruins'),
    mk('promote', 'ven_altr02', 'broadcast-tower', 'marketer', 'queued', undefined, 'Crypt UI kit'),
    mk('research-niche', 'ven_rigl03', 'observatory', 'scout', 'in-progress', 'agt_vela', 'Home espresso'),
    mk('write-article', 'ven_rigl03', 'scriptorium', 'writer', 'in-progress', 'agt_sol', 'Grinders under $150'),
    mk('write-article', 'ven_rigl03', 'scriptorium', 'writer', 'queued', undefined, 'Gaggia vs Bambino'),
  ];
}

function buildApprovals(rng: Rng, tick: number): ApprovalRequest[] {
  const mk = (
    kind: ApprovalRequest['kind'],
    risk: ApprovalRequest['risk'],
    title: string,
    summary: string,
    requestedBy: string,
    ventureId: string | undefined,
    payload: Record<string, unknown>,
    manualInstructions?: string,
  ): ApprovalRequest => ({
    id: id(rng, 'apr'),
    kind,
    risk,
    title,
    summary,
    requestedBy,
    payload,
    status: 'pending',
    requestedAtTick: tick - rng.int(1, 30),
    ...(ventureId ? { ventureId } : {}),
    ...(manualInstructions ? { manualInstructions } : {}),
  });
  return [
    mk('publish', 'low', 'Publish "Orchid Cat Hoodie" on Etsy', 'New POD listing at $34.99, 6 tags, mockups attached. Etsy is not connected: copy the payload into a draft listing.', 'agt_mira', 'ven_vega01',
      { title: 'Orchid Cat Hoodie', priceCents: 3499, tags: ['cat hoodie', 'botanical', 'orchid', 'plant lover', 'cottagecore', 'gift'], files: ['ven_vega01/07/artwork.svg', 'ven_vega01/07/mockup-front.png'] },
      '1. Open Etsy Shop Manager > Listings > Add a listing.\n2. Upload the two mockup files from the workspace.\n3. Paste the title, description and tags from the payload.\n4. Set price to $34.99 and enable Printify fulfilment.\n5. Publish and paste the listing URL back into the note.'),
    mk('publish', 'low', 'Publish "Forest Ruins Tileset" on itch.io', 'Asset pack, 64 tiles + 12 props, $12. Preview GIF attached.', 'agt_rook', 'ven_altr02',
      { title: 'Forest Ruins Tileset', priceCents: 1200, files: ['ven_altr02/04/pack.zip', 'ven_altr02/04/preview.gif'] }),
    mk('spend', 'medium', 'Order a sample tee ($18.40)', 'Printify sample of the Monstera Cat Tee to check print quality before promoting.', 'agt_orion', 'ven_vega01',
      { provider: 'printify', productId: 'mock-4412', amountCents: 1840, shipTo: 'operator' }),
    mk('customer', 'medium', 'Reply to buyer asking about sizing', 'Etsy message from a buyer about hoodie fit. Draft reply attached; nothing is sent until you approve.', 'agt_cass', 'ven_vega01',
      { conversationId: 'etsy-msg-8813', draft: 'Hi! The hoodie runs true to size with a relaxed fit. If you are between sizes we suggest sizing down.' },
      'Open the Etsy conversation and paste the drafted reply. Do not promise refunds.'),
    mk('account', 'high', 'Connect a Pinterest business account', 'Echo wants to schedule 3 pins/day for Altair Sprites. Requires a real account and API token.', 'agt_echo', 'ven_altr02',
      { platform: 'pinterest', scopes: ['boards:write', 'pins:write'], envVar: 'PINTEREST_TOKEN' },
      'Create a Pinterest business account, generate an access token with boards:write and pins:write, put it in PINTEREST_TOKEN and restart the server.'),
    mk('kill', 'high', 'Kill "Rigel Journal" early?', 'HERMES projects 0 revenue for 5 weeks (indexing lag) and wants to stop spending $1.20/day on it. Sunk cost $9.80.', 'agt_hermes', 'ven_rigl03',
      { ventureId: 'ven_rigl03', sunkCostCents: 980, projectedTicksToFirstSale: 840 }),
  ];
}

function buildDirectives(rng: Rng, tick: number): OverseerDirective[] {
  const out: OverseerDirective[] = [];
  const epochs = [tick - 96, tick - 72, tick - 48, tick - 24, tick - 4];
  const rationales = [
    'Vega Prints converts at 1.9% on 18 clicks/day; holding budget flat until the sample arrives.',
    'Altair Sprites trailing ROI crossed +0.5 for the second epoch; promoting to scaling and hiring a marketer.',
    'Observatory reports thin competition in home-espresso reviews. Spawning an affiliate blog as a cheap experiment.',
    'Music packs remain unfunded: no evidence yet that a composer pays back inside 30 days.',
    'Daily profit is positive but the ETA is geological. Cutting overseer token spend by batching epochs.',
  ];
  epochs.forEach((t, i) => {
    out.push({
      id: id(rng, 'dir'),
      tick: t,
      rationale: rationales[i] ?? 'Holding course.',
      actions: [
        { type: 'set-budget-share', ventureId: 'ven_vega01', share: 0.32 },
        { type: 'set-budget-share', ventureId: 'ven_altr02', share: 0.46 },
        { type: 'set-budget-share', ventureId: 'ven_rigl03', share: 0.22 },
        { type: 'broadcast', message: rationales[i] ?? '' },
      ],
    });
  });
  return out;
}

function buildAgents(map: StationMap, tasks: Task[]): CrewAgent[] {
  const used = new Set<string>();
  return CREW_SEEDS.map((seed, i) => {
    const room = map.rooms[seed.roomId];
    let position: GridPosition = room.idleSpot;
    if (seed.status === 'working' || seed.status === 'blocked') {
      position = room.workstations.find((w) => !used.has(`${w.x},${w.y}`)) ?? room.idleSpot;
    }
    used.add(`${position.x},${position.y}`);
    const task = tasks.find((t) => t.assignedTo === seed.id && t.status !== 'done');
    const agent: CrewAgent = {
      id: seed.id,
      name: seed.name,
      role: seed.role,
      roomId: seed.roomId,
      status: seed.status,
      position: { ...position },
      brain: seed.role === 'overseer' ? 'claude-opus-5' : 'scripted',
      stats: {
        tasksCompleted: 3 + i * 2,
        tasksFailed: i % 4 === 0 ? 1 : 0,
        tokensIn: 12_000 * (i + 1),
        tokensOut: 3_000 * (i + 1),
        costCents: 40 + i * 37,
        revenueAttributedCents: seed.ventureId === 'ven_altr02' ? 2400 : seed.ventureId === 'ven_vega01' ? 1300 : 0,
      },
      hiredAtTick: Math.max(0, 12 + i * 30),
    };
    if (seed.ventureId) agent.ventureId = seed.ventureId;
    if (task) agent.currentTaskId = task.id;
    if (seed.speech) agent.speech = seed.speech;
    return agent;
  });
}

function refreshMetrics(state: StationState, tick: number): void {
  for (const v of state.ventures) {
    v.metrics = computeVentureMetrics(v, state.ledger, state.listings, tick, WINDOW_TICKS);
  }
}

function refreshTreasury(entries: readonly LedgerEntry[], tick: number, prev?: Treasury): Treasury {
  return computeTreasury(entries, tick, {
    targetCents: prev?.targetCents ?? TARGET_CENTS,
    dailyTokenBudgetCents: DAILY_TOKEN_BUDGET_CENTS,
    milestones: DEFAULT_MILESTONES,
  });
}

export function createMockState(seed = 'eternity-mock'): StationState {
  const rng = createRng(seed);
  const map = buildStationMap();
  const tick = START_TICK;
  const listings = buildListings(rng.fork('listings'));
  const ledger = buildLedger(rng.fork('ledger'), listings, tick);
  const tasks = buildTasks(rng.fork('tasks'), tick);
  const state: StationState = {
    mode: 'sim',
    clock: { tick, simTime: iso(tick), paused: false, speed: 4 },
    treasury: refreshTreasury(ledger, tick),
    policy: { ...DEFAULT_POLICY },
    ventures: buildVentures(),
    agents: buildAgents(map, tasks),
    tasks,
    listings,
    approvals: buildApprovals(rng.fork('approvals'), tick),
    ledger,
    directives: buildDirectives(rng.fork('directives'), tick),
  };
  refreshMetrics(state, tick);
  return state;
}

// ---------------------------------------------------------------------------
// Fake server
// ---------------------------------------------------------------------------

interface Plan {
  path: GridPosition[];
  workTicksLeft: number;
  destinationStatus: AgentStatus;
}

const MIN_INTERVAL_MS = 16;

export function createMockTransport(onEvent: (event: StationEvent) => void, seed = 'eternity-mock'): Transport {
  const rng = createRng(`${seed}:live`);
  const map = buildStationMap();
  const state = createMockState(seed);
  const plans = new Map<string, Plan>();
  const occupied = (): Set<string> => new Set(state.agents.map((a) => `${a.position.x},${a.position.y}`));
  let timer: ReturnType<typeof setInterval> | null = null;
  const reachedMilestones = new Set(state.treasury.milestones.filter((m) => m.reachedAtTick !== undefined).map((m) => m.cents));
  let pendingInstruction: string | null = null;

  const emit = (event: StationEvent): void => onEvent(event);
  const log = (level: 'debug' | 'info' | 'warn' | 'error', message: string, agentId?: string): void => {
    emit({ type: 'log', level, message, tick: state.clock.tick, ...(agentId ? { agentId } : {}) });
  };

  const ventureRoom = (agent: CrewAgent): RoomId => {
    const venture = state.ventures.find((v) => v.id === agent.ventureId);
    if (agent.role === 'scout') return 'observatory';
    if (agent.role === 'marketer') return 'broadcast-tower';
    return venture?.roomId ?? agent.roomId;
  };

  const chooseDestination = (agent: CrewAgent): { target: GridPosition; status: AgentStatus } => {
    const restless = rng.chance(0.18);
    const roomId = restless ? 'quarters' : ventureRoom(agent);
    const room = map.rooms[roomId];
    const taken = occupied();
    const free = room.workstations.filter((w) => !taken.has(`${w.x},${w.y}`));
    if (restless || free.length === 0) {
      const spot = { x: room.idleSpot.x + rng.int(0, Math.max(0, room.w - 4)), y: room.idleSpot.y + rng.int(-1, 1) };
      const target = findPath(map, agent.position, spot).length > 0 ? spot : room.idleSpot;
      return { target, status: restless ? 'resting' : 'idle' };
    }
    return { target: rng.pick(free), status: 'working' };
  };

  const roomOfPosition = (m: StationMap, p: GridPosition): RoomId | null => {
    for (const roomId of ROOM_IDS) {
      const r = m.rooms[roomId];
      if (p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h) return roomId;
    }
    return null;
  };

  const upsertAgent = (agent: CrewAgent): void => emit({ type: 'agent.upserted', agent: structuredClone(agent) });

  const stepAgent = (agent: CrewAgent): void => {
    if (agent.role === 'overseer') {
      if (rng.chance(0.02)) emit({ type: 'agent.speech', agentId: agent.id, text: rng.pick(SPEECH_LINES.overseer), ttlTicks: 5 });
      return;
    }
    let plan = plans.get(agent.id);
    if (plan === undefined) {
      plan = { path: [], workTicksLeft: rng.int(3, 12), destinationStatus: agent.status };
      plans.set(agent.id, plan);
    }
    if (plan.path.length > 0) {
      const next = plan.path.shift() as GridPosition;
      const from = { ...agent.position };
      agent.position = { ...next };
      agent.roomId = roomOfPosition(map, next) ?? agent.roomId;
      emit({ type: 'agent.moved', agentId: agent.id, from, to: { ...next }, roomId: agent.roomId });
      if (plan.path.length === 0) {
        agent.status = plan.destinationStatus;
        if (agent.status === 'working' && rng.chance(0.6)) {
          emit({ type: 'agent.speech', agentId: agent.id, text: rng.pick(SPEECH_LINES[agent.role]), ttlTicks: rng.int(3, 6) });
        }
        upsertAgent(agent);
      }
      return;
    }
    if (plan.workTicksLeft > 0) {
      plan.workTicksLeft--;
      if (agent.status === 'working' && rng.chance(0.05)) {
        emit({ type: 'agent.speech', agentId: agent.id, text: rng.pick(SPEECH_LINES[agent.role]), ttlTicks: 4 });
      }
      if (plan.workTicksLeft === 0 && agent.status === 'working') finishTask(agent);
      return;
    }
    const { target, status } = chooseDestination(agent);
    const path = findPath(map, agent.position, target);
    if (path.length === 0) {
      plan.workTicksLeft = rng.int(2, 6);
      return;
    }
    plan.path = path;
    plan.destinationStatus = status;
    plan.workTicksLeft = status === 'working' ? rng.int(6, 16) : rng.int(3, 8);
    agent.status = 'walking';
    upsertAgent(agent);
  };

  const finishTask = (agent: CrewAgent): void => {
    const task = state.tasks.find((t) => t.id === agent.currentTaskId);
    const cost = rng.int(3, 24);
    agent.stats.tasksCompleted++;
    agent.stats.costCents += cost;
    if (task !== undefined) {
      task.status = 'done';
      task.costCents = cost;
      task.finishedAtTick = state.clock.tick;
      emit({ type: 'task.upserted', task: structuredClone(task) });
      log('info', `${agent.name} finished ${task.title} (${(cost / 100).toFixed(2)} in tokens)`, agent.id);
    }
    if (agent.ventureId) {
      const entry: LedgerEntry = { id: id(rng, 'led'), tick: state.clock.tick, ts: iso(state.clock.tick), kind: 'token-cost', amountCents: -cost, ventureId: agent.ventureId, agentId: agent.id, memo: `${agent.role} task`, source: 'sim' };
      state.ledger.push(entry);
      emit({ type: 'ledger.entry', entry });
    }
  };

  const publishTreasury = (): void => {
    state.treasury = refreshTreasury(state.ledger, state.clock.tick, state.treasury);
    emit({ type: 'treasury.updated', treasury: structuredClone(state.treasury) });
    for (const m of state.treasury.milestones) {
      if (m.reachedAtTick === undefined || reachedMilestones.has(m.cents)) continue;
      reachedMilestones.add(m.cents);
      emit({ type: 'milestone.reached', label: m.label, cents: m.cents, tick: state.clock.tick });
    }
  };

  const simulateSales = (): void => {
    const tick = state.clock.tick;
    let sold = false;
    for (const listing of state.listings) {
      if (listing.status !== 'live') continue;
      const venture = state.ventures.find((v) => v.id === listing.ventureId);
      if (venture === undefined || venture.status === 'killed' || venture.status === 'paused') continue;
      const seed = VENTURE_SEEDS.find((s) => s.id === venture.id);
      const perDay = seed?.salesPerDay ?? 0.5;
      const perTick = (perDay / 24 / Math.max(1, state.listings.filter((l) => l.ventureId === venture.id && l.status === 'live').length)) * (0.6 + listing.quality);
      if (!rng.chance(perTick * (venture.status === 'scaling' ? 1.4 : 1))) continue;
      const entries = saleEntries(rng, listing, tick);
      state.ledger.push(...entries);
      for (const entry of entries) emit({ type: 'ledger.entry', entry });
      const net = entries.reduce((s, e) => s + e.amountCents, 0);
      emit({ type: 'sale', ventureId: venture.id, listingId: listing.id, platform: listing.platform, grossCents: listing.priceCents, netCents: net, itemTitle: listing.title, tick });
      emit({ type: 'listing.upserted', listing: structuredClone(listing) });
      for (const agentId of venture.crew) {
        const agent = state.agents.find((a) => a.id === agentId);
        if (agent) agent.stats.revenueAttributedCents += Math.round(net / Math.max(1, venture.crew.length));
      }
      sold = true;
    }
    if (sold) {
      refreshMetrics(state, tick);
      for (const v of state.ventures) emit({ type: 'venture.upserted', venture: structuredClone(v) });
      publishTreasury();
    }
  };

  const runEpoch = (): void => {
    const tick = state.clock.tick;
    refreshMetrics(state, tick);
    const alive = state.ventures.filter((v) => v.status !== 'killed');
    const best = [...alive].sort((a, b) => b.metrics.trailingRoi - a.metrics.trailingRoi)[0];
    const actions: OverseerDirective['actions'] = alive.map((v) => ({ type: 'set-budget-share', ventureId: v.id, share: v.budgetShare }));
    const instruction = pendingInstruction;
    pendingInstruction = null;
    const rationale = instruction
      ? `Operator instruction acknowledged: "${instruction}". Adjusting the plan within policy limits.`
      : best
        ? `${best.name} leads on trailing ROI (${(best.metrics.trailingRoi * 100).toFixed(0)}%). Daily profit ${(state.treasury.dailyProfitCents / 100).toFixed(2)}; holding shares this epoch.`
        : 'No live ventures. Spawning experiments next epoch.';
    actions.push({ type: 'broadcast', message: rationale });
    const directive: OverseerDirective = { id: id(rng, 'dir'), tick, rationale, actions };
    state.directives.push(directive);
    emit({ type: 'overseer.directive', directive });
    log('info', `HERMES epoch: ${rationale}`, 'agt_hermes');
    for (const v of state.ventures) emit({ type: 'venture.upserted', venture: structuredClone(v) });
  };

  const maybeRequestApproval = (): void => {
    const pending = state.approvals.filter((a) => a.status === 'pending').length;
    if (pending >= 8 || !rng.chance(0.02)) return;
    const venture = rng.pick(state.ventures.filter((v) => v.status !== 'killed'));
    if (venture === undefined) return;
    const title = rng.pick(LISTING_TITLES[venture.kind]);
    const approval: ApprovalRequest = {
      id: id(rng, 'apr'),
      kind: 'publish',
      risk: 'low',
      title: `Publish "${title}"`,
      summary: `New ${venture.kind} listing for ${venture.name}. Reviewer quality ${(0.6 + rng.next() * 0.3).toFixed(2)}.`,
      ventureId: venture.id,
      requestedBy: venture.crew[0] ?? 'agt_hermes',
      payload: { title, priceCents: venture.kind === 'pod-store' ? 2499 : 1200 },
      status: 'pending',
      requestedAtTick: state.clock.tick,
    };
    state.approvals.push(approval);
    emit({ type: 'approval.requested', approval });
    log('info', `Airlock: ${approval.title} awaiting approval`);
  };

  const tickOnce = (): void => {
    state.clock.tick++;
    state.clock.simTime = iso(state.clock.tick);
    emit({ type: 'tick', tick: state.clock.tick, simTime: state.clock.simTime, paused: false, speed: state.clock.speed });
    for (const agent of state.agents) stepAgent(agent);
    simulateSales();
    maybeRequestApproval();
    if (state.clock.tick % 24 === 20) emit({ type: 'overseer.thinking', text: 'Reading the trailing window before the epoch...' });
    if (state.clock.tick % 24 === 0) runEpoch();
    else if (state.clock.tick % 6 === 0) publishTreasury();
  };

  const reschedule = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (state.clock.paused) return;
    const tickMs = expectedTickMs(state.clock.speed);
    const intervalMs = Math.max(MIN_INTERVAL_MS, tickMs);
    const perInterval = Math.max(1, Math.round(intervalMs / tickMs));
    timer = setInterval(() => {
      for (let i = 0; i < perInterval; i++) tickOnce();
    }, intervalMs);
  };

  const emitClock = (): void => {
    emit({ type: 'tick', tick: state.clock.tick, simTime: state.clock.simTime, paused: state.clock.paused, speed: state.clock.speed });
  };

  const decide = (approval: ApprovalRequest, decision: 'approved' | 'rejected', note?: string): void => {
    approval.status = decision;
    approval.decidedAt = new Date().toISOString();
    if (note) approval.note = note;
    emit({ type: 'approval.decided', approval: structuredClone(approval) });
    log('info', `Airlock ${decision}: ${approval.title}`);
    const task = state.tasks.find((t) => t.id === approval.taskId);
    if (task) {
      task.status = decision === 'approved' ? 'approved' : 'rejected';
      emit({ type: 'task.upserted', task: structuredClone(task) });
    }
  };

  const handle = (command: StationCommand): void => {
    switch (command.type) {
      case 'clock.pause':
        state.clock.paused = true;
        reschedule();
        emitClock();
        break;
      case 'clock.resume':
        state.clock.paused = false;
        reschedule();
        emitClock();
        break;
      case 'clock.speed':
        state.clock.speed = command.speed;
        reschedule();
        emitClock();
        break;
      case 'approval.decide': {
        const approval = state.approvals.find((a) => a.id === command.approvalId && a.status === 'pending');
        if (approval === undefined) return emit({ type: 'command.rejected', reason: 'Approval not pending', command });
        decide(approval, command.decision, command.note);
        break;
      }
      case 'approval.decide-all': {
        const rank = { low: 0, medium: 1, high: 2 } as const;
        for (const a of state.approvals) {
          if (a.status === 'pending' && rank[a.risk] <= rank[command.maxRisk]) decide(a, command.decision);
        }
        break;
      }
      case 'venture.set-status': {
        const venture = state.ventures.find((v) => v.id === command.ventureId);
        if (venture === undefined) return emit({ type: 'command.rejected', reason: 'Unknown venture', command });
        venture.status = command.status;
        if (command.reason) venture.statusReason = command.reason;
        emit({ type: 'venture.upserted', venture: structuredClone(venture) });
        log('warn', `${venture.name} set to ${command.status}${command.reason ? `: ${command.reason}` : ''}`);
        break;
      }
      case 'venture.spawn': {
        const venture: Venture = {
          id: id(rng, 'ven'),
          kind: command.kind,
          name: command.name ?? `${rng.pick(['Deneb', 'Mizar', 'Spica', 'Antares'])} ${command.kind.split('-')[0] ?? 'venture'}`,
          thesis: command.thesis,
          roomId: roomFor(command.kind),
          status: 'incubating',
          createdAtTick: state.clock.tick,
          budgetShare: 0.05,
          crew: [],
          storefronts: [],
          metrics: emptyMetrics(),
          statusReason: 'Spawned by operator',
        };
        state.ventures.push(venture);
        emit({ type: 'venture.upserted', venture: structuredClone(venture) });
        log('info', `Spawned ${venture.name}: ${venture.thesis}`);
        break;
      }
      case 'overseer.instruct':
        pendingInstruction = command.text;
        emit({ type: 'overseer.thinking', text: `Considering: "${command.text}"` });
        log('info', `Operator to HERMES: ${command.text}`, 'agt_hermes');
        break;
      case 'agent.hire': {
        const room = map.rooms.quarters;
        const agent: CrewAgent = {
          id: id(rng, 'agt'),
          name: rng.pick(['Nyx', 'Juno', 'Tarn', 'Io', 'Kepler']),
          role: command.role,
          roomId: 'quarters',
          status: 'idle',
          position: { ...room.idleSpot },
          brain: 'scripted',
          stats: { tasksCompleted: 0, tasksFailed: 0, tokensIn: 0, tokensOut: 0, costCents: 0, revenueAttributedCents: 0 },
          hiredAtTick: state.clock.tick,
        };
        if (command.ventureId) agent.ventureId = command.ventureId;
        state.agents.push(agent);
        upsertAgent(agent);
        log('info', `Hired ${agent.name} (${agent.role})`);
        break;
      }
      case 'agent.dismiss': {
        const index = state.agents.findIndex((a) => a.id === command.agentId);
        if (index === -1) return emit({ type: 'command.rejected', reason: 'Unknown agent', command });
        const [agent] = state.agents.splice(index, 1);
        if (agent) {
          agent.status = 'offline';
          upsertAgent(agent);
          log('warn', `${agent.name} dismissed`);
        }
        break;
      }
      case 'treasury.set-target':
        state.treasury.targetCents = command.targetCents;
        publishTreasury();
        break;
      case 'snapshot.request':
        emit({ type: 'snapshot', state: structuredClone(state) });
        break;
    }
    emit({ type: 'command.ok', commandType: command.type });
  };

  return {
    start(): void {
      emit({ type: 'snapshot', state: structuredClone(state) });
      log('info', 'Mock mode: no server connected, this world is simulated in the browser.');
      reschedule();
    },
    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    sendCommand(command: StationCommand): boolean {
      try {
        handle(command);
      } catch (err) {
        emit({ type: 'command.rejected', reason: err instanceof Error ? err.message : String(err), command });
      }
      return true;
    },
  };
}

export const MOCK_TICK_INTERVAL_FLOOR_MS = MIN_INTERVAL_MS;
