# Eternity Station — Module Contracts

This document is the agreement between the packages. If you change a contract,
update this file in the same commit.

## The idea in one paragraph

A space station rendered as a 2D game. At its centre sits **HERMES**, the
Overseer: an agent whose only job is **capital allocation**. It funds crews of
worker agents in themed rooms, each running a small business (print-on-demand
store, game-asset packs, thumbnail gigs, affiliate blog, software templates,
music packs). Every task costs tokens; every sale earns revenue; both land in
one ledger. Each epoch HERMES measures trailing ROI per venture, cuts budget to
losers, kills the persistent ones, doubles down on winners, and spawns new
experiments. Nothing touches money, accounts or the public internet without
passing the **Airlock**, the human approval queue. The treasury's target is
configurable (default one trillion dollars) and the HUD shows the honest ETA at
current velocity, which is the whole point of the display.

## Packages and ownership

| Package | Path | Owns | Must not |
|---|---|---|---|
| `@eternity/core` | `packages/core` | types, event protocol, station map + pathfinding, RNG, ledger math, allocation policy, market simulator, playbooks, cost model | touch fs/network/timers |
| `@eternity/adapters` | `packages/adapters` | `PlatformAdapter` interface, registry, mock market adapter, real adapters (Printify, Etsy, Gumroad, itch.io, WordPress), manual adapters (Fiverr, DistroKid) | import from server |
| `@eternity/server` | `packages/server` | SQLite persistence, clock, orchestrator, worker brains (scripted + Claude), Overseer engine, Airlock, WS/REST | render anything |
| `@eternity/station` | `apps/station` | canvas game client, HUD, panels, WS client | compute economics (read them from state) |
| docs | `docs/` | economics reality check, architecture, playbooks, platform constraints, runbook | — |

All packages are ESM TypeScript, `strict` on. Node packages use `NodeNext`
resolution, so relative imports need the `.js` suffix. Workspace packages are
consumed from source (`main: ./src/index.ts`) via `tsx` and Vite; there is no
build step in dev.

## `@eternity/core` public API (to implement)

Already present: `types.ts`, `events.ts`, `stationMap.ts` (layout constants).
Add the following modules and export them from `index.ts`.

