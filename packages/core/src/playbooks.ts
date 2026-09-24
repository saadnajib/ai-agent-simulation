/**
 * Venture playbooks: what each kind of business actually does, cycle by cycle.
 *
 * A playbook knows its room, the roles it needs, the ordered pipeline of task
 * kinds, the platforms it publishes to, the criteria a reviewer scores
 * against, and how to build one concrete production cycle as a wired task
 * list.
 *
 * Dependency wiring: tasks returned by `buildCycle` have no ids yet, so
 * `dependsOn` (and any string in `input`) may hold a cycle reference of the
 * form "cycle:<index>" pointing at an earlier task in the same array. The
 * server calls `instantiateCycle` to assign ids and resolve the references.
 */
import type { AgentRole, Platform, RoomId, Task, TaskKind, Venture, VentureKind } from './types.js';
import { VENTURE_KINDS } from './types.js';
import { DEFAULT_ESTIMATE_MODEL, KIND_ECONOMICS, estimateTaskCostCents } from './economics.js';
import { makeId } from './ids.js';
import type { Rng } from './rng.js';

export type CycleTask = Omit<Task, 'id' | 'status' | 'attempts' | 'costCents' | 'createdAtTick' | 'assignedTo'>;

export interface VenturePlaybook {
  kind: VentureKind;
  roomId: RoomId;
  roles: AgentRole[];
  /** Ordered task kinds for one production cycle. */
  pipeline: TaskKind[];
  platforms: Platform[];
  reviewCriteria: string[];
  suggestThesis(rng: Rng): string;
  /** Build the concrete task list for one cycle, wired with dependsOn. */
  buildCycle(venture: Venture, tick: number, rng: Rng): CycleTask[];
}

export const CYCLE_REF_PREFIX = 'cycle:';

export function cycleRef(index: number): string {
  return `${CYCLE_REF_PREFIX}${index}`;
}

export function isCycleRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CYCLE_REF_PREFIX);
}

// ---------------------------------------------------------------------------
// Priorities: later stages run first so work in progress finishes before
// new work starts (keeps WIP low and gets listings live sooner).
// ---------------------------------------------------------------------------

const PRIORITY: Record<'research' | 'produce' | 'listing' | 'review' | 'publish' | 'promote', number> = {
  publish: 60,
  review: 55,
  listing: 50,
  produce: 45,
  research: 40,
  promote: 35,
};

interface TaskSpec {
  kind: TaskKind;
  title: string;
  roomId: RoomId;
  role: AgentRole;
  priority: number;
  input?: Record<string, unknown>;
  dependsOn?: number[];
}

/** Small helper that turns specs into CycleTasks with cycle references. */
class CycleBuilder {
  readonly tasks: CycleTask[] = [];

  constructor(private readonly venture: Venture) {}

  add(spec: TaskSpec): number {
    this.tasks.push({
      kind: spec.kind,
      title: spec.title,
      ventureId: this.venture.id,
      roomId: spec.roomId,
      role: spec.role,
      priority: spec.priority,
      input: { thesis: this.venture.thesis, ventureKind: this.venture.kind, ...(spec.input ?? {}) },
      dependsOn: (spec.dependsOn ?? []).map(cycleRef),
      estimateCents: estimateTaskCostCents(spec.kind, DEFAULT_ESTIMATE_MODEL),
    });
    return this.tasks.length - 1;
  }
}

// ---------------------------------------------------------------------------
// Shared stage builders
// ---------------------------------------------------------------------------

function researchStage(b: CycleBuilder, venture: Venture): number {
  return b.add({
    kind: 'research-niche',
    title: `Scout demand for "${venture.thesis}"`,
    roomId: 'observatory',
    role: 'scout',
    priority: PRIORITY.research,
    input: { platforms: PLAYBOOKS[venture.kind].platforms },
  });
}

interface CommercialStageOptions {
  roomId: RoomId;
  listingRole: AgentRole;
  platform: Platform;
  productionIndex: number;
  researchIndex: number;
  unitLabel: string;
  criteria: string[];
}

