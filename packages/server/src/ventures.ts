/**
 * Venture lifecycle: spawn, production cycles, status changes, crew hiring
 * and budget-share normalisation. Task cancellation is injected so this
 * module does not depend on the work runner.
 */
import type { AgentRole, CrewAgent, OverseerAction, Storefront, Task, Venture, VentureKind, VentureMetrics, VentureStatus } from '@eternity/core';
import { PLAYBOOKS, computeVentureMetrics, instantiateCycle, playbookFor, ventureNameFor } from '@eternity/core';
import type { AdapterRegistry } from '@eternity/adapters';
import { SHARED_ROLES, crewOf, isTerminal, pickIdleTile, sendAgentTo } from './dispatch.js';
import { generateCrewName, ROLE_LABELS } from './names.js';
import type { World } from './state.js';

export type CancelTask = (task: Task, reason: string) => void;

export interface SpawnInput {
  kind: VentureKind;
  thesis: string;
  name?: string;
  status?: VentureStatus;
  reason?: string;
}

const SCALING_CYCLE_THRESHOLD = 3;
const HERMES_ROLE: AgentRole = 'overseer';

export function emptyMetrics(): VentureMetrics {
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

export function aliveVentures(world: World): Venture[] {
  return [...world.ventures.values()].filter((v) => v.status !== 'killed');
}

export function fundedVentures(world: World): Venture[] {
  return aliveVentures(world).filter((v) => v.status !== 'paused');
}

export function openTasks(world: World, ventureId: string): Task[] {
  return world.tasksOf(ventureId).filter((t) => !isTerminal(t));
}

function buildStorefront(world: World, registry: AdapterRegistry, venture: Venture): Storefront {
  const platform = world.mode === 'sim' ? (PLAYBOOKS[venture.kind].platforms[0] ?? 'mock') : registry.primaryPlatformFor(venture.kind);
  const capability = registry.get(platform).capability();
  return {
    id: world.id('shop'),
    ventureId: venture.id,
    platform,
    name: `${venture.name} on ${platform}`,
    connected: capability.connected && capability.can.createListing,
  };
}

/** Creates a venture with a storefront and its first production cycle. Returns null when maxVentures is reached. */
export function spawnVenture(world: World, registry: AdapterRegistry, input: SpawnInput): Venture | null {
  if (aliveVentures(world).length >= world.policy.maxVentures) return null;
  const playbook = playbookFor(input.kind);
  const taken = [...world.ventures.values()].map((v) => v.name);
  const venture: Venture = {
    id: world.id('ven'),
    kind: input.kind,
    name: input.name?.trim() || ventureNameFor(input.kind, world.rng('venture-name'), taken),
    thesis: input.thesis.trim(),
    roomId: playbook.roomId,
    status: input.status ?? 'incubating',
    createdAtTick: world.tick,
    budgetShare: 0,
    crew: [],
    storefronts: [],
    metrics: emptyMetrics(),
  };
  if (input.reason) venture.statusReason = input.reason;
  venture.storefronts.push(buildStorefront(world, registry, venture));
  world.putVenture(venture);
  admitShare(world, venture);
  startCycle(world, venture);
  world.log('info', `Venture ${venture.name} (${venture.kind}) opened in ${venture.roomId}: "${venture.thesis}"`);
  return venture;
}

/** Builds one production cycle from the playbook and enqueues it. */
export function startCycle(world: World, venture: Venture): Task[] {
  const playbook = playbookFor(venture.kind);
  const cycle = playbook.buildCycle(venture, world.tick, world.rng(`cycle:${venture.id}`));
  const tasks = instantiateCycle(cycle, world.tick, world.rng(`cycle-ids:${venture.id}`));
  for (const task of tasks) world.putTask(task);
  world.log('debug', `${venture.name}: new production cycle (${tasks.length} tasks)`);
  return tasks;
}

/** Keeps every funded venture busy: a new cycle when the previous one drains. */
export function ensureCycles(world: World): void {
  for (const venture of fundedVentures(world)) {
    const open = openTasks(world, venture.id).length;
    const threshold = venture.status === 'scaling' ? SCALING_CYCLE_THRESHOLD : 0;
    if (open <= threshold) startCycle(world, venture);
  }
}

/** Gives a new venture the exploration floor and scales the others down to keep the sum at one. */
function admitShare(world: World, venture: Venture): void {
  const others = fundedVentures(world).filter((v) => v.id !== venture.id);
  if (others.length === 0) {
    venture.budgetShare = 1;
    world.putVenture(venture);
    return;
  }
  const floor = Math.min(0.5, Math.max(world.policy.explorationFloor, 1 / (others.length + 1) / 2));
  venture.budgetShare = floor;
  const sum = others.reduce((acc, v) => acc + v.budgetShare, 0);
  for (const other of others) {
    other.budgetShare = sum > 0 ? (other.budgetShare / sum) * (1 - floor) : (1 - floor) / others.length;
    world.putVenture(other);
  }
  world.putVenture(venture);
}

/** Forces funded shares to sum to exactly one; killed and paused ventures hold zero. */
export function renormaliseShares(world: World): void {
  const funded = fundedVentures(world);
  for (const venture of world.ventures.values()) {
    if ((venture.status === 'killed' || venture.status === 'paused') && venture.budgetShare !== 0) {
      venture.budgetShare = 0;
      world.putVenture(venture);
    }
  }
  if (funded.length === 0) return;
  const sum = funded.reduce((acc, v) => acc + Math.max(0, v.budgetShare), 0);
  let running = 0;
  funded.forEach((venture, index) => {
    let share = sum > 0 ? Math.max(0, venture.budgetShare) / sum : 1 / funded.length;
    if (index === funded.length - 1) share = 1 - running;
    running += share;
    if (Math.abs(share - venture.budgetShare) > 1e-12) {
      venture.budgetShare = share;
      world.putVenture(venture);
    }
  });
}

export function setVentureStatus(world: World, venture: Venture, status: VentureStatus, reason: string, cancel: CancelTask): void {
  const previous = venture.status;
  venture.status = status;
  venture.statusReason = reason;
  if (status === 'killed') {
    venture.killedAtTick = world.tick;
    for (const task of openTasks(world, venture.id)) cancel(task, `venture killed: ${reason}`);
    for (const agent of crewOf(world, venture)) {
      delete agent.ventureId;
      world.putAgent(agent);
    }
    venture.crew = [];
    // Live listings stay up: killing stops the spending, not the long tail. Unfinished drafts are dropped.
    for (const listing of world.listingsOf(venture.id)) {
      if (listing.status === 'draft' || listing.status === 'awaiting-approval') {
        listing.status = 'delisted';
        world.putListing(listing);
      }
    }
  }
  world.putVenture(venture);
  renormaliseShares(world);
  world.log(status === 'killed' ? 'warn' : 'info', `${venture.name}: ${previous} -> ${status} (${reason})`);
}

export function refreshMetrics(world: World): void {
  const entries = world.ledger.all();
  const listings = [...world.listings.values()];
  for (const venture of world.ventures.values()) {
    // Killed ventures keep their final numbers; recomputing them every epoch is wasted work.
    if (venture.status === 'killed') continue;
    venture.metrics = computeVentureMetrics(venture, entries, listings, world.tick, world.policy.windowTicks);
    world.putVenture(venture);
  }
}

// ---------------------------------------------------------------------------
// Crew
// ---------------------------------------------------------------------------

function activeAgents(world: World): CrewAgent[] {
  return [...world.agents.values()].filter((a) => a.status !== 'offline');
}

function sharedRoleCap(world: World, role: AgentRole): number {
  const ventures = aliveVentures(world).length;
  if (role === 'scout') return 2 + Math.floor(ventures / 3);
  if (role === 'marketer') return 1 + Math.floor(ventures / 4);
  return Number.POSITIVE_INFINITY;
}

export function canHire(world: World, role: AgentRole, venture: Venture | undefined): string | null {
  if (role === HERMES_ROLE) return 'There is only one Overseer';
  if (activeAgents(world).length >= world.config.maxCrew) return `Crew cap of ${world.config.maxCrew} reached`;
  if (SHARED_ROLES.has(role)) {
    const count = activeAgents(world).filter((a) => a.role === role).length;
    return count >= sharedRoleCap(world, role) ? `Enough ${ROLE_LABELS[role]}s for the current ventures` : null;
  }
  if (venture) {
    const crew = crewOf(world, venture);
    if (crew.length >= world.policy.maxCrewPerVenture) return `${venture.name} is at its crew cap of ${world.policy.maxCrewPerVenture}`;
    // Keep a seat for every playbook role the venture still lacks, so one role cannot crowd the rest out.
    const present = new Set(crew.map((a) => a.role));
    const missing = playbookFor(venture.kind).roles.filter((r) => !SHARED_ROLES.has(r) && r !== role && !present.has(r)).length;
    if (crew.length + 1 + missing > world.policy.maxCrewPerVenture) {
      return `${venture.name} must keep seats for its other roles before adding another ${ROLE_LABELS[role]}`;
    }
  }
  return null;
}

export function hireAgent(world: World, role: AgentRole, venture: Venture | undefined, opts: { force?: boolean } = {}): CrewAgent | null {
  if (!opts.force) {
    const blocked = canHire(world, role, venture);
    if (blocked) return null;
  } else if (role === HERMES_ROLE) {
    return null;
  }
  const taken = new Set([...world.agents.values()].map((a) => a.name));
  const id = world.id('agent');
  const agent: CrewAgent = {
    id,
    name: generateCrewName(world.rng(`name:${id}`), taken),
    role,
    roomId: 'quarters',
    status: 'idle',
    position: world.map.rooms.quarters.idleSpot,
    brain: world.mode === 'sim' ? 'scripted' : world.config.workerModel,
    stats: { tasksCompleted: 0, tasksFailed: 0, tokensIn: 0, tokensOut: 0, costCents: 0, revenueAttributedCents: 0 },
    hiredAtTick: world.tick,
  };
  agent.position = pickIdleTile(world, 'quarters', id);
  world.putAgent(agent);
  if (venture && !SHARED_ROLES.has(role)) {
    agent.ventureId = venture.id;
    venture.crew.push(agent.id);
    world.putVenture(venture);
    world.putAgent(agent);
  }
  const attached = venture && !SHARED_ROLES.has(role);
  world.log('info', `Hired ${agent.name} as ${ROLE_LABELS[role]}${attached ? ` for ${venture.name}` : ''}`, agent.id);
  world.speak(agent.id, 'Reporting for duty.', 4);
  return agent;
}

export function dismissAgent(world: World, agentId: string, cancel: CancelTask): string | null {
  const agent = world.agents.get(agentId);
  if (!agent) return `Unknown agent ${agentId}`;
  if (agent.role === HERMES_ROLE) return 'The Overseer cannot be dismissed';
  if (agent.status === 'offline') return `${agent.name} is already dismissed`;
  const task = agent.currentTaskId ? world.tasks.get(agent.currentTaskId) : undefined;
  if (task && !isTerminal(task)) cancel(task, `${agent.name} dismissed`);
  const venture = world.venture(agent.ventureId);
  if (venture) {
    venture.crew = venture.crew.filter((id) => id !== agent.id);
    world.putVenture(venture);
  }
  delete agent.ventureId;
  delete agent.currentTaskId;
  agent.status = 'offline';
  agent.speech = 'Signing off.';
  world.paths.delete(agent.id);
  world.putAgent(agent);
  world.log('info', `${agent.name} dismissed`, agent.id);
  return null;
}

export function assignAgent(world: World, agentId: string, ventureId: string, cancel: CancelTask): string | null {
  const agent = world.agents.get(agentId);
  const venture = world.ventures.get(ventureId);
  if (!agent || agent.status === 'offline') return `Unknown agent ${agentId}`;
  if (!venture || venture.status === 'killed') return `Unknown or killed venture ${ventureId}`;
  if (agent.role === HERMES_ROLE) return 'The Overseer stays in the core';
  if (crewOf(world, venture).length >= world.policy.maxCrewPerVenture && !venture.crew.includes(agent.id)) {
    return `${venture.name} is at its crew cap`;
  }
  const task = agent.currentTaskId ? world.tasks.get(agent.currentTaskId) : undefined;
  if (task && !isTerminal(task)) cancel(task, `${agent.name} reassigned to ${venture.name}`);
  const previous = world.venture(agent.ventureId);
  if (previous && previous.id !== venture.id) {
    previous.crew = previous.crew.filter((id) => id !== agent.id);
    world.putVenture(previous);
  }
  agent.ventureId = venture.id;
  if (!venture.crew.includes(agent.id)) venture.crew.push(agent.id);
  world.putVenture(venture);
  world.putAgent(agent);
  if (agent.status === 'idle') sendAgentTo(world, agent, venture.roomId, pickIdleTile(world, venture.roomId, agent.id));
  return null;
}

/** Applies one Overseer action. Returns a short description, or null when the action was dropped. */
export function applyOverseerAction(world: World, registry: AdapterRegistry, action: OverseerAction, cancel: CancelTask): string | null {
  switch (action.type) {
    case 'set-budget-share': {
      const venture = world.ventures.get(action.ventureId);
      if (!venture || venture.status === 'killed') return null;
      venture.budgetShare = Math.min(1, Math.max(0, action.share));
      world.putVenture(venture);
      return `${venture.name} share ${(venture.budgetShare * 100).toFixed(0)}%`;
    }
    case 'set-status': {
      const venture = world.ventures.get(action.ventureId);
      if (!venture || venture.status === action.status) return null;
      setVentureStatus(world, venture, action.status, action.reason, cancel);
      return `${venture.name} -> ${action.status}`;
    }
    case 'spawn-venture': {
      const venture = spawnVenture(world, registry, { kind: action.kind, thesis: action.thesis, name: action.name, reason: 'spawned by HERMES' });
      return venture ? `spawned ${venture.name}` : null;
    }
    case 'assign-agent': {
      const error = assignAgent(world, action.agentId, action.ventureId, cancel);
      return error ? null : `assigned ${world.agents.get(action.agentId)?.name ?? action.agentId}`;
    }
    case 'enqueue-task': {
      const venture = world.venture(action.task.ventureId);
      if (action.task.ventureId && !venture) return null;
      const task: Task = { ...action.task, id: world.id('task'), status: 'queued', attempts: 0, costCents: 0, createdAtTick: world.tick };
      delete task.assignedTo;
      world.putTask(task);
      return `enqueued ${task.kind}`;
    }
    case 'hire': {
      const venture = world.venture(action.ventureId);
      const agent = hireAgent(world, action.role, venture);
      return agent ? `hired ${agent.name}` : null;
    }
    case 'broadcast':
      world.log('info', `HERMES: ${action.message}`);
      return 'broadcast';
  }
}