```ts
// rng.ts — deterministic PRNG (mulberry32 or sfc32). Every stochastic thing
// in core takes an Rng so runs are reproducible from a seed.
export interface Rng {
  next(): number;                 // [0,1)
  int(min: number, max: number): number; // inclusive
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  poisson(lambda: number): number;
  normal(mean: number, sd: number): number;
  fork(label: string): Rng;       // derived stream
}
export function createRng(seed: number | string): Rng;

// ids.ts
export function makeId(prefix: string, rng?: Rng): string; // e.g. "ven_8f3k2a"

// simTime.ts
export const TICKS_PER_DAY = 24;
export function tickToSimTime(tick: number, epochStartIso?: string): string;

// stationMapBuild.ts — derive the tile grid from ROOM_LAYOUT
export function buildStationMap(): StationMap;   // memoised
export function roomAt(map: StationMap, p: GridPosition): RoomId | null;
export function isWalkable(map: StationMap, p: GridPosition): boolean;
export function findPath(map: StationMap, from: GridPosition, to: GridPosition): GridPosition[]; // BFS/A*, [] if unreachable, excludes `from`, includes `to`
// Rules: rooms are the ROOM_LAYOUT rects; outer ring of each rect is 'wall';
// one 'door' tile on the wall facing the nearest corridor; interior is 'floor';
// 2..6 'workstation' tiles per production room; 'core' interior centre 2x2 is
// 'core-eye'; 'reactor' interior centre 2x2 is 'reactor-core'; every tile
// inside the hull (x in [1, width-2], y in [1, height-2]) that is not part of
// a room is 'corridor'; the hull border and outside is 'void'. Every room
// door must be reachable from every other room door — write a test for it.

// economics.ts
export const MODEL_PRICES: Record<string, { inputCentsPerMTok: number; outputCentsPerMTok: number }>;
// claude-opus-5: 500 / 2500. claude-sonnet-5: 200 / 1000. claude-haiku-4-5: 100 / 500. scripted: 0 / 0.
export function tokenCostCents(model: string, tokensIn: number, tokensOut: number): number;
export function estimateTaskCostCents(kind: TaskKind, model: string): number; // rough, used for budgeting before a task runs
export const PLATFORM_FEES: Record<Platform, { rate: number; fixedCents: number }>;
// etsy 0.065 + 20 listing + payment 0.03+25 → model as rate 0.095, fixedCents 45
// fiverr 0.20; itch 0.10; gumroad 0.10 + 50; lemonsqueezy 0.05 + 50; wordpress 0; amazon-associates 0 (commission is the revenue); printify/printful 0 (base cost is unitCost); mock 0.10
export interface KindEconomics {
  typicalPriceCents: number; unitCostCents: number;
  baseDailyImpressions: number;   // per live listing, at quality 1, unsaturated niche, day 0
  baseCtr: number; baseConversion: number;
  decayHalfLifeTicks: number;      // listing freshness decay
  saturationK: number;             // impressions scale by 1/(1 + liveListingsInNiche/saturationK)
  refundRate: number;
  unitsPerBatch: number;           // how many listings one production cycle yields
}
export const KIND_ECONOMICS: Record<VentureKind, KindEconomics>;
// Be pessimistic-realistic. A new Etsy POD listing without ads sees ~5–30
// impressions/day, CTR 2–4%, conversion 1–3%, ~$5 margin. Game asset packs on
// itch: long tail, ~0–3 sales/week at $5–15. Thumbnail gigs: $20 each,
// demand depends on reviews you don't have yet. Affiliate posts: 0 revenue
// for weeks (indexing), then a trickle. Encode this, do not flatter it.

// market.ts — simulated demand. Pure function of (listings, tick, rng).
export interface SaleEvent {
  listingId: string; ventureId: string; platform: Platform;
  units: number; grossCents: number; feeCents: number; fulfilmentCents: number; netCents: number; tick: number;
}
export interface MarketTickResult { sales: SaleEvent[]; impressions: Record<string, number>; clicks: Record<string, number>; }
export interface MarketModel { simulateTick(listings: readonly Listing[], tick: number, rng: Rng): MarketTickResult; }
export function createMarketModel(overrides?: Partial<Record<VentureKind, Partial<KindEconomics>>>): MarketModel;
// Impressions/tick = baseDailyImpressions/24 * quality^2 * freshness(age) * saturation(niche) * nicheDemand(niche hash → 0.3..1.7).
// Sales = Binomial(clicks, conversion). Apply PLATFORM_FEES and unitCost.

// ledger.ts
export const DEFAULT_MILESTONES: Milestone[]; // $1, $100, $1k, $10k, $100k, $1M, $10M, $100M, $1B, $10B, $100B, $1T (in cents)
export function computeTreasury(entries: readonly LedgerEntry[], tick: number, opts: { targetCents: number; dailyTokenBudgetCents: number; startingBalanceCents?: number; milestones?: Milestone[] }): Treasury;
export function computeVentureMetrics(venture: Venture, entries: readonly LedgerEntry[], listings: readonly Listing[], tick: number, windowTicks: number): VentureMetrics;
export function formatCents(cents: number): string; // "$1,234.56", "-$0.42", "$1.2M" for large

// allocation.ts — the deterministic half of HERMES
export const DEFAULT_POLICY: AllocationPolicy; // epochTicks 24, windowTicks 168, explorationFloor 0.05, graceTicks 72, killRoiThreshold -0.5, killNoSaleTicks 240, scaleRoiThreshold 0.5, maxVentures 8, maxCrewPerVenture 3
export function planEpoch(state: StationState, rng: Rng): OverseerAction[];
// 1. For each non-killed, non-paused venture compute a score from trailingRoi (softmax with temperature; ventures in grace get the mean score).
// 2. Shares = explorationFloor + (1 - n*floor) * softmax. Emit set-budget-share.
// 3. Kill rule (after grace): trailingRoi < killRoiThreshold OR ticksSinceLastSale > killNoSaleTicks → set-status killed with reason.
// 4. Scale rule: trailingRoi >= scaleRoiThreshold → set-status scaling. Demote scaling→active if it drops below.
// 5. If active ventures < maxVentures, spawn-venture in the kind with the best mean trailingRoi (ties → least-represented kind) with a thesis from playbooks.suggestThesis(kind, rng).
// 6. Emit one broadcast summarising the epoch in one sentence.

// playbooks.ts — what each venture kind actually does
export interface VenturePlaybook {
  kind: VentureKind; roomId: RoomId; roles: AgentRole[];
  /** Ordered task kinds for one production cycle, e.g. pod-store: research-niche → design-artwork → create-mockups → write-listing → review-output → publish-listing → promote */
  pipeline: TaskKind[];
  platforms: Platform[];
  reviewCriteria: string[];
  suggestThesis(rng: Rng): string;
  /** Build the concrete task list for one cycle, wired with dependsOn. */
  buildCycle(venture: Venture, tick: number, rng: Rng): Array<Omit<Task, 'id' | 'status' | 'attempts' | 'costCents' | 'createdAtTick' | 'assignedTo'>>;
}
export function playbookFor(kind: VentureKind): VenturePlaybook;
export const PLAYBOOKS: Record<VentureKind, VenturePlaybook>;
```

