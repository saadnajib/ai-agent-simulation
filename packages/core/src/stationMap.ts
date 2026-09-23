/**
 * Station geometry shared by server (agent positions, pathing) and client
 * (rendering). The layout constants below are the contract; the tile grid,
 * pathfinding and workstation placement are derived from them in
 * `stationMapBuild.ts` (implemented by the core builder).
 *
 * Grid: 56 x 36 tiles. Origin top-left. One tile = one agent footprint.
 */
import type { GridPosition, RoomId, RoomSpec } from './types.js';

export type TileKind =
  | 'void' // space, not walkable
  | 'wall'
  | 'floor' // room interior
  | 'corridor'
  | 'door'
  | 'workstation' // walkable; agents stand here while working
  | 'core-eye' // decorative, not walkable
  | 'reactor-core'; // decorative, not walkable

export interface RoomRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoomGeometry extends RoomRect {
  id: RoomId;
  /** Tile just inside the room used as the entry point from the corridor. */
  door: GridPosition;
  /** Tiles where agents stand when working in this room. */
  workstations: GridPosition[];
  /** Tile agents wait on when idle in this room. */
  idleSpot: GridPosition;
}

export interface StationMap {
  width: number;
  height: number;
  tiles: TileKind[][]; // tiles[y][x]
  rooms: Record<RoomId, RoomGeometry>;
}

export const STATION_WIDTH = 56;
export const STATION_HEIGHT = 36;

/** Outer rectangles (including walls). Corridors are every non-room tile inside the hull. */
export const ROOM_LAYOUT: Record<RoomId, RoomRect> = {
  observatory: { x: 2, y: 2, w: 12, h: 9 },
  'print-foundry': { x: 16, y: 2, w: 12, h: 9 },
  'pixel-forge': { x: 30, y: 2, w: 12, h: 9 },
  'thumbnail-bay': { x: 44, y: 2, w: 10, h: 9 },

  airlock: { x: 2, y: 13, w: 10, h: 10 },
  quarters: { x: 14, y: 13, w: 8, h: 10 },
  core: { x: 24, y: 14, w: 8, h: 8 },
  reactor: { x: 44, y: 13, w: 10, h: 10 },

  scriptorium: { x: 2, y: 25, w: 12, h: 9 },
  'prototype-lab': { x: 16, y: 25, w: 12, h: 9 },
  'sound-deck': { x: 30, y: 25, w: 12, h: 9 },
  'broadcast-tower': { x: 44, y: 25, w: 10, h: 9 },
};

export const ROOM_SPECS: Record<RoomId, RoomSpec> = {
  core: {
    id: 'core',
    name: 'Overseer Core',
    purpose: 'HERMES allocates budget, kills losers, scales winners.',
    roles: ['overseer'],
  },
  airlock: {
    id: 'airlock',
    name: 'Airlock',
    purpose: 'Human approval queue. Money, accounts and publishing stop here.',
    roles: [],
  },
  reactor: {
    id: 'reactor',
    name: 'Reactor',
    purpose: 'Treasury and token budget. Revenue is power.',
    roles: [],
  },
  quarters: {
    id: 'quarters',
    name: 'Crew Quarters',
    purpose: 'Idle and resting crew.',
    roles: [],
  },
  observatory: {
    id: 'observatory',
    name: 'Observatory',
    purpose: 'Niche research, keyword demand, competitor scans.',
    roles: ['scout'],
  },
  'print-foundry': {
    id: 'print-foundry',
    name: 'Print Foundry',
    purpose: 'Print-on-demand designs and Etsy listings.',
    ventureKind: 'pod-store',
    roles: ['designer', 'writer', 'reviewer'],
  },
  'pixel-forge': {
    id: 'pixel-forge',
    name: 'Pixel Forge',
    purpose: '2D game asset packs for itch.io and Gumroad.',
    ventureKind: 'game-assets',
    roles: ['pixel-artist', 'reviewer'],
  },
  'thumbnail-bay': {
    id: 'thumbnail-bay',
    name: 'Thumbnail Bay',
    purpose: 'Paid thumbnail gigs and creative micro-services.',
    ventureKind: 'thumbnail-service',
    roles: ['thumbnail-artist', 'reviewer'],
  },
  scriptorium: {
    id: 'scriptorium',
    name: 'Scriptorium',
    purpose: 'SEO articles monetised with affiliate links.',
    ventureKind: 'affiliate-blog',
    roles: ['writer', 'reviewer'],
  },
  'prototype-lab': {
    id: 'prototype-lab',
    name: 'Prototype Lab',
    purpose: 'Software templates and micro-tools.',
    ventureKind: 'software-templates',
    roles: ['engineer', 'reviewer'],
  },
  'sound-deck': {
    id: 'sound-deck',
    name: 'Sound Deck',
    purpose: 'Loops, SFX and stock music packs.',
    ventureKind: 'music-packs',
    roles: ['composer', 'reviewer'],
  },
  'broadcast-tower': {
    id: 'broadcast-tower',
    name: 'Broadcast Tower',
    purpose: 'Distribution: Pinterest, social, SEO, listing optimisation.',
    roles: ['marketer'],
  },
};
