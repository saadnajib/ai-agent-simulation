/**
 * Station orchestrator: owns the tick loop and every StationCommand.
 *
 * Each tick: wake rested crew, move walking agents one tile, simulate (or
 * poll) sales, run the Airlock, resolve scripted work due this tick, let
 * brain completions settle, top up production cycles, dispatch ready tasks,
 * send idle crew home, run the Overseer on epoch boundaries, recompute the
 * treasury, announce milestones, broadcast the tick, and flush to SQLite.
 */
import type { CrewAgent, MarketModel, StationCommand, StationState, Task, Venture } from '@eternity/core';
import { TICKS_PER_DAY, createMarketModel, dayStartTick, formatCents } from '@eternity/core';
import type { AdapterRegistry } from '@eternity/adapters';
import { Airlock } from './airlock.js';
import type { Brain } from './brains/types.js';
import type { StationBus } from './bus.js';
import type { Speed } from './clock.js';
import type { ServerConfig } from './config.js';
import type { StationDb } from './db.js';
import { dispatchTasks, returnIdleToQuarters, moveAgents } from './dispatch.js';
import { OverseerEngine } from './overseer/engine.js';
import type { ClaudeOverseer } from './overseer/claude.js';
import { LIVE_POLL_INTERVAL_TICKS, demandOverrides, pollLiveSales, simulateSales } from './sales.js';
import { findHermes, seedStation } from './seed.js';
import { World } from './state.js';
import { dismissAgent, ensureCycles, hireAgent, refreshMetrics, setVentureStatus, spawnVenture } from './ventures.js';
import { WorkRunner } from './work.js';

const METRICS_REFRESH_TICKS = 6;

export type CommandResult = { ok: true } | { ok: false; reason: string };

export interface StationOptions {
  config: ServerConfig;
  db: StationDb;
  bus: StationBus;
  brain: Brain;
  registry: AdapterRegistry;
  overseer?: ClaudeOverseer | null;
  now?: () => string;
}

export class Station {
  readonly world: World;
  readonly airlock: Airlock;
  readonly work: WorkRunner;
  readonly engine: OverseerEngine;
  readonly market: MarketModel;
  readonly registry: AdapterRegistry;
  readonly hermesId: string;
  private readonly seenOrders = new Set<string>();
  private lastPollIso: string;
  private budgetExhaustedDay = -1;
  private stepping = false;

  private constructor(opts: StationOptions, world: World) {
    this.world = world;
    this.registry = opts.registry;
    this.market = createMarketModel(opts.config.mode === 'sim' ? demandOverrides(opts.config.simDemandMultiplier) : {});
    this.airlock = new Airlock(world, { autoApprove: opts.config.autoApprove });
    this.work = new WorkRunner(world, { brain: opts.brain, airlock: this.airlock, registry: opts.registry, concurrency: opts.config.brainConcurrency });
    const hermes = findHermes(world);
    if (!hermes) throw new Error('Station has no Overseer agent');
    this.hermesId = hermes.id;
    this.engine = new OverseerEngine(world, {
      registry: opts.registry,
      cancel: (task, reason) => this.work.cancel(task, reason),
      hermesId: hermes.id,
      claude: opts.overseer ?? null,
    });
    this.lastPollIso = world.now();
  }

  /** Loads persisted state or seeds a fresh station, then flushes. */
  static create(opts: StationOptions): Station {
    const world = new World({ config: opts.config, db: opts.db, bus: opts.bus, ...(opts.now ? { now: opts.now } : {}) });
    const loaded = world.load();
    if (!loaded) seedStation(world, opts.registry);
    else world.log('info', `Restored station at tick ${world.tick}: ${world.ventures.size} ventures, ${world.agents.size} crew, ${world.ledger.size()} ledger entries`);
    const station = new Station(opts, world);
    if (loaded) station.work.recover();
    for (const label of world.treasury().milestones.filter((m) => m.reachedAtTick !== undefined).map((m) => m.label)) {
      world.announcedMilestones.add(label);
    }
    world.flush();
    return station;
  }

  state(): StationState {
    return this.world.state();
  }

  get tick(): number {
    return this.world.tick;
  }

  start(): void {
    this.world.clock.start(() => this.step());
  }