/** write-listing -> review-output -> publish-listing for one produced unit. Returns the publish index. */
function commercialStage(b: CycleBuilder, o: CommercialStageOptions): number {
  const listing = b.add({
    kind: 'write-listing',
    title: `Write listing copy for ${o.unitLabel}`,
    roomId: o.roomId,
    role: o.listingRole,
    priority: PRIORITY.listing,
    input: { productRef: cycleRef(o.productionIndex), researchRef: cycleRef(o.researchIndex), platform: o.platform },
    dependsOn: [o.productionIndex, o.researchIndex],
  });
  const review = b.add({
    kind: 'review-output',
    title: `Review ${o.unitLabel} before the Airlock`,
    roomId: o.roomId,
    role: 'reviewer',
    priority: PRIORITY.review,
    input: { targetRef: cycleRef(o.productionIndex), listingRef: cycleRef(listing), criteria: o.criteria },
    dependsOn: [o.productionIndex, listing],
  });
  return b.add({
    kind: 'publish-listing',
    title: `Publish ${o.unitLabel} to ${o.platform}`,
    roomId: o.roomId,
    role: o.listingRole,
    priority: PRIORITY.publish,
    input: { listingRef: cycleRef(listing), reviewRef: cycleRef(review), platform: o.platform },
    dependsOn: [review],
  });
}

function promoteStage(b: CycleBuilder, venture: Venture, publishes: number[], channel: Platform): number {
  return b.add({
    kind: 'promote',
    title: `Promote ${venture.name} on ${channel}`,
    roomId: 'broadcast-tower',
    role: 'marketer',
    priority: PRIORITY.promote,
    input: { channel, publishedRefs: publishes.map(cycleRef) },
    dependsOn: publishes,
  });
}

interface StandardCycleOptions {
  roomId: RoomId;
  producerRole: AgentRole;
  listingRole: AgentRole;
  productionKind: TaskKind;
  productionTitle: (index: number, total: number) => string;
  unitLabel: (index: number) => string;
  platform: Platform;
  promoteChannel: Platform;
  criteria: string[];
  extraProductionInput?: Record<string, unknown>;
}

/** research -> N x (produce -> listing -> review -> publish) -> promote. */
function standardCycle(venture: Venture, rng: Rng, o: StandardCycleOptions): CycleTask[] {
  const b = new CycleBuilder(venture);
  const research = researchStage(b, venture);
  const total = KIND_ECONOMICS[venture.kind].unitsPerBatch;
  const publishes: number[] = [];
  for (let i = 0; i < total; i++) {
    const produce = b.add({
      kind: o.productionKind,
      title: o.productionTitle(i, total),
      roomId: o.roomId,
      role: o.producerRole,
      priority: PRIORITY.produce,
      input: { researchRef: cycleRef(research), batchIndex: i, batchSize: total, seed: rng.int(0, 0xffffff), ...(o.extraProductionInput ?? {}) },
      dependsOn: [research],
    });
    publishes.push(
      commercialStage(b, {
        roomId: o.roomId,
        listingRole: o.listingRole,
        platform: o.platform,
        productionIndex: produce,
        researchIndex: research,
        unitLabel: o.unitLabel(i),
        criteria: o.criteria,
      }),
    );
  }
  promoteStage(b, venture, publishes, o.promoteChannel);
  return b.tasks;
}

// ---------------------------------------------------------------------------
// Curated niches. Generic themes only: no trademarked IP, teams or bands.
// ---------------------------------------------------------------------------

