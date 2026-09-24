/**
 * World: the in-memory station state plus write-through persistence. Every
 * mutation goes through a put* method so it is marked dirty for the next
 * flush (one SQLite transaction per tick) and broadcast on the bus.
 */
import type {
  AllocationPolicy,
  ApprovalRequest,
  CrewAgent,
  GridPosition,
  LedgerEntry,
  Listing,
  OverseerDirective,
  Rng,
  StationMap,
  StationState,
  Task,
  Treasury,
  Venture,
} from '@eternity/core';
import { DEFAULT_POLICY, buildStationMap, createRng, makeId } from '@eternity/core';
import type { StationBus, LogLevel } from './bus.js';
import { StationClock, type Speed } from './clock.js';
import type { ServerConfig } from './config.js';
import { TABLES, type StationDb, type TableName } from './db.js';
import { Ledger, type LedgerRecordInput } from './ledger.js';

export const SNAPSHOT_LEDGER_ENTRIES = 200;
export const SNAPSHOT_DIRECTIVES = 20;
/** Killed ventures without live listings leave the snapshot after this many ticks (they stay in SQLite). */
const KILLED_VISIBLE_TICKS = 336;
/** Finished tasks and decided approvals older than this leave memory and snapshots (they stay in SQLite). */
export const HISTORY_TICKS = 24 * 30;
/** Snapshots carry finished tasks from the last week only. */
export const SNAPSHOT_TASK_TICKS = 24 * 7;
const DEFAULT_SPEECH_TTL = 6;
const TERMINAL_TASK: ReadonlySet<Task['status']> = new Set(['done', 'failed', 'cancelled', 'rejected']);

interface ClockMeta {
  tick: number;
  paused: boolean;
  speed: Speed;
}

export interface WorldOptions {
  config: ServerConfig;
  db: StationDb;
  bus: StationBus;
  now?: () => string;
}

export class World {
  readonly config: ServerConfig;
  readonly db: StationDb;
  readonly bus: StationBus;
  readonly map: StationMap;
  readonly clock: StationClock;
  readonly ledger: Ledger;
  readonly now: () => string;
  policy: AllocationPolicy;
  targetCents: number;
  seed: number;

  readonly ventures = new Map<string, Venture>();
  readonly agents = new Map<string, CrewAgent>();
  readonly tasks = new Map<string, Task>();
  readonly listings = new Map<string, Listing>();
  readonly approvals = new Map<string, ApprovalRequest>();
  directives: OverseerDirective[] = [];
  /** Human instructions waiting for the next epoch. */
  instructions: string[] = [];
  readonly announcedMilestones = new Set<string>();

  // Runtime-only (rebuilt on boot).
  readonly paths = new Map<string, GridPosition[]>();
  readonly restUntil = new Map<string, number>();
  readonly assignedAt = new Map<string, number>();

  private rootRng: Rng;
  private idRng: Rng;
  private idRngTick = -1;
  private readonly dirty: Record<TableName, Set<string>>;
  private readonly removed: Record<TableName, Set<string>>;
  private readonly pendingLedger = new Map<string, LedgerEntry>();
  private metaDirty = true;

  constructor(opts: WorldOptions) {
    this.config = opts.config;
    this.db = opts.db;
    this.bus = opts.bus;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.map = buildStationMap();
    this.seed = opts.config.seed;
    this.targetCents = opts.config.targetCents;
    this.policy = { ...DEFAULT_POLICY, ...opts.config.policyOverrides };
    this.rootRng = createRng(this.seed);
    this.idRng = this.rootRng.fork('ids:0');
    this.clock = new StationClock({ tickHz: opts.config.tickHz });
    this.dirty = emptySets();
    this.removed = emptySets();
    this.ledger = new Ledger([], (entry) => {
      this.pendingLedger.set(entry.id, entry);
      this.bus.emit({ type: 'ledger.entry', entry });
    });
  }

  get tick(): number {
    return this.clock.tick;
  }

  get mode(): 'sim' | 'live' {
    return this.config.mode;
  }

  /** Reproducible stream for a purpose at the current tick. */
  rng(label: string): Rng {
    return this.rootRng.fork(`${label}:${this.tick}`);
  }

  /** Stream that does not depend on the tick (used at seed time and for names). */
  stableRng(label: string): Rng {
    return this.rootRng.fork(label);
  }

  id(prefix: string): string {
    if (this.idRngTick !== this.tick) {
      this.idRng = this.rootRng.fork(`ids:${this.tick}`);
      this.idRngTick = this.tick;
    }
    return makeId(prefix, this.idRng);
  }

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  putVenture(venture: Venture): void {
    this.ventures.set(venture.id, venture);
    this.dirty.ventures.add(venture.id);
    this.bus.emit({ type: 'venture.upserted', venture });
  }

