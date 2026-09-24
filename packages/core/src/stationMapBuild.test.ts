import { describe, expect, it } from 'vitest';
import { ROOM_IDS } from './types.js';
import { ROOM_LAYOUT, ROOM_SPECS, STATION_HEIGHT, STATION_WIDTH } from './stationMap.js';
import { buildStationMap, findPath, isWalkable, nearestWorkstation, roomAt, tileAt } from './stationMapBuild.js';

const map = buildStationMap();

describe('buildStationMap', () => {
  it('is memoised and has the contract dimensions', () => {
    expect(buildStationMap()).toBe(map);
    expect(map.width).toBe(STATION_WIDTH);
    expect(map.height).toBe(STATION_HEIGHT);
    expect(map.tiles).toHaveLength(STATION_HEIGHT);
    for (const row of map.tiles) expect(row).toHaveLength(STATION_WIDTH);
  });

  it('marks the hull border as void and the space between rooms as corridor', () => {
    expect(tileAt(map, { x: 0, y: 0 })).toBe('void');
    expect(tileAt(map, { x: STATION_WIDTH - 1, y: 10 })).toBe('void');
    expect(tileAt(map, { x: 1, y: 1 })).toBe('corridor');
    expect(tileAt(map, { x: 14, y: 5 })).toBe('corridor');
    expect(tileAt(map, { x: 28, y: 12 })).toBe('corridor');
  });

  it('gives every room walls, exactly one door on its wall, and a floor interior', () => {
    for (const id of ROOM_IDS) {
      const rect = ROOM_LAYOUT[id];
      const room = map.rooms[id];
      let doors = 0;
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) {
          const tile = tileAt(map, { x, y });
          const onRing = x === rect.x || y === rect.y || x === rect.x + rect.w - 1 || y === rect.y + rect.h - 1;
          if (onRing) {
            expect(['wall', 'door']).toContain(tile);
            if (tile === 'door') doors++;
          } else {
            expect(['floor', 'workstation', 'core-eye', 'reactor-core']).toContain(tile);
          }
        }
      }
      expect(doors).toBe(1);
      expect(tileAt(map, room.door)).toBe('door');
      expect(roomAt(map, room.door)).toBe(id);
      expect(isWalkable(map, room.idleSpot)).toBe(true);
    }
  });

  it('places 2..6 workstations in every production room and none are walls', () => {
    for (const id of ROOM_IDS) {
      const room = map.rooms[id];
      if (ROOM_SPECS[id].ventureKind !== undefined) {
        expect(room.workstations.length).toBeGreaterThanOrEqual(2);
        expect(room.workstations.length).toBeLessThanOrEqual(6);
      }
      for (const ws of room.workstations) {
        expect(tileAt(map, ws)).toBe('workstation');
        expect(roomAt(map, ws)).toBe(id);
      }
    }
  });

  it('puts a 2x2 eye in the core and a 2x2 core in the reactor', () => {
    const count = (kind: string): number => map.tiles.flat().filter((t) => t === kind).length;
    expect(count('core-eye')).toBe(4);
    expect(count('reactor-core')).toBe(4);
    expect(isWalkable(map, { x: 27, y: 17 })).toBe(false);
  });

  it('roomAt returns null in corridors and outside the map', () => {
    expect(roomAt(map, { x: 14, y: 5 })).toBeNull();
    expect(roomAt(map, { x: -1, y: -1 })).toBeNull();
  });
});

describe('findPath', () => {
  it('reaches every room door from every other room door', () => {
    for (const a of ROOM_IDS) {
      for (const b of ROOM_IDS) {
        if (a === b) continue;
        const path = findPath(map, map.rooms[a].door, map.rooms[b].door);
        expect(path.length, `${a} -> ${b}`).toBeGreaterThan(0);
        const last = path[path.length - 1];
        expect(last).toEqual(map.rooms[b].door);
        expect(path).not.toContainEqual(map.rooms[a].door);
      }
    }
  });

  it('only steps between 4-adjacent walkable tiles', () => {
    const path = findPath(map, map.rooms.observatory.door, map.rooms['broadcast-tower'].workstations[0]!);
    let prev = map.rooms.observatory.door;
    for (const p of path) {
      expect(Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y)).toBe(1);
      expect(isWalkable(map, p)).toBe(true);
      prev = p;
    }
  });

  it('returns [] for unreachable, non-walkable or identical endpoints', () => {
    const door = map.rooms.core.door;
    expect(findPath(map, door, door)).toEqual([]);
    expect(findPath(map, door, { x: 0, y: 0 })).toEqual([]);
    expect(findPath(map, { x: 27, y: 17 }, door)).toEqual([]);
  });

  it('finds the nearest free workstation', () => {
    const from = map.rooms['print-foundry'].door;
    const first = nearestWorkstation(map, 'print-foundry', from);
    expect(first).not.toBeNull();
    const occupied = new Set(map.rooms['print-foundry'].workstations.map((p) => `${p.x},${p.y}`));
    expect(nearestWorkstation(map, 'print-foundry', from, occupied)).toBeNull();
  });
});
