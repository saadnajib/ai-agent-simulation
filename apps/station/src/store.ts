/**
 * StationStore: the single source of truth on the client. Holds the last
 * StationState, applies every StationEvent as a reducer, tracks per-agent
 * movement interpolation targets and speech bubble expiry, and keeps a
 * bounded log. Renderers and panels read from it; nothing else mutates it.
 */
import type {
  ApprovalRequest,
  CrewAgent,
  EventOf,
  GridPosition,
  LedgerEntry,
  Listing,
  OverseerDirective,
  RoomId,
  StationEvent,
  StationEventType,
  StationState,
  Task,
  Venture,
} from '@eternity/core';

export type ConnectionState = 'connecting' | 'open' | 'closed' | 'mock';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AgentMotion {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
  durationMs: number;
}

export interface SpeechBubble {
  text: string;
  expiresAtTick: number;
}

export interface LogLine {
  seq: number;
  tick: number;
  level: LogLevel;
  message: string;
  agentId?: string;
}

export interface UiState {
  selectedAgentId: string | null;
  selectedRoomId: RoomId | null;
  followSelected: boolean;
  hoverRoomId: RoomId | null;
  hoverAgentId: string | null;
}

export interface StoreState {
  connection: ConnectionState;
  station: StationState | null;
  motions: Map<string, AgentMotion>;
  speech: Map<string, SpeechBubble>;
  logs: LogLine[];
  overseerThinking: string;
  /** Estimated wall-clock duration of one tick, used to time interpolation. */
  tickDurationMs: number;
  lastTickAtMs: number;
  lastRejection: string | null;
  ui: UiState;
  /** Bumped on every change so consumers can cheaply detect staleness. */
  revision: number;
}

export type StoreListener = (state: StoreState) => void;
type EventListener<T extends StationEventType> = (event: EventOf<T>) => void;

export const DEFAULT_TICK_HZ = 2;
export const MAX_LOG_LINES = 300;
export const MAX_LEDGER_LINES = 1000;
export const MAX_DIRECTIVES = 50;
export const MAX_TASKS = 2000;
/** Speech carried on agent.upserted has no ttl; give it a sensible one. */
export const IMPLICIT_SPEECH_TTL_TICKS = 6;
const MIN_TICK_MS = 15;
const MAX_TICK_MS = 5000;

export function expectedTickMs(speed: number, tickHz = DEFAULT_TICK_HZ): number {
  const safeSpeed = speed > 0 ? speed : 1;
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, 1000 / (tickHz * safeSpeed)));
}