  stop(): void {
    this.world.clock.stop();
    this.world.flush();
  }

  // ---------------------------------------------------------------------
  // Tick
  // ---------------------------------------------------------------------

  async step(): Promise<void> {
    if (this.stepping) return;
    this.stepping = true;
    try {
      const world = this.world;
      world.clock.tick += 1;
      const tick = world.tick;
      if (tick % TICKS_PER_DAY === 0) this.onNewDay();
      this.work.wakeRested();
      moveAgents(world, (agent) => this.work.onArrive(agent));
      this.collectRevenue();
      this.airlock.tick();
      this.work.resolveWaiters();
      await settle();
      ensureCycles(world);
      this.dispatch();
      returnIdleToQuarters(world);
      if (tick % world.policy.epochTicks === 0) await this.engine.runEpoch();
      else if (tick % METRICS_REFRESH_TICKS === 0) refreshMetrics(world);
      this.publishTreasury();
      const clock = world.clock.snapshot();
      world.bus.emit({ type: 'tick', tick: clock.tick, simTime: clock.simTime, paused: clock.paused, speed: clock.speed });
      world.flush();
    } finally {
      this.stepping = false;
    }
  }

  private onNewDay(): void {
    const pruned = this.world.pruneHistory();
    if (pruned > 0) this.world.log('debug', `Pruned ${pruned} finished records from memory`);
    for (const agent of this.world.agents.values()) {
      if (agent.status === 'resting' && !this.world.restUntil.has(agent.id)) {
        agent.status = 'idle';
        this.world.putAgent(agent);
      }
    }
    this.world.log('info', `Day ${Math.floor(this.world.tick / TICKS_PER_DAY)} begins. Token budget reset to ${formatCents(this.world.config.dailyTokenBudgetCents)}.`);
  }