const NICHES: Record<VentureKind, readonly string[]> = {
  'pod-store': [
    'vintage botanical cat tees',
    'retro national-park style poster hoodies',
    'dark academia library mugs',
    'sourdough baking club sweatshirts',
    'cottagecore mushroom foraging totes',
    'minimalist constellation map tees',
    'birdwatching life-list mugs',
    'houseplant propagation station tees',
    'trail running elevation-profile hoodies',
    'cold plunge morning club tees',
    'beekeeping apiary crest sweatshirts',
    'vintage typewriter writers mugs',
    'sea kayaking tide-chart tees',
    'urban sketching kit totes',
    'night-shift nurse humour tees',
    'knitting circle pun mugs',
  ],
  'game-assets': [
    '16x16 desert ruins tileset',
    'top-down sci-fi station interior tileset',
    'hand-drawn cozy farm crop sprites',
    '1-bit dungeon crawler tile pack',
    'isometric medieval market props',
    'pixel weather and particle effects sheet',
    'side-scroller swamp parallax backgrounds',
    'retro arcade UI and icon kit',
    'underwater cave tileset with animated flora',
    'steampunk airship interior props',
    'roguelike potion and loot icon set',
    '32x32 haunted mansion tileset',
    'pixel vehicle sprites with damage states',
    'tactical RPG grid terrain tiles',
  ],
  'thumbnail-service': [
    'finance explainer channel thumbnails',
    'woodworking tutorial thumbnails',
    'indie game devlog thumbnails',
    'true crime podcast clip thumbnails',
    'home cooking recipe thumbnails',
    'language learning lesson thumbnails',
    'student personal finance thumbnails',
    'mechanical keyboard review thumbnails',
    'gardening how-to thumbnails',
    'chess opening tutorial thumbnails',
    '3D printing project thumbnails',
    'van life travel vlog thumbnails',
    'coding tutorial thumbnails',
    'board game review thumbnails',
  ],
  'affiliate-blog': [
    'budget espresso machines under $300',
    'ergonomic office chairs for tall people',
    'beginner telescope buying guides',
    'quiet mechanical keyboards for open offices',
    'cold-weather running gear reviews',
    'compact sous vide setups for small kitchens',
    'beginner bonsai tool kits',
    'e-reader accessories and cases',
    'home espresso grinder comparisons',
    'ultralight camping cookware for backpackers',
    'standing desk converters under $200',
    'beginner fountain pen starter kits',
    'air purifiers for small apartments',
    'indoor herb garden kits',
  ],
  'software-templates': [
    'SaaS billing starter kit with usage-based pricing',
    'Notion freelancer CRM and invoice tracker',
    'waitlist landing page template with referral tracking',
    'internal admin dashboard boilerplate',
    'Stripe subscription webhooks starter',
    'markdown documentation site template',
    'job board starter kit',
    'email newsletter automation template',
    'habit tracker PWA template',
    'invoice generator micro-tool',
    'Notion content calendar for small teams',
    'customer feedback board template',
    'changelog and release notes site template',
    'cron job monitoring micro-tool',
  ],
  'music-packs': [
    'lo-fi study loops at 80 bpm',
    '8-bit boss battle themes',
    'ambient space station drones',
    'cozy village exploration loops',
    'cinematic tension risers and hits',
    'retro synthwave menu music',
    'acoustic folk tavern loops',
    'dungeon crawler percussion loops',
    'UI click and confirm SFX pack',
    'horror atmosphere pads',
    'upbeat tutorial background tracks',
    'rain and weather ambience layers',
    'chiptune victory jingles',
    'podcast intro stingers',
  ],
};

export function nichesFor(kind: VentureKind): readonly string[] {
  return NICHES[kind];
}

// ---------------------------------------------------------------------------
// Review criteria
// ---------------------------------------------------------------------------

const REVIEW_CRITERIA: Record<VentureKind, string[]> = {
  'pod-store': [
    'Artwork is original: no trademarked characters, logos, team names or celebrity likenesses.',
    'Design reads clearly at 4 inches on a printed garment; no text under 24pt equivalent.',
    'Print file is 300 DPI, transparent background, sized to the product template.',
    'Title and 13 tags use buyer search phrases, not the design description.',
    'Mockups show the design on at least two product colours.',
    'Listing discloses AI-assisted design where the platform requires it.',
  ],
  'game-assets': [
    'Consistent tile size, palette and pixel density across the whole pack.',
    'Tiles connect seamlessly on all edges; autotile sets include every needed transition.',
    'Pack ships as PNG sprite sheets plus individual files with a README and licence.',
    'Cover image shows an assembled scene, not a bare sheet.',
    'At least 40 unique tiles or sprites per pack.',
    'Licence permits commercial use in games and forbids resale of the raw assets.',
  ],
  'thumbnail-service': [
    'Portfolio samples cover three distinct channel genres.',
    'Focal subject and text are legible at 168x94 pixels.',
    'No more than four words of text per thumbnail; high contrast against the background.',
    'Faces and hands are anatomically correct; no artefacts.',
    'Gig description states turnaround, revisions included and file formats delivered.',
    'Samples contain no copyrighted photos or brand logos.',
  ],
  'affiliate-blog': [
    'Article answers the search intent in the first 150 words.',
    'Every product claim is verifiable from the product page; no invented specs.',
    'Affiliate disclosure appears above the first affiliate link.',
    'At least 1,200 words with a comparison table and a clear top pick.',
    'Headings map to real long-tail queries; no keyword stuffing.',
    'Article does not plagiarise or closely paraphrase competitor copy.',
  ],
  'software-templates': [
    'Fresh clone installs and runs with the documented commands in under five minutes.',
    'No secrets, personal data or third-party code with incompatible licences in the repo.',
    'README covers setup, configuration, deployment and customisation.',
    'Type checks and tests pass; CI config included.',
    'Product page shows a live demo or screenshots of every major screen.',
    'Licence is explicit (MIT or a clear commercial licence).',
  ],
  'music-packs': [
    'Loops are seamless at the stated BPM with no click at the loop point.',
    'Delivered as 44.1kHz/24-bit WAV plus MP3 previews.',
    'Consistent loudness across the pack (around -14 LUFS for previews).',
    'No samples with unclear provenance; all sounds original or properly licensed.',
    'Pack contains at least 10 distinct tracks or 30 SFX.',
    'Licence covers commercial use in games and video, forbids redistribution.',
  ],
};

