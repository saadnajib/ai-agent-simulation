/**
 * Derives the tile grid, doors, workstations and idle spots from ROOM_LAYOUT
 * and provides BFS pathfinding over it.
 *
 * Rules (see docs/architecture/CONTRACTS.md):
 * - rooms are the ROOM_LAYOUT rects; the outer ring of each rect is 'wall';
 * - one 'door' tile on the wall facing the nearest corridor;
 * - interior is 'floor'; production rooms get 2..6 'workstation' tiles;
 * - the 2x2 centre of 'core' is 'core-eye', of 'reactor' is 'reactor-core';
 * - every hull tile (x in [1, width-2], y in [1, height-2]) not in a room is
 *   'corridor'; the hull border and outside is 'void'.
 */
import type { GridPosition, RoomId } from './types.js';
import { ROOM_IDS } from './types.js';
import {
  ROOM_LAYOUT,
  ROOM_SPECS,
  STATION_HEIGHT,
  STATION_WIDTH,
  type RoomGeometry,
  type RoomRect,
  type StationMap,
  type TileKind,
} from './stationMap.js';

const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['floor', 'corridor', 'door', 'workstation']);

type Side = 'south' | 'north' | 'west' | 'east';
/** Tie-break order when several sides are equally close to a corridor. */
const SIDE_ORDER: readonly Side[] = ['south', 'north', 'west', 'east'];

const WORKSTATIONS_PER_ROOM = 4;
const CORE_WORKSTATIONS = 2;