Write vitest tests for: pathfinding connectivity, ledger math (treasury from a
known ledger), allocation (a venture with negative ROI past grace gets killed;
shares sum to 1; a scaling venture gets the largest share), market model
(deterministic under a seed; zero listings → zero sales; higher quality →
more sales over 1000 ticks).

## Task output `data` shapes (by `TaskKind`)

| kind | `output.data` |
|---|---|
| research-niche | `{ niche: string; demandScore: 0..1; competition: 0..1; keywords: string[]; suggestedPriceCents: number; rationale: string }` |
| analyse-competitors | `{ niche; competitors: {name; priceCents; strengths: string[]}[]; gap: string }` |
| design-artwork / design-thumbnail / create-asset-pack / compose-track / build-template | `{ title: string; description: string; niche: string; files: string[]; specs: Record<string, unknown> }` |
| create-mockups | `{ productType: string; files: string[]; provider: 'printify' | 'printful' | 'mock' }` |
| write-article | `{ title; slug; wordCount; affiliateLinks: {product; url}[]; files }` |
| write-listing | `{ listing: Omit<Listing, 'id' | 'status' | 'createdAtTick' | 'stats'> }` |
| review-output | `{ quality: 0..1; approved: boolean; notes: string[]; targetTaskId: string }` |
| publish-listing | `{ listingId: string; approvalId?: string; externalId?: string; url?: string }` |
| optimise-listing | `{ listingId; changes: Record<string, unknown> }` |
| promote | `{ channel: Platform; posts: {text; url?}[] }` |
| fulfil-order | `{ orderId; deliverables: string[] }` |
| overseer-epoch | `{ directiveId: string }` |

## `@eternity/adapters` API

```ts
export interface AssetFile { path: string; mime: string; bytes?: Uint8Array; }
export interface PublishResult {
  ok: boolean;
  externalId?: string; url?: string;
  /** Present when the adapter cannot act (no API / not connected). The Airlock shows this to the human. */
  manual?: { instructions: string; payload: Record<string, unknown> };
  error?: string;
}
export interface SaleRecord { externalOrderId: string; listingExternalId: string; units: number; grossCents: number; feeCents: number; occurredAt: string; }
export interface PlatformAdapter {
  readonly platform: Platform;
  capability(): PlatformCapability;
  createListing(listing: Listing, assets: AssetFile[]): Promise<PublishResult>;
  updateListing(listing: Listing, changes: Partial<Listing>): Promise<PublishResult>;
  delist(listing: Listing): Promise<PublishResult>;
  readSales(sinceIso: string): Promise<SaleRecord[]>;
}
export interface AdapterEnv { [key: string]: string | undefined } // process.env passed in, never read directly
export interface AdapterRegistry {
  get(platform: Platform): PlatformAdapter;
  capabilities(): PlatformCapability[];
  /** Which platform a venture kind publishes to first, given what is connected. */
  primaryPlatformFor(kind: VentureKind): Platform;
}
export function createAdapterRegistry(env: AdapterEnv, opts: { mode: 'sim' | 'live'; fetchImpl?: typeof fetch }): AdapterRegistry;
```