  putAgent(agent: CrewAgent, emit = true): void {
    this.agents.set(agent.id, agent);
    this.dirty.agents.add(agent.id);
    if (emit) this.bus.emit({ type: 'agent.upserted', agent });
  }

  putTask(task: Task): void {
    this.tasks.set(task.id, task);
    this.dirty.tasks.add(task.id);
    this.bus.emit({ type: 'task.upserted', task });
  }

  putListing(listing: Listing, emit = true): void {
    this.listings.set(listing.id, listing);
    this.dirty.listings.add(listing.id);
    if (emit) this.bus.emit({ type: 'listing.upserted', listing });
  }

  putApproval(approval: ApprovalRequest, event: 'approval.requested' | 'approval.decided' | null): void {
    this.approvals.set(approval.id, approval);
    this.dirty.approvals.add(approval.id);
    if (event) this.bus.emit({ type: event, approval });
  }

  pushDirective(directive: OverseerDirective): void {
    this.directives.push(directive);
    this.dirty.directives.add(directive.id);
    this.bus.emit({ type: 'overseer.directive', directive });
  }

  record(input: Omit<LedgerRecordInput, 'id' | 'tick' | 'source' | 'ts'> & { tick?: number }): LedgerEntry {
    const { tick, ...rest } = input;
    return this.ledger.record({ ...rest, id: this.id('led'), tick: tick ?? this.tick, source: this.mode, ts: this.now() });
  }

  markMeta(): void {
    this.metaDirty = true;
  }

  treasury(): Treasury {
    return this.ledger.treasury(this.tick, { targetCents: this.targetCents, dailyTokenBudgetCents: this.config.dailyTokenBudgetCents });
  }

  log(level: LogLevel, message: string, agentId?: string): void {
    this.bus.log(level, message, this.tick, agentId);
  }