interface Interior {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function interiorOf(rect: RoomRect): Interior {
  return { x0: rect.x + 1, y0: rect.y + 1, x1: rect.x + rect.w - 2, y1: rect.y + rect.h - 2 };
}

function inRect(rect: RoomRect, p: GridPosition): boolean {
  return p.x >= rect.x && p.x < rect.x + rect.w && p.y >= rect.y && p.y < rect.y + rect.h;
}

function inHull(x: number, y: number): boolean {
  return x >= 1 && x <= STATION_WIDTH - 2 && y >= 1 && y <= STATION_HEIGHT - 2;
}

function roomIdAtRaw(p: GridPosition): RoomId | null {
  for (const id of ROOM_IDS) {
    if (inRect(ROOM_LAYOUT[id], p)) return id;
  }
  return null;
}

/** Base tiles before doors and workstations: void, corridor, wall, floor. */
function buildBaseTiles(): TileKind[][] {
  const tiles: TileKind[][] = [];
  for (let y = 0; y < STATION_HEIGHT; y++) {
    const row: TileKind[] = [];
    for (let x = 0; x < STATION_WIDTH; x++) {
      row.push(baseTile(x, y));
    }
    tiles.push(row);
  }
  return tiles;
}

function baseTile(x: number, y: number): TileKind {
  if (!inHull(x, y)) return 'void';
  const roomId = roomIdAtRaw({ x, y });
  if (roomId === null) return 'corridor';
  const rect = ROOM_LAYOUT[roomId];
  const inner = interiorOf(rect);
  const isInterior = x >= inner.x0 && x <= inner.x1 && y >= inner.y0 && y <= inner.y1;
  return isInterior ? 'floor' : 'wall';
}

/** Midpoint of the wall on a given side and the unit vector pointing outward. */
function sideAnchor(rect: RoomRect, side: Side): { door: GridPosition; out: GridPosition } {
  const midX = rect.x + Math.floor(rect.w / 2);
  const midY = rect.y + Math.floor(rect.h / 2);
  switch (side) {
    case 'south':
      return { door: { x: midX, y: rect.y + rect.h - 1 }, out: { x: 0, y: 1 } };
    case 'north':
      return { door: { x: midX, y: rect.y }, out: { x: 0, y: -1 } };
    case 'west':
      return { door: { x: rect.x, y: midY }, out: { x: -1, y: 0 } };
    case 'east':
      return { door: { x: rect.x + rect.w - 1, y: midY }, out: { x: 1, y: 0 } };
  }
}

/** Steps from the wall to the first corridor tile outward, or Infinity. */
function distanceToCorridor(tiles: TileKind[][], from: GridPosition, out: GridPosition): number {
  for (let step = 1; step < Math.max(STATION_WIDTH, STATION_HEIGHT); step++) {
    const x = from.x + out.x * step;
    const y = from.y + out.y * step;
    const tile = tiles[y]?.[x];
    if (tile === undefined || tile === 'void') return Number.POSITIVE_INFINITY;
    if (tile === 'corridor') return step;
  }
  return Number.POSITIVE_INFINITY;
}

/** Picks the door side: nearest corridor, then nearest to the station centre, then SIDE_ORDER. */
function chooseDoor(tiles: TileKind[][], rect: RoomRect): GridPosition {
  const centreX = (STATION_WIDTH - 1) / 2;
  const centreY = (STATION_HEIGHT - 1) / 2;
  let best: { door: GridPosition; dist: number; centre: number } | null = null;
  for (const side of SIDE_ORDER) {
    const { door, out } = sideAnchor(rect, side);
    const dist = distanceToCorridor(tiles, door, out);
    if (!Number.isFinite(dist)) continue;
    const outside = { x: door.x + out.x * dist, y: door.y + out.y * dist };
    const centre = Math.abs(outside.x - centreX) + Math.abs(outside.y - centreY);
    if (best === null || dist < best.dist || (dist === best.dist && centre < best.centre)) {
      best = { door, dist, centre };
    }
  }
  if (best === null) {
    throw new Error(`Room at (${rect.x},${rect.y}) has no side facing a corridor`);
  }
  return best.door;
}

/** Interior tile adjacent to the door, where idle crew wait. */
function idleSpotFor(rect: RoomRect, door: GridPosition): GridPosition {
  const inner = interiorOf(rect);
  const x = Math.min(Math.max(door.x, inner.x0), inner.x1);
  const y = Math.min(Math.max(door.y, inner.y0), inner.y1);
  return { x, y };
}

function centre2x2(rect: RoomRect): GridPosition[] {
  const inner = interiorOf(rect);
  const cx = Math.floor((inner.x0 + inner.x1) / 2);
  const cy = Math.floor((inner.y0 + inner.y1) / 2);
  return [
    { x: cx, y: cy },
    { x: cx + 1, y: cy },
    { x: cx, y: cy + 1 },
    { x: cx + 1, y: cy + 1 },
  ];
}

function workstationCount(id: RoomId): number {
  if (id === 'core') return CORE_WORKSTATIONS;
  const spec = ROOM_SPECS[id];
  return spec.roles.length > 0 ? WORKSTATIONS_PER_ROOM : 0;
}

/** Workstations sit one row inside the top wall, two tiles apart, clear of the door column. */
function workstationsFor(id: RoomId, rect: RoomRect, blocked: ReadonlySet<string>): GridPosition[] {
  const wanted = workstationCount(id);
  if (wanted === 0) return [];
  const inner = interiorOf(rect);
  const out: GridPosition[] = [];
  const y = inner.y0 + 1;
  for (let x = inner.x0 + 1; x < inner.x1 && out.length < wanted; x += 2) {
    if (blocked.has(key({ x, y }))) continue;
    out.push({ x, y });
  }
  if (out.length < 2) {
    throw new Error(`Room ${id} is too small for workstations`);
  }
  return out;
}

function key(p: GridPosition): string {
  return `${p.x},${p.y}`;
}

function setTile(tiles: TileKind[][], p: GridPosition, kind: TileKind): void {
  const row = tiles[p.y];
  if (row === undefined || p.x < 0 || p.x >= row.length) {
    throw new RangeError(`Tile (${p.x},${p.y}) is outside the station`);
  }
  row[p.x] = kind;
}

function buildRoom(tiles: TileKind[][], id: RoomId): RoomGeometry {
  const rect = ROOM_LAYOUT[id];
  const door = chooseDoor(tiles, rect);
  setTile(tiles, door, 'door');

  const decorative = id === 'core' || id === 'reactor' ? centre2x2(rect) : [];
  const decorativeKind: TileKind = id === 'core' ? 'core-eye' : 'reactor-core';
  for (const p of decorative) setTile(tiles, p, decorativeKind);

  const idleSpot = idleSpotFor(rect, door);
  const blocked = new Set<string>([key(idleSpot), ...decorative.map(key)]);
  const workstations = workstationsFor(id, rect, blocked);
  for (const p of workstations) setTile(tiles, p, 'workstation');

  return { id, ...rect, door, workstations, idleSpot };
}

function build(): StationMap {
  const tiles = buildBaseTiles();
  const rooms = {} as Record<RoomId, RoomGeometry>;
  for (const id of ROOM_IDS) {
    rooms[id] = buildRoom(tiles, id);
  }
  return { width: STATION_WIDTH, height: STATION_HEIGHT, tiles, rooms };
}

let memo: StationMap | null = null;

/** The station map, built once and shared. Treat the result as read-only. */
export function buildStationMap(): StationMap {
  if (memo === null) memo = build();
  return memo;
}

export function tileAt(map: StationMap, p: GridPosition): TileKind | undefined {
  return map.tiles[p.y]?.[p.x];
}

/** Room whose rect (walls included) contains the position. */
export function roomAt(map: StationMap, p: GridPosition): RoomId | null {
  for (const id of ROOM_IDS) {
    if (inRect(map.rooms[id], p)) return id;
  }
  return null;
}

export function isWalkable(map: StationMap, p: GridPosition): boolean {
  const tile = tileAt(map, p);
  return tile !== undefined && WALKABLE.has(tile);
}

const NEIGHBOURS: readonly GridPosition[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Shortest path by BFS over 4-connected walkable tiles. Returns [] when
 * unreachable or when from equals to. The result excludes `from` and ends
 * with `to`.
 */
export function findPath(map: StationMap, from: GridPosition, to: GridPosition): GridPosition[] {
  if (!isWalkable(map, from) || !isWalkable(map, to)) return [];
  if (from.x === to.x && from.y === to.y) return [];

  const width = map.width;
  const index = (p: GridPosition): number => p.y * width + p.x;
  const parent = new Int32Array(width * map.height).fill(-1);
  const start = index(from);
  const goal = index(to);
  parent[start] = start;

  const queue: number[] = [start];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++] as number;
    if (current === goal) break;
    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const d of NEIGHBOURS) {
      const next = { x: cx + d.x, y: cy + d.y };
      if (!isWalkable(map, next)) continue;
      const ni = index(next);
      if (parent[ni] !== -1) continue;
      parent[ni] = current;
      queue.push(ni);
    }
  }
  if (parent[goal] === -1) return [];

  const path: GridPosition[] = [];
  for (let node = goal; node !== start; node = parent[node] as number) {
    path.push({ x: node % width, y: Math.floor(node / width) });
  }
  return path.reverse();
}

/** Nearest free workstation in a room by path length, or null if none is reachable. */
export function nearestWorkstation(
  map: StationMap,
  roomId: RoomId,
  from: GridPosition,
  occupied: ReadonlySet<string> = new Set(),
): GridPosition | null {
  let best: { p: GridPosition; len: number } | null = null;
  for (const p of map.rooms[roomId].workstations) {
    if (occupied.has(key(p))) continue;
    const len = from.x === p.x && from.y === p.y ? 0 : findPath(map, from, p).length;
    if (len === 0 && (from.x !== p.x || from.y !== p.y)) continue;
    if (best === null || len < best.len) best = { p, len };
  }
  return best?.p ?? null;
}

/** Stable "x,y" key for positions, shared with the server's occupancy sets. */
export function positionKey(p: GridPosition): string {
  return key(p);
}