Rules: in `sim` mode every platform resolves to the `mock` adapter (which just
returns `ok: true` with a fake URL; demand comes from core's market model in
the server). In `live` mode, a platform without credentials resolves to a
**draft-only** adapter that returns `manual` with copy-paste-ready payloads.
Real adapters must be honest about capability (`hasApi: false` for Fiverr and
DistroKid) and must record ToS constraints in `tosNotes`, e.g. Etsy requires a
human seller of record and disclosure of AI-assisted designs; Fiverr forbids
account sharing/automation of the seller account; Printify/Printful are fine
for automation. Use `fetchImpl` for HTTP so tests can inject a fake.

## `@eternity/server`

Env (validated with zod in `config.ts`): see `.env.example`. `MODE=sim` is the
default and must work with **zero** credentials and no network.

Runtime loop (`station.ts`):
1. `Clock` advances `tick` at `TICK_HZ * speed` per second unless paused.
2. Each tick: move agents one step along their path; in sim mode run
   `market.simulateTick` over live listings → ledger `revenue`/`platform-fee`/`fulfilment-cost` entries + `sale` events; in live mode poll adapters `readSales` every 60 ticks.
3. Dispatch: for each queued task whose deps are done, find an idle agent with the required role (hire one if the venture is under `maxCrewPerVenture` and budget allows), walk them to a workstation in the task's room, then run the brain **asynchronously** (bounded concurrency, e.g. 4). Task cost from real usage (live) or `estimateTaskCostCents` (sim) → ledger `token-cost`.
4. Tasks of kind `publish-listing`, and any tool call that spends money or touches an external account, create an `ApprovalRequest` and park the task as `awaiting-approval`. `approval.decide` resumes or cancels it. In sim mode, requests with `risk: 'low'` auto-approve after 6 ticks unless `AUTO_APPROVE=false`.
5. Every `policy.epochTicks`: build `StationState`, call `planEpoch`; in live mode also call the Claude Overseer with the metrics summary + any pending human instructions and merge its structured actions (validated; it may not exceed policy limits); apply; emit `overseer.directive`.
6. Persist everything in SQLite (`node:sqlite`, no native build): one table per entity with `id TEXT PRIMARY KEY, json TEXT, updated_tick INTEGER` plus indexed columns where queried (`ledger.tick`, `tasks.status`). Snapshot on boot restores state.
7. Daily token budget: when `dailyTokenBudgetRemainingCents <= 0`, workers go `resting` until the next sim day and the Overseer logs it.

Brains (`brains/`):
- `Brain.run(task, ctx): Promise<TaskOutput>` with `ctx = { venture, agent, workspace: { root, write(rel, content), read(rel), list() }, tick, rng, log, requestApproval }`. Paths are confined to the venture workspace; reject `..` and absolute paths.
- `ScriptedBrain`: deterministic, instant, produces plausible outputs per task kind (writes SVG artwork, markdown articles, JSON specs into the workspace) and speech lines for the UI.
- `ClaudeBrain`: uses `@anthropic-ai/sdk` `client.beta.messages.toolRunner` with `betaZodTool` tools: `write_file`, `read_file`, `list_files`, `research_web` (server tool `web_search_20260209` for scouts only), `submit_output` (structured, ends the run). Model from `WORKER_MODEL`, `thinking: { type: 'adaptive' }`, `output_config: { effort: 'medium' }`, `max_tokens: 16000`. Accumulate `usage` into the ledger. Role system prompts live in `brains/prompts/*.md` and are cached with `cache_control`.
- `OverseerEngine`: deterministic `planEpoch` always runs. In live mode `ClaudeOverseer` (`OVERSEER_MODEL`, `client.messages.parse` with `zodOutputFormat(OverseerDirectiveSchema)`, `thinking: { type: 'adaptive' }`, `output_config: { effort: 'high' }`) may add/adjust actions within policy bounds. Its system prompt states the truth: it is a capital allocator; it cannot create accounts, spend money or publish without the Airlock; it must prefer killing losers over motivating them.