  speak(agentId: string, text: string, ttlTicks = DEFAULT_SPEECH_TTL): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.speech = text;
    this.dirty.agents.add(agent.id);
    this.bus.emit({ type: 'agent.speech', agentId, text, ttlTicks });
  }

  // ---------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------

  venture(id: string | undefined): Venture | undefined {
    return id === undefined ? undefined : this.ventures.get(id);
  }

  agentsList(): CrewAgent[] {
    return [...this.agents.values()];
  }

  tasksOf(ventureId: string): Task[] {
    return [...this.tasks.values()].filter((t) => t.ventureId === ventureId);
  }

  listingsOf(ventureId: string): Listing[] {
    return [...this.listings.values()].filter((l) => l.ventureId === ventureId);
  }

  /** Drops long-finished tasks and decided approvals from memory. Rows stay in SQLite. */
  pruneHistory(): number {
    const cutoff = this.tick - HISTORY_TICKS;
    let removed = 0;
    for (const [id, task] of this.tasks) {
      if (TERMINAL_TASK.has(task.status) && (task.finishedAtTick ?? task.createdAtTick) < cutoff && !this.dirty.tasks.has(id)) {
        this.tasks.delete(id);
        removed++;
      }
    }
    for (const [id, approval] of this.approvals) {
      if (approval.status !== 'pending' && approval.requestedAtTick < cutoff && !this.dirty.approvals.has(id)) {
        this.approvals.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Killed ventures stay visible for two sim weeks, or for as long as they still have listings live. */
  private inSnapshot(venture: Venture): boolean {
    if (venture.status !== 'killed') return true;
    if (this.tick - (venture.killedAtTick ?? this.tick) < KILLED_VISIBLE_TICKS) return true;
    for (const listing of this.listings.values()) {
      if (listing.ventureId === venture.id && listing.status === 'live') return true;
    }
    return false;
  }

  state(): StationState {
    const recent = this.tick - SNAPSHOT_TASK_TICKS;
    return {
      mode: this.mode,
      ...(this.mode === 'sim' ? { simDemandMultiplier: this.config.simDemandMultiplier } : {}),
      clock: this.clock.snapshot(),
      treasury: this.treasury(),
      policy: { ...this.policy },
      ventures: [...this.ventures.values()].filter((v) => this.inSnapshot(v)),
      agents: [...this.agents.values()],
      tasks: [...this.tasks.values()].filter((t) => !TERMINAL_TASK.has(t.status) || (t.finishedAtTick ?? t.createdAtTick) >= recent),
      listings: [...this.listings.values()],
      approvals: [...this.approvals.values()].filter((a) => a.status === 'pending' || a.requestedAtTick >= recent),
      ledger: this.ledger.recent(SNAPSHOT_LEDGER_ENTRIES),
      directives: this.directives.slice(Math.max(0, this.directives.length - SNAPSHOT_DIRECTIVES)),
    };
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------

  /** Loads every table. Returns false when the database is empty (caller seeds). */
  load(): boolean {
    if (this.db.isEmpty()) return false;
    for (const v of this.db.loadAll<Venture>('ventures')) this.ventures.set(v.id, v);
    for (const a of this.db.loadAll<CrewAgent>('agents')) this.agents.set(a.id, a);
    for (const t of this.db.loadAll<Task>('tasks')) this.tasks.set(t.id, t);
    for (const l of this.db.loadAll<Listing>('listings')) this.listings.set(l.id, l);
    for (const ap of this.db.loadAll<ApprovalRequest>('approvals')) this.approvals.set(ap.id, ap);
    this.directives = this.db.loadAll<OverseerDirective>('directives').sort((a, b) => a.tick - b.tick);
    const entries = this.db.loadAll<LedgerEntry>('ledger');
    this.ledger.load(entries);

    const clock = this.db.getMeta<ClockMeta>('clock');
    if (clock) {
      this.clock.tick = clock.tick;
      this.clock.paused = clock.paused;
      this.clock.speed = clock.speed;
    }
    const seed = this.db.getMeta<number>('seed');
    if (typeof seed === 'number' && seed !== this.seed) {
      this.log('warn', `Database was created with seed ${seed}; ignoring configured seed ${this.seed}`);
      this.seed = seed;
      this.rootRng = createRng(seed);
    }
    const target = this.db.getMeta<number>('targetCents');
    if (typeof target === 'number' && target > 0) this.targetCents = target;
    const policy = this.db.getMeta<AllocationPolicy>('policy');
    // Env overrides win over the stored row so a redeploy can retune a running station.
    if (policy) this.policy = { ...DEFAULT_POLICY, ...policy, ...this.config.policyOverrides };
    const instructions = this.db.getMeta<string[]>('instructions');
    if (Array.isArray(instructions)) this.instructions = instructions.filter((s) => typeof s === 'string');
    const milestones = this.db.getMeta<string[]>('announcedMilestones');
    if (Array.isArray(milestones)) for (const label of milestones) this.announcedMilestones.add(label);
    return true;
  }

  /** Writes every dirty entity and the meta block in a single transaction. */
  flush(): void {
    const hasWork = TABLES.some((t) => this.dirty[t].size > 0 || this.removed[t].size > 0) || this.pendingLedger.size > 0 || this.metaDirty;
    if (!hasWork) return;
    const tick = this.tick;
    this.db.transaction(() => {
      for (const id of this.dirty.ventures) writeIf(this.db, 'ventures', id, this.ventures.get(id), tick);
      for (const id of this.dirty.agents) writeIf(this.db, 'agents', id, this.agents.get(id), tick);
      for (const id of this.dirty.tasks) writeIf(this.db, 'tasks', id, this.tasks.get(id), tick);
      for (const id of this.dirty.listings) writeIf(this.db, 'listings', id, this.listings.get(id), tick);
      for (const id of this.dirty.approvals) writeIf(this.db, 'approvals', id, this.approvals.get(id), tick);
      for (const id of this.dirty.directives) writeIf(this.db, 'directives', id, this.directives.find((d) => d.id === id), tick);
      for (const [id, entry] of this.pendingLedger) this.db.upsert('ledger', id, entry, tick);
      for (const table of TABLES) for (const id of this.removed[table]) this.db.remove(table, id);
      this.db.setMeta('clock', { tick: this.clock.tick, paused: this.clock.paused, speed: this.clock.speed } satisfies ClockMeta);
      this.db.setMeta('seed', this.seed);
      this.db.setMeta('targetCents', this.targetCents);
      this.db.setMeta('policy', this.policy);
      this.db.setMeta('instructions', this.instructions);
      this.db.setMeta('announcedMilestones', [...this.announcedMilestones]);
      this.db.setMeta('mode', this.mode);
    });
    for (const table of TABLES) {
      this.dirty[table].clear();
      this.removed[table].clear();
    }
    this.pendingLedger.clear();
    this.metaDirty = false;
  }
}

function emptySets(): Record<TableName, Set<string>> {
  return {
    ventures: new Set(),
    agents: new Set(),
    tasks: new Set(),
    listings: new Set(),
    approvals: new Set(),
    ledger: new Set(),
    directives: new Set(),
  };
}

function writeIf(db: StationDb, table: TableName, id: string, value: unknown, tick: number): void {
  if (value !== undefined) db.upsert(table, id, value, tick);
}