  private collectRevenue(): void {
    const world = this.world;
    if (world.mode === 'sim') {
      simulateSales(world, this.market);
      return;
    }
    if (world.tick % LIVE_POLL_INTERVAL_TICKS !== 0) return;
    const since = this.lastPollIso;
    this.lastPollIso = world.now();
    void pollLiveSales(world, this.registry, this.seenOrders, since).catch((error: unknown) => {
      world.log('warn', `Sales poll failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private dispatch(): void {
    const world = this.world;
    const treasury = world.treasury();
    if (treasury.dailyTokenBudgetRemainingCents <= 0) {
      this.restCrewForBudget();
      return;
    }
    const dayStart = dayStartTick(world.tick);
    const spent = world.ledger.tokenSpendByVenture(dayStart, world.tick);
    const budget = world.config.dailyTokenBudgetCents;
    dispatchTasks(world, {
      hasCapacity: () => this.work.hasCapacity(),
      canSpend: (_task: Task, venture: Venture | undefined) => {
        if (!venture) return true;
        const used = spent.get(venture.id) ?? 0;
        return used <= 0 || used < venture.budgetShare * budget;
      },
      hire: (role, venture) => hireAgent(world, role, venture),
      assign: (task, agent) => this.work.assign(task, agent),
    });
  }

  private restCrewForBudget(): void {
    const world = this.world;
    const day = Math.floor(world.tick / TICKS_PER_DAY);
    if (this.budgetExhaustedDay !== day) {
      this.budgetExhaustedDay = day;
      world.log('warn', `HERMES: daily token budget exhausted; crew rests until the next day.`, this.hermesId);
      world.speak(this.hermesId, 'Budget is spent. Nobody works for free, not even here.', 10);
    }
    for (const agent of world.agents.values()) {
      if (agent.role === 'overseer' || agent.status !== 'idle') continue;
      agent.status = 'resting';
      world.putAgent(agent);
    }
  }

  private publishTreasury(): void {
    const world = this.world;
    const treasury = world.treasury();
    for (const milestone of treasury.milestones) {
      if (milestone.reachedAtTick === undefined || world.announcedMilestones.has(milestone.label)) continue;
      world.announcedMilestones.add(milestone.label);
      world.markMeta();
      world.bus.emit({ type: 'milestone.reached', label: milestone.label, cents: milestone.cents, tick: milestone.reachedAtTick });
      world.log('info', `Milestone reached: ${milestone.label} lifetime revenue`, this.hermesId);
      world.speak(this.hermesId, `${milestone.label}. Noted. Keep going.`, 10);
    }
    world.bus.emit({ type: 'treasury.updated', treasury });
  }

  // ---------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------

  command(cmd: StationCommand): CommandResult {
    const result = this.execute(cmd);
    if (result.ok) this.world.flush();
    return result;
  }

  private execute(cmd: StationCommand): CommandResult {
    const world = this.world;
    switch (cmd.type) {
      case 'approval.decide': {
        const decided = this.airlock.decide(cmd.approvalId, cmd.decision, cmd.note);
        return decided.ok ? { ok: true } : { ok: false, reason: decided.reason };
      }
      case 'approval.decide-all': {
        this.airlock.decideAll(cmd.decision, cmd.maxRisk);
        return { ok: true };
      }
      case 'venture.set-status': {
        const venture = world.ventures.get(cmd.ventureId);
        if (!venture) return { ok: false, reason: `Unknown venture ${cmd.ventureId}` };
        if (venture.status === 'killed') return { ok: false, reason: `${venture.name} is killed and cannot be revived` };
        setVentureStatus(world, venture, cmd.status, cmd.reason ?? 'set by operator', (task, reason) => this.work.cancel(task, reason));
        return { ok: true };
      }
      case 'venture.spawn': {
        const venture = spawnVenture(world, this.registry, { kind: cmd.kind, thesis: cmd.thesis, ...(cmd.name ? { name: cmd.name } : {}), reason: 'spawned by operator' });
        return venture ? { ok: true } : { ok: false, reason: `Venture cap of ${world.policy.maxVentures} reached` };
      }
      case 'overseer.instruct': {
        world.instructions.push(cmd.text.trim());
        world.markMeta();
        world.log('info', `Operator instruction for HERMES: ${cmd.text.trim()}`, this.hermesId);
        world.speak(this.hermesId, 'Noted. It will shape the next epoch.', 8);
        return { ok: true };
      }
      case 'agent.hire': {
        const venture = cmd.ventureId ? world.ventures.get(cmd.ventureId) : undefined;
        if (cmd.ventureId && !venture) return { ok: false, reason: `Unknown venture ${cmd.ventureId}` };
        const agent = hireAgent(world, cmd.role, venture, { force: true });
        return agent ? { ok: true } : { ok: false, reason: 'Cannot hire that role' };
      }
      case 'agent.dismiss': {
        const error = dismissAgent(world, cmd.agentId, (task, reason) => this.work.cancel(task, reason));
        return error ? { ok: false, reason: error } : { ok: true };
      }
      case 'clock.pause':
        world.clock.pause();
        this.emitClock();
        return { ok: true };
      case 'clock.resume':
        world.clock.resume();
        this.emitClock();
        return { ok: true };
      case 'clock.speed':
        world.clock.setSpeed(cmd.speed as Speed);
        this.emitClock();
        return { ok: true };
      case 'treasury.set-target':
        world.targetCents = cmd.targetCents;
        world.markMeta();
        world.bus.emit({ type: 'treasury.updated', treasury: world.treasury() });
        world.log('info', `Target set to ${formatCents(cmd.targetCents)}`);
        return { ok: true };
      case 'snapshot.request':
        return { ok: true };
    }
  }

  private emitClock(): void {
    const clock = this.world.clock.snapshot();
    this.world.bus.emit({ type: 'tick', tick: clock.tick, simTime: clock.simTime, paused: clock.paused, speed: clock.speed });
    this.world.markMeta();
  }

  /** Test helper: every agent currently stuck in 'assigned' without a walking agent behind it. */
  orphanedAssignments(): Task[] {
    const out: Task[] = [];
    for (const task of this.world.tasks.values()) {
      if (task.status !== 'assigned') continue;
      const agent: CrewAgent | undefined = task.assignedTo ? this.world.agents.get(task.assignedTo) : undefined;
      if (!agent || agent.currentTaskId !== task.id || !this.world.paths.has(agent.id)) out.push(task);
    }
    return out;
  }
}

/** Lets promise continuations from brains run before the tick continues. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