// ---------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------

function podStoreCycle(venture: Venture, tick: number, rng: Rng): CycleTask[] {
  const b = new CycleBuilder(venture);
  const research = researchStage(b, venture);
  const total = KIND_ECONOMICS['pod-store'].unitsPerBatch;
  const publishes: number[] = [];
  for (let i = 0; i < total; i++) {
    const artwork = b.add({
      kind: 'design-artwork',
      title: `Design artwork ${i + 1}/${total}: ${venture.thesis}`,
      roomId: 'print-foundry',
      role: 'designer',
      priority: PRIORITY.produce,
      input: { researchRef: cycleRef(research), batchIndex: i, batchSize: total, seed: rng.int(0, 0xffffff), cycleTick: tick },
      dependsOn: [research],
    });
    const mockups = b.add({
      kind: 'create-mockups',
      title: `Create product mockups for artwork ${i + 1}`,
      roomId: 'print-foundry',
      role: 'designer',
      priority: PRIORITY.produce,
      input: { artworkRef: cycleRef(artwork), provider: 'printify' },
      dependsOn: [artwork],
    });
    publishes.push(
      commercialStage(b, {
        roomId: 'print-foundry',
        listingRole: 'writer',
        platform: 'etsy',
        productionIndex: mockups,
        researchIndex: research,
        unitLabel: `product ${i + 1}/${total}`,
        criteria: REVIEW_CRITERIA['pod-store'],
      }),
    );
  }
  promoteStage(b, venture, publishes, 'pinterest');
  return b.tasks;
}

function affiliateBlogCycle(venture: Venture, tick: number, rng: Rng): CycleTask[] {
  const b = new CycleBuilder(venture);
  const research = researchStage(b, venture);
  const competitors = b.add({
    kind: 'analyse-competitors',
    title: `Analyse ranking pages for "${venture.thesis}"`,
    roomId: 'observatory',
    role: 'scout',
    priority: PRIORITY.research,
    input: { researchRef: cycleRef(research) },
    dependsOn: [research],
  });
  const total = KIND_ECONOMICS['affiliate-blog'].unitsPerBatch;
  const publishes: number[] = [];
  for (let i = 0; i < total; i++) {
    const article = b.add({
      kind: 'write-article',
      title: `Write article ${i + 1}/${total}: ${venture.thesis}`,
      roomId: 'scriptorium',
      role: 'writer',
      priority: PRIORITY.produce,
      input: {
        researchRef: cycleRef(research),
        competitorsRef: cycleRef(competitors),
        batchIndex: i,
        batchSize: total,
        seed: rng.int(0, 0xffffff),
        cycleTick: tick,
        affiliateProgram: 'amazon-associates',
      },
      dependsOn: [research, competitors],
    });
    const review = b.add({
      kind: 'review-output',
      title: `Review article ${i + 1}/${total} before publishing`,
      roomId: 'scriptorium',
      role: 'reviewer',
      priority: PRIORITY.review,
      input: { targetRef: cycleRef(article), criteria: REVIEW_CRITERIA['affiliate-blog'] },
      dependsOn: [article],
    });
    publishes.push(
      b.add({
        kind: 'publish-listing',
        title: `Publish article ${i + 1}/${total} to the blog`,
        roomId: 'scriptorium',
        role: 'writer',
        priority: PRIORITY.publish,
        input: { articleRef: cycleRef(article), reviewRef: cycleRef(review), platform: 'wordpress' },
        dependsOn: [review],
      }),
    );
  }
  promoteStage(b, venture, publishes, 'pinterest');
  return b.tasks;
}