HTTP/WS (`api.ts`), all JSON:
- `GET /api/health` → `{ ok, mode, tick }`
- `GET /api/state` → `StationState`
- `GET /api/capabilities` → `PlatformCapability[]`
- `GET /api/ledger?sinceTick=&limit=` → `LedgerEntry[]`
- `POST /api/command` body `StationCommand` → `{ ok } | { ok: false, reason }`
- `GET /ws` → WebSocket; first frame `snapshot`; accepts `StationCommand` frames.
- In production (`NODE_ENV=production`) serve `apps/station/dist` statically.

Boot seeds (fresh DB): HERMES in `core`; two scouts; one `pod-store` venture
("incubating") with a starter cycle; treasury `startingBalanceCents` = 0;
target = 1e14 cents. `pnpm sim` must show sales within the first simulated
week at 16x speed.

## `apps/station` (the game)

Vite + TypeScript + Canvas 2D, no framework, no asset files (draw everything
procedurally: metal floor tiles, glowing walls, room signage, pixel crew in
role-coloured suits, HERMES as a pulsing red eye in the core, reactor glow
proportional to daily profit, Airlock light amber when approvals are pending).

Layout: canvas fills the viewport; right dock (360px, collapsible) with tabs
**Core** (directives, treasury, target progress with milestone ticks, ETA in
honest units: "never at current velocity" when profit ≤ 0), **Airlock**
(pending approvals with risk badge, Approve / Reject / Approve all low-risk,
manual instructions expandable), **Ventures** (per-venture P&L, ROI, budget
share bar, status, kill/pause/resume), **Crew** (agents, task, cost,
attributed revenue), **Log**. Bottom bar: pause/resume, speed 1/4/16/64,
clock, mode badge (SIM / LIVE), connection state.

Interactions: hover a room → tooltip with purpose and live venture; click an
agent → select and follow; click a room → filter Ventures tab; `Space` pause;
`1..4` speed. Floating `+$x.xx` on `sale` events over the room; toast on
`milestone.reached`; speech bubbles from `agent.speech` for `ttlTicks`.

Movement: the server owns positions and emits `agent.moved` per step; the
client interpolates between tiles over the tick duration so motion is smooth
at any speed. Use `requestAnimationFrame`, target 60fps with 40 agents.

Networking: `ws://<host>/ws` with exponential reconnect, `snapshot.request`
on reconnect. Keep a `StationStore` (plain object + subscribers) as the single
source of truth; renderers read from it.

## docs/

- `docs/00-START-HERE.md` — what this is, how to run sim then live, the one-screen tour.
- `docs/01-economics-reality-check.md` — the honest numbers: platform GMVs, take rates, realistic per-listing revenue, token cost per task, break-even math, why the target is a mirror not a plan, what a good month looks like.
- `docs/02-architecture.md` — diagram + tick loop + data model + failure modes.
- `docs/03-venture-playbooks.md` — per kind: what sells, what gets banned, pipeline, review criteria, first 30 days.
- `docs/04-platform-constraints.md` — ToS + API reality per platform, human-must-do list (KYC, tax, payouts, disputes).
- `docs/05-runbook.md` — daily 10-minute Airlock routine, weekly review, kill criteria, security (keys, workspace confinement, spend caps).
