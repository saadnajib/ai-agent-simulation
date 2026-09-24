/**
 * Task-to-agent assignment and physical movement. Agents walk one tile per
 * tick along a BFS path from core; working agents stand on a workstation (or
 * any free floor tile when the room is full); idle agents drift back to
 * quarters.
 */
import type { AgentRole, CrewAgent, GridPosition, RoomId, Task, Venture } from '@eternity/core';
import { ROOM_LAYOUT, findPath } from '@eternity/core';
import type { World } from './state.js';

const TERMINAL: ReadonlySet<Task['status']> = new Set(['done', 'failed', 'cancelled', 'rejected']);
/** Tiles an agent covers per tick (one tick is a simulated hour; crossing the station takes a few). */
export const TILES_PER_TICK = 6;
/** Roles that serve every venture and are never counted in a venture's crew. */
export const SHARED_ROLES: ReadonlySet<AgentRole> = new Set(['scout', 'marketer']);

export function isTerminal(task: Task): boolean {
  return TERMINAL.has(task.status);
}

export function samePos(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Tiles inside a room that agents may stand on. */
export function roomFloorTiles(world: World, roomId: RoomId): GridPosition[] {
  const rect = ROOM_LAYOUT[roomId];
  const tiles: GridPosition[] = [];
  for (let y = rect.y + 1; y < rect.y + rect.h - 1; y++) {
    for (let x = rect.x + 1; x < rect.x + rect.w - 1; x++) {
      const kind = world.map.tiles[y]?.[x];
      if (kind === 'floor' || kind === 'workstation') tiles.push({ x, y });
    }
  }
  return tiles;
}

/** Tiles currently occupied or reserved as a destination by any other agent. */
function reservedTiles(world: World, except: string): Set<string> {
  const set = new Set<string>();
  for (const agent of world.agents.values()) {
    if (agent.id === except || agent.status === 'offline') continue;
    const path = world.paths.get(agent.id);
    const target = path && path.length > 0 ? path[path.length - 1]! : agent.position;
    set.add(`${target.x},${target.y}`);
  }
  return set;
}

export function pickWorkTile(world: World, roomId: RoomId, agentId: string): GridPosition {
  const reserved = reservedTiles(world, agentId);
  const room = world.map.rooms[roomId];
  const free = (tiles: readonly GridPosition[]) => tiles.filter((t) => !reserved.has(`${t.x},${t.y}`));
  const stations = free(room.workstations);
  if (stations.length > 0) return stations[0]!;
  const floor = free(roomFloorTiles(world, roomId));
  if (floor.length > 0) return world.rng(`tile:${agentId}`).pick(floor);
  return room.idleSpot;
}

export function pickIdleTile(world: World, roomId: RoomId, agentId: string): GridPosition {
  const reserved = reservedTiles(world, agentId);
  const floor = roomFloorTiles(world, roomId).filter((t) => !reserved.has(`${t.x},${t.y}`));
  if (floor.length > 0) return world.rng(`idle:${agentId}`).pick(floor);
  return world.map.rooms[roomId].idleSpot;
}

/**
 * Starts the agent walking to a tile in a room. Returns true when the agent
 * is already there (no movement needed). Unreachable targets are logged and
 * the agent is placed directly so nothing gets stuck.
 */
export function sendAgentTo(world: World, agent: CrewAgent, roomId: RoomId, target: GridPosition): boolean {
  agent.roomId = roomId;
  if (samePos(agent.position, target)) {
    world.paths.delete(agent.id);
    return true;
  }
  const path = findPath(world.map, agent.position, target);
  if (path.length === 0) {
    world.log('warn', `${agent.name} could not path to ${roomId}; relocating directly`, agent.id);
    const from = agent.position;
    agent.position = target;
    world.paths.delete(agent.id);
    world.bus.emit({ type: 'agent.moved', agentId: agent.id, from, to: target, roomId });
    return true;
  }
  world.paths.set(agent.id, path);
  agent.status = 'walking';
  world.putAgent(agent);
  return false;
}

/** Advances every walking agent up to TILES_PER_TICK tiles, emitting one agent.moved per tile. */
export function moveAgents(world: World, onArrive: (agent: CrewAgent) => void): void {
  for (const agent of world.agents.values()) {
    const path = world.paths.get(agent.id);
    if (!path || path.length === 0) continue;
    for (let step = 0; step < TILES_PER_TICK && path.length > 0; step++) {
      const next = path.shift()!;
      const from = agent.position;
      agent.position = next;
      world.bus.emit({ type: 'agent.moved', agentId: agent.id, from, to: next, roomId: agent.roomId });
    }
    world.putAgent(agent, false);
    if (path.length === 0) {
      world.paths.delete(agent.id);
      onArrive(agent);
    }
  }
}

export function depsDone(world: World, task: Task): boolean {
  return task.dependsOn.every((id) => world.tasks.get(id)?.status === 'done');
}

export function depsBlocked(world: World, task: Task): Task | null {
  for (const id of task.dependsOn) {
    const dep = world.tasks.get(id);
    if (!dep || (isTerminal(dep) && dep.status !== 'done')) return dep ?? null;
  }
  return null;
}

/** Queued tasks whose dependencies are complete, highest priority first, oldest first. */
export function readyTasks(world: World): Task[] {
  const ready: Task[] = [];
  for (const task of world.tasks.values()) {
    if (task.status !== 'queued') continue;
    if (!depsDone(world, task)) continue;
    ready.push(task);
  }
  return ready.sort((a, b) => b.priority - a.priority || a.createdAtTick - b.createdAtTick || a.id.localeCompare(b.id));
}

export function crewOf(world: World, venture: Venture): CrewAgent[] {
  return venture.crew.map((id) => world.agents.get(id)).filter((a): a is CrewAgent => a !== undefined && a.status !== 'offline');
}

/** Idle, or walking home with nothing assigned: either can take work immediately. */
function isAvailable(agent: CrewAgent): boolean {
  if (agent.currentTaskId !== undefined) return false;
  return agent.status === 'idle' || agent.status === 'walking';
}

/** Idle agent that can take the task without hiring, if any. */
export function findIdleAgent(world: World, task: Task): CrewAgent | null {
  const candidates = [...world.agents.values()].filter((a) => a.role === task.role && isAvailable(a));
  if (candidates.length === 0) return null;
  if (SHARED_ROLES.has(task.role) || task.ventureId === undefined) return candidates[0]!;
  const own = candidates.find((a) => a.ventureId === task.ventureId);
  if (own) return own;
  const unattached = candidates.find((a) => a.ventureId === undefined);
  return unattached ?? null;
}

export interface DispatchHooks {
  /** Whether the venture may start another paid task right now. */
  canSpend(task: Task, venture: Venture | undefined): boolean;
  /** Hire a new crew member for the role, or null when the caps forbid it. */
  hire(role: AgentRole, venture: Venture | undefined): CrewAgent | null;
  /** Called once an agent has been chosen; the hook sends the agent to work. */
  assign(task: Task, agent: CrewAgent): void;
  /** Concurrency guard for brains. */
  hasCapacity(): boolean;
}

/** Assigns ready tasks to agents. Returns how many were assigned. */
export function dispatchTasks(world: World, hooks: DispatchHooks): number {
  let assigned = 0;
  for (const task of readyTasks(world)) {
    if (!hooks.hasCapacity()) break;
    const venture = world.venture(task.ventureId);
    if (venture && (venture.status === 'paused' || venture.status === 'killed')) continue;
    if (!hooks.canSpend(task, venture)) continue;
    const agent = findIdleAgent(world, task) ?? hooks.hire(task.role, venture);
    if (!agent) continue;
    if (venture && !SHARED_ROLES.has(task.role) && agent.ventureId !== venture.id) attachToVenture(world, agent, venture);
    hooks.assign(task, agent);
    assigned++;
  }
  return assigned;
}

export function attachToVenture(world: World, agent: CrewAgent, venture: Venture): void {
  if (agent.ventureId && agent.ventureId !== venture.id) {
    const previous = world.ventures.get(agent.ventureId);
    if (previous) {
      previous.crew = previous.crew.filter((id) => id !== agent.id);
      world.putVenture(previous);
    }
  }
  agent.ventureId = venture.id;
  if (!venture.crew.includes(agent.id)) {
    venture.crew.push(agent.id);
    world.putVenture(venture);
  }
  world.putAgent(agent);
}

/** Sends idle agents who are loitering in work rooms back to quarters. */
export function returnIdleToQuarters(world: World): void {
  for (const agent of world.agents.values()) {
    if (agent.role === 'overseer' || agent.status !== 'idle' || agent.currentTaskId !== undefined) continue;
    if (agent.roomId === 'quarters' || world.paths.has(agent.id)) continue;
    const tile = pickIdleTile(world, 'quarters', agent.id);
    sendAgentTo(world, agent, 'quarters', tile);
  }
}