export const PLAYBOOKS: Record<VentureKind, VenturePlaybook> = {
  'pod-store': {
    kind: 'pod-store',
    roomId: 'print-foundry',
    roles: ['scout', 'designer', 'writer', 'reviewer', 'marketer'],
    pipeline: ['research-niche', 'design-artwork', 'create-mockups', 'write-listing', 'review-output', 'publish-listing', 'promote'],
    platforms: ['etsy', 'printify'],
    reviewCriteria: REVIEW_CRITERIA['pod-store'],
    suggestThesis: (rng) => rng.pick(NICHES['pod-store']),
    buildCycle: podStoreCycle,
  },
  'game-assets': {
    kind: 'game-assets',
    roomId: 'pixel-forge',
    roles: ['scout', 'pixel-artist', 'reviewer', 'marketer'],
    pipeline: ['research-niche', 'create-asset-pack', 'write-listing', 'review-output', 'publish-listing', 'promote'],
    platforms: ['itch', 'gumroad'],
    reviewCriteria: REVIEW_CRITERIA['game-assets'],
    suggestThesis: (rng) => rng.pick(NICHES['game-assets']),
    buildCycle: (venture, _tick, rng) =>
      standardCycle(venture, rng, {
        roomId: 'pixel-forge',
        producerRole: 'pixel-artist',
        listingRole: 'pixel-artist',
        productionKind: 'create-asset-pack',
        productionTitle: (i, n) => `Create asset pack ${i + 1}/${n}: ${venture.thesis}`,
        unitLabel: (i) => `asset pack ${i + 1}`,
        platform: 'itch',
        promoteChannel: 'x',
        criteria: REVIEW_CRITERIA['game-assets'],
        extraProductionInput: { format: 'png-spritesheet', minimumTiles: 40 },
      }),
  },
  'thumbnail-service': {
    kind: 'thumbnail-service',
    roomId: 'thumbnail-bay',
    roles: ['scout', 'thumbnail-artist', 'reviewer', 'marketer'],
    pipeline: ['research-niche', 'design-thumbnail', 'write-listing', 'review-output', 'publish-listing', 'promote'],
    platforms: ['fiverr'],
    reviewCriteria: REVIEW_CRITERIA['thumbnail-service'],
    suggestThesis: (rng) => rng.pick(NICHES['thumbnail-service']),
    buildCycle: (venture, _tick, rng) =>
      standardCycle(venture, rng, {
        roomId: 'thumbnail-bay',
        producerRole: 'thumbnail-artist',
        listingRole: 'thumbnail-artist',
        productionKind: 'design-thumbnail',
        productionTitle: (i, n) => `Design portfolio set ${i + 1}/${n}: ${venture.thesis}`,
        unitLabel: (i) => `gig ${i + 1}`,
        platform: 'fiverr',
        promoteChannel: 'x',
        criteria: REVIEW_CRITERIA['thumbnail-service'],
        extraProductionInput: { samples: 3, size: '1280x720' },
      }),
  },
  'affiliate-blog': {
    kind: 'affiliate-blog',
    roomId: 'scriptorium',
    roles: ['scout', 'writer', 'reviewer', 'marketer'],
    pipeline: ['research-niche', 'analyse-competitors', 'write-article', 'review-output', 'publish-listing', 'promote'],
    platforms: ['wordpress', 'amazon-associates'],
    reviewCriteria: REVIEW_CRITERIA['affiliate-blog'],
    suggestThesis: (rng) => rng.pick(NICHES['affiliate-blog']),
    buildCycle: affiliateBlogCycle,
  },
  'software-templates': {
    kind: 'software-templates',
    roomId: 'prototype-lab',
    roles: ['scout', 'engineer', 'reviewer', 'marketer'],
    pipeline: ['research-niche', 'build-template', 'write-listing', 'review-output', 'publish-listing', 'promote'],
    platforms: ['gumroad', 'lemonsqueezy'],
    reviewCriteria: REVIEW_CRITERIA['software-templates'],
    suggestThesis: (rng) => rng.pick(NICHES['software-templates']),
    buildCycle: (venture, _tick, rng) =>
      standardCycle(venture, rng, {
        roomId: 'prototype-lab',
        producerRole: 'engineer',
        listingRole: 'engineer',
        productionKind: 'build-template',
        productionTitle: (i, n) => `Build template ${i + 1}/${n}: ${venture.thesis}`,
        unitLabel: (i) => `template ${i + 1}`,
        platform: 'gumroad',
        promoteChannel: 'x',
        criteria: REVIEW_CRITERIA['software-templates'],
        extraProductionInput: { licence: 'MIT', includeCi: true },
      }),
  },
  'music-packs': {
    kind: 'music-packs',
    roomId: 'sound-deck',
    roles: ['scout', 'composer', 'reviewer', 'marketer'],
    pipeline: ['research-niche', 'compose-track', 'write-listing', 'review-output', 'publish-listing', 'promote'],
    platforms: ['gumroad', 'itch'],
    reviewCriteria: REVIEW_CRITERIA['music-packs'],
    suggestThesis: (rng) => rng.pick(NICHES['music-packs']),
    buildCycle: (venture, _tick, rng) =>
      standardCycle(venture, rng, {
        roomId: 'sound-deck',
        producerRole: 'composer',
        listingRole: 'composer',
        productionKind: 'compose-track',
        productionTitle: (i, n) => `Compose pack ${i + 1}/${n}: ${venture.thesis}`,
        unitLabel: (i) => `music pack ${i + 1}`,
        platform: 'gumroad',
        promoteChannel: 'x',
        criteria: REVIEW_CRITERIA['music-packs'],
        extraProductionInput: { format: 'wav-24bit', minimumTracks: 10 },
      }),
  },
};