function upsertById<T extends { id: string }>(list: T[], item: T): void {
  const index = list.findIndex((x) => x.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = item;
}

function cap<T>(list: T[], max: number): void {
  if (list.length > max) list.splice(0, list.length - max);
}

function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

export class StationStore {
  readonly state: StoreState;
  private readonly listeners = new Set<StoreListener>();
  private readonly eventListeners = new Map<string, Set<(event: StationEvent) => void>>();
  private logSeq = 0;
  private readonly now: () => number;

  constructor(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.now = now;
    this.state = {
      connection: 'connecting',
      station: null,
      motions: new Map(),
      speech: new Map(),
      logs: [],
      overseerThinking: '',
      tickDurationMs: expectedTickMs(1),
      lastTickAtMs: 0,
      lastRejection: null,
      ui: { selectedAgentId: null, selectedRoomId: null, followSelected: false, hoverRoomId: null, hoverAgentId: null },
      revision: 0,
    };
  }

  // ------------------------------------------------------------ subscribe

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Listen for a specific event type after it has been applied to state. */
  on<T extends StationEventType>(type: T, listener: EventListener<T>): () => void {
    let set = this.eventListeners.get(type);
    if (set === undefined) {
      set = new Set();
      this.eventListeners.set(type, set);
    }
    const wrapped = listener as (event: StationEvent) => void;
    set.add(wrapped);
    return () => {
      set?.delete(wrapped);
    };
  }

  private notify(): void {
    this.state.revision++;
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (err) {
        console.error('[store] listener failed', err);
      }
    }
  }

  private emit(event: StationEvent): void {
    const set = this.eventListeners.get(event.type);
    if (set === undefined) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[store] ${event.type} listener failed`, err);
      }
    }
  }

  // --------------------------------------------------------------- lookups

  get station(): StationState | null {
    return this.state.station;
  }

  get tick(): number {
    return this.state.station?.clock.tick ?? 0;
  }

  agentById(id: string | null): CrewAgent | undefined {
    if (id === null || this.state.station === null) return undefined;
    return this.state.station.agents.find((a) => a.id === id);
  }

  ventureById(id: string | undefined): Venture | undefined {
    if (id === undefined || this.state.station === null) return undefined;
    return this.state.station.ventures.find((v) => v.id === id);
  }

  taskById(id: string | undefined): Task | undefined {
    if (id === undefined || this.state.station === null) return undefined;
    return this.state.station.tasks.find((t) => t.id === id);
  }

  /** The most relevant venture for a room: scaling > active > incubating > paused > killed. */
  ventureInRoom(roomId: RoomId): Venture | undefined {
    const station = this.state.station;
    if (station === null) return undefined;
    const rank: Record<Venture['status'], number> = { scaling: 0, active: 1, incubating: 2, paused: 3, killed: 4 };
    let best: Venture | undefined;
    for (const v of station.ventures) {
      if (v.roomId !== roomId) continue;
      if (best === undefined || rank[v.status] < rank[best.status]) best = v;
    }
    return best;
  }

  pendingApprovals(): ApprovalRequest[] {
    return this.state.station?.approvals.filter((a) => a.status === 'pending') ?? [];
  }

  workingAgentCount(): number {
    let n = 0;
    for (const a of this.state.station?.agents ?? []) if (a.status === 'working') n++;
    return n;
  }

  speechFor(agentId: string): string | null {
    const bubble = this.state.speech.get(agentId);
    if (bubble === undefined) return null;
    if (bubble.expiresAtTick <= this.tick) return null;
    return bubble.text;
  }

  // ------------------------------------------------------------ ui actions

  setConnection(connection: ConnectionState): void {
    if (this.state.connection === connection) return;
    this.state.connection = connection;
    this.notify();
  }

  selectAgent(agentId: string | null, follow = agentId !== null): void {
    this.state.ui.selectedAgentId = agentId;
    this.state.ui.followSelected = agentId !== null && follow;
    this.notify();
  }

  selectRoom(roomId: RoomId | null): void {
    this.state.ui.selectedRoomId = this.state.ui.selectedRoomId === roomId ? null : roomId;
    this.notify();
  }

  clearRoomSelection(): void {
    if (this.state.ui.selectedRoomId === null) return;
    this.state.ui.selectedRoomId = null;
    this.notify();
  }

  setFollow(follow: boolean): void {
    if (this.state.ui.followSelected === follow) return;
    this.state.ui.followSelected = follow && this.state.ui.selectedAgentId !== null;
    this.notify();
  }

  setHover(roomId: RoomId | null, agentId: string | null): void {
    const ui = this.state.ui;
    if (ui.hoverRoomId === roomId && ui.hoverAgentId === agentId) return;
    ui.hoverRoomId = roomId;
    ui.hoverAgentId = agentId;
    this.notify();
  }

  clearRejection(): void {
    if (this.state.lastRejection === null) return;
    this.state.lastRejection = null;
    this.notify();
  }

  // ----------------------------------------------------------------- apply

  apply(event: StationEvent, nowMs: number = this.now()): void {
    if (event.type === 'snapshot') {
      this.applySnapshot(event.state, nowMs);
    } else if (this.state.station === null) {
      // Incremental events before the first snapshot cannot be applied; keep logs so the user sees activity.
      if (event.type === 'log') this.pushLog(event.level, event.message, event.tick, event.agentId);
    } else {
      this.applyIncremental(this.state.station, event, nowMs);
    }
    this.emit(event);
    this.notify();
  }

  private applySnapshot(state: StationState, nowMs: number): void {
    const prev = this.state.station;
    this.state.station = state;
    this.state.motions.clear();
    this.state.speech.clear();
    this.state.tickDurationMs = expectedTickMs(state.clock.speed);
    this.state.lastTickAtMs = nowMs;
    for (const agent of state.agents) {
      if (agent.speech) {
        this.state.speech.set(agent.id, { text: agent.speech, expiresAtTick: state.clock.tick + IMPLICIT_SPEECH_TTL_TICKS });
      }
    }
    if (this.state.ui.selectedAgentId !== null && !state.agents.some((a) => a.id === this.state.ui.selectedAgentId)) {
      this.state.ui.selectedAgentId = null;
      this.state.ui.followSelected = false;
    }
    if (prev !== null) this.pushLog('info', 'Snapshot received', state.clock.tick);
  }

  private applyIncremental(station: StationState, event: Exclude<StationEvent, { type: 'snapshot' }>, nowMs: number): void {
    switch (event.type) {
      case 'tick':
        this.applyTick(station, event, nowMs);
        break;
      case 'treasury.updated':
        station.treasury = event.treasury;
        break;
      case 'venture.upserted':
        upsertById(station.ventures, event.venture);
        break;
      case 'venture.removed':
        station.ventures = station.ventures.filter((v) => v.id !== event.ventureId);
        break;
      case 'agent.upserted':
        this.applyAgentUpsert(station, event.agent, nowMs);
        break;
      case 'agent.moved':
        this.applyAgentMoved(station, event, nowMs);
        break;
      case 'agent.speech':
        this.applySpeech(station, event.agentId, event.text, event.ttlTicks);
        break;
      case 'task.upserted':
        upsertById(station.tasks, event.task);
        cap(station.tasks, MAX_TASKS);
        break;
      case 'listing.upserted':
        upsertById(station.listings, event.listing as Listing);
        break;
      case 'approval.requested':
      case 'approval.decided':
        upsertById(station.approvals, event.approval);
        break;
      case 'ledger.entry':
        station.ledger.push(event.entry as LedgerEntry);
        cap(station.ledger, MAX_LEDGER_LINES);
        break;
      case 'sale':
        this.pushLog('info', `Sale: ${event.itemTitle} on ${event.platform} (+${(event.netCents / 100).toFixed(2)} net)`, event.tick);
        break;
      case 'overseer.directive':
        upsertById(station.directives, event.directive as OverseerDirective);
        cap(station.directives, MAX_DIRECTIVES);
        this.state.overseerThinking = '';
        break;
      case 'overseer.thinking':
        this.state.overseerThinking = event.text;
        break;
      case 'milestone.reached':
        this.applyMilestone(station, event.label, event.cents, event.tick);
        break;
      case 'log':
        this.pushLog(event.level, event.message, event.tick, event.agentId);
        break;
      case 'command.rejected':
        this.state.lastRejection = event.reason;
        this.pushLog('warn', `Command rejected: ${event.reason}`, station.clock.tick);
        break;
      case 'command.ok':
        break;
    }
  }

  private applyTick(station: StationState, event: EventOf<'tick'>, nowMs: number): void {
    const clock = station.clock;
    const speedChanged = clock.speed !== event.speed;
    const wasPaused = clock.paused;
    const advanced = event.tick - clock.tick;
    clock.tick = event.tick;
    clock.simTime = event.simTime;
    clock.paused = event.paused;
    clock.speed = event.speed;

    if (speedChanged || wasPaused || event.paused) {
      this.state.tickDurationMs = expectedTickMs(event.speed);
    } else if (advanced > 0 && this.state.lastTickAtMs > 0) {
      const observed = (nowMs - this.state.lastTickAtMs) / advanced;
      if (observed >= MIN_TICK_MS && observed <= MAX_TICK_MS) {
        this.state.tickDurationMs = this.state.tickDurationMs * 0.6 + observed * 0.4;
      }
    }
    this.state.lastTickAtMs = nowMs;

    if (this.state.speech.size > 0) {
      for (const [id, bubble] of this.state.speech) {
        if (bubble.expiresAtTick <= event.tick) this.state.speech.delete(id);
      }
    }
  }

  private applyAgentUpsert(station: StationState, agent: CrewAgent, nowMs: number): void {
    const existing = station.agents.find((a) => a.id === agent.id);
    upsertById(station.agents, agent);
    const motion = this.state.motions.get(agent.id);
    if (motion !== undefined && (motion.toX !== agent.position.x || motion.toY !== agent.position.y)) {
      // Teleport or correction from the server: snap without animating.
      motion.fromX = motion.toX = agent.position.x;
      motion.fromY = motion.toY = agent.position.y;
      motion.startMs = nowMs;
      motion.durationMs = 1;
    }
    if (agent.speech && agent.speech !== existing?.speech && !this.state.speech.has(agent.id)) {
      this.applySpeech(station, agent.id, agent.speech, IMPLICIT_SPEECH_TTL_TICKS);
    }
  }

  private applyAgentMoved(station: StationState, event: EventOf<'agent.moved'>, nowMs: number): void {
    const agent = station.agents.find((a) => a.id === event.agentId);
    if (agent === undefined) return;
    agent.position = { x: event.to.x, y: event.to.y };
    agent.roomId = event.roomId;
    let motion = this.state.motions.get(event.agentId);
    if (motion === undefined) {
      motion = { fromX: event.from.x, fromY: event.from.y, toX: event.to.x, toY: event.to.y, startMs: nowMs, durationMs: 1 };
      this.state.motions.set(event.agentId, motion);
    }
    const fromX = samePosition(event.from, { x: motion.toX, y: motion.toY }) ? motion.toX : event.from.x;
    const fromY = samePosition(event.from, { x: motion.toX, y: motion.toY }) ? motion.toY : event.from.y;
    motion.fromX = fromX;
    motion.fromY = fromY;
    motion.toX = event.to.x;
    motion.toY = event.to.y;
    motion.startMs = nowMs;
    motion.durationMs = this.state.tickDurationMs;
  }

  private applySpeech(station: StationState, agentId: string, text: string, ttlTicks: number): void {
    const agent = station.agents.find((a) => a.id === agentId);
    if (agent !== undefined) agent.speech = text;
    const ttl = Number.isFinite(ttlTicks) && ttlTicks > 0 ? ttlTicks : IMPLICIT_SPEECH_TTL_TICKS;
    this.state.speech.set(agentId, { text, expiresAtTick: station.clock.tick + ttl });
  }

  private applyMilestone(station: StationState, label: string, cents: number, tick: number): void {
    const milestone = station.treasury.milestones.find((m) => m.cents === cents || m.label === label);
    if (milestone !== undefined && milestone.reachedAtTick === undefined) milestone.reachedAtTick = tick;
    this.pushLog('info', `Milestone reached: ${label}`, tick);
  }

  private pushLog(level: LogLevel, message: string, tick: number, agentId?: string): void {
    const line: LogLine = { seq: ++this.logSeq, tick, level, message };
    if (agentId !== undefined) line.agentId = agentId;
    this.state.logs.push(line);
    cap(this.state.logs, MAX_LOG_LINES);
  }
}

/** Interpolated tile position for an agent at `nowMs`, written into `out`. */
export function resolveAgentPosition(
  agent: CrewAgent,
  motion: AgentMotion | undefined,
  nowMs: number,
  out: { x: number; y: number; moving: boolean },
): void {
  if (motion === undefined) {
    out.x = agent.position.x;
    out.y = agent.position.y;
    out.moving = false;
    return;
  }
  const t = motion.durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - motion.startMs) / motion.durationMs));
  out.x = motion.fromX + (motion.toX - motion.fromX) * t;
  out.y = motion.fromY + (motion.toY - motion.fromY) * t;
  out.moving = t < 1 && (motion.fromX !== motion.toX || motion.fromY !== motion.toY);
}