export function playbookFor(kind: VentureKind): VenturePlaybook {
  const playbook = PLAYBOOKS[kind];
  if (playbook === undefined) throw new RangeError(`No playbook for venture kind "${String(kind)}"`);
  return playbook;
}

// ---------------------------------------------------------------------------
// Venture naming
// ---------------------------------------------------------------------------

const STAR_NAMES = [
  'Vega', 'Altair', 'Deneb', 'Rigel', 'Sirius', 'Lyra', 'Capella', 'Antares', 'Procyon', 'Mira',
  'Polaris', 'Castor', 'Arcturus', 'Bellatrix', 'Spica', 'Alcor', 'Mizar', 'Fomalhaut', 'Electra', 'Maia',
] as const;

const KIND_NOUN: Record<VentureKind, string> = {
  'pod-store': 'Prints',
  'game-assets': 'Pixels',
  'thumbnail-service': 'Studio',
  'affiliate-blog': 'Press',
  'software-templates': 'Labs',
  'music-packs': 'Sound',
};

/** Short display name such as "Vega Prints"; avoids names already in use. */
export function ventureNameFor(kind: VentureKind, rng: Rng, taken: readonly string[] = []): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  for (let attempt = 0; attempt < STAR_NAMES.length * 2; attempt++) {
    const name = `${rng.pick(STAR_NAMES)} ${KIND_NOUN[kind]}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `${rng.pick(STAR_NAMES)} ${KIND_NOUN[kind]} ${rng.int(2, 99)}`;
}

// ---------------------------------------------------------------------------
// Cycle instantiation (used by the server when enqueueing)
// ---------------------------------------------------------------------------

function resolveRefs(value: unknown, ids: readonly string[]): unknown {
  if (isCycleRef(value)) {
    const index = Number.parseInt(value.slice(CYCLE_REF_PREFIX.length), 10);
    const id = ids[index];
    if (id === undefined) throw new RangeError(`Dangling cycle reference "${value}"`);
    return id;
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, ids));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = resolveRefs(v, ids);
    return out;
  }
  return value;
}

/** Assigns ids, resolves cycle references and returns queued Tasks. */
export function instantiateCycle(cycle: readonly CycleTask[], tick: number, rng: Rng): Task[] {
  const ids = cycle.map(() => makeId('task', rng));
  return cycle.map((spec, index) => {
    const dependsOn = spec.dependsOn.map((dep) => {
      const resolved = resolveRefs(dep, ids);
      if (typeof resolved !== 'string') throw new RangeError('dependsOn entries must resolve to task ids');
      return resolved;
    });
    return {
      ...spec,
      id: ids[index] as string,
      input: resolveRefs(spec.input, ids) as Record<string, unknown>,
      dependsOn,
      status: 'queued',
      attempts: 0,
      costCents: 0,
      createdAtTick: tick,
    };
  });
}

/** Every kind has a playbook; exported for exhaustive iteration in the server. */
export const PLAYBOOK_KINDS: readonly VentureKind[] = VENTURE_KINDS;
