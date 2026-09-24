/**
 * Static station map rendered once per zoom level into an offscreen canvas,
 * plus the per-frame room overlays (venture status borders, hover, selection)
 * that sit on top of it. No image assets: every tile is drawn procedurally.
 */
import { ROOM_IDS, ROOM_SPECS, type RoomId, type StationMap, type TileKind, type VentureStatus } from '@eternity/core';
import type { Camera } from './camera.js';

export interface RoomTint {
  floor: string;
  floorAlt: string;
  glow: string;
  label: string;
}

/** Floor tint per room; walls and corridors share one steel palette. */
export const ROOM_TINTS: Record<RoomId, RoomTint> = {
  core: { floor: '#2a1218', floorAlt: '#301419', glow: 'rgba(255,60,70,0.35)', label: '#ff8a93' },
  airlock: { floor: '#2b2410', floorAlt: '#312912', glow: 'rgba(255,176,46,0.3)', label: '#ffd27a' },
  reactor: { floor: '#0f2a2c', floorAlt: '#123032', glow: 'rgba(79,209,255,0.3)', label: '#7fe7ff' },
  quarters: { floor: '#1c1f2a', floorAlt: '#20232f', glow: 'rgba(160,170,200,0.2)', label: '#b6bfd6' },
  observatory: { floor: '#161c33', floorAlt: '#192039', glow: 'rgba(120,140,255,0.3)', label: '#a9b8ff' },
  'print-foundry': { floor: '#2a1a2c', floorAlt: '#301d32', glow: 'rgba(255,120,220,0.3)', label: '#ff9ce6' },
  'pixel-forge': { floor: '#132a1c', floorAlt: '#153020', glow: 'rgba(92,255,157,0.3)', label: '#8dffb9' },
  'thumbnail-bay': { floor: '#2b1c12', floorAlt: '#312015', glow: 'rgba(255,140,60,0.3)', label: '#ffb27a' },
  scriptorium: { floor: '#24211a', floorAlt: '#29251d', glow: 'rgba(230,200,120,0.3)', label: '#e9d59a' },
  'prototype-lab': { floor: '#121f2c', floorAlt: '#152432', glow: 'rgba(80,200,255,0.3)', label: '#8ed8ff' },
  'sound-deck': { floor: '#1f1530', floorAlt: '#241837', glow: 'rgba(180,140,255,0.3)', label: '#c9b0ff' },
  'broadcast-tower': { floor: '#101f26', floorAlt: '#13252c', glow: 'rgba(100,220,220,0.3)', label: '#8ff0e6' },
};

const STEEL = {
  corridor: '#232833',
  corridorLine: '#1a1e27',
  corridorRivet: '#2f3644',
  wall: '#3d4456',
  wallLit: '#6f7a94',
  wallDark: '#262b38',
  wallStrip: 'rgba(79,209,255,0.35)',
  hull: '#59627a',
  door: '#8fa6c2',
  doorGlow: 'rgba(143,166,194,0.45)',
};

const STATUS_BORDER: Partial<Record<VentureStatus, string>> = {
  scaling: 'rgba(255,204,77,0.75)',
  paused: 'rgba(255,176,46,0.5)',
  incubating: 'rgba(180,140,255,0.4)',
};

/** Deterministic pseudo-random in [0,1) from tile coords, for rivets and floor noise. */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function roomOfTile(map: StationMap, x: number, y: number): RoomId | null {
  for (const id of ROOM_IDS) {
    const r = map.rooms[id];
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return id;
  }
  return null;
}

export class MapLayer {
  private canvas: HTMLCanvasElement | null = null;
  private renderedScale = 0;
  private readonly roomByTile: (RoomId | null)[];

  constructor(private readonly map: StationMap) {
    this.roomByTile = new Array<RoomId | null>(map.width * map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) this.roomByTile[y * map.width + x] = roomOfTile(map, x, y);
    }
  }

  roomAt(x: number, y: number): RoomId | null {
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return null;
    return this.roomByTile[y * this.map.width + x] ?? null;
  }

  /** Returns the cached canvas for `scale` pixels per tile, re-rendering when it changes. */
  ensure(scale: number): HTMLCanvasElement {
    const rounded = Math.max(4, Math.round(scale * 4) / 4);
    if (this.canvas === null || this.renderedScale !== rounded) {
      this.canvas = this.render(rounded);
      this.renderedScale = rounded;
    }
    return this.canvas;
  }

  get scale(): number {
    return this.renderedScale;
  }

  private render(s: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(this.map.width * s);
    canvas.height = Math.ceil(this.map.height * s);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('2D canvas context unavailable');
    ctx.imageSmoothingEnabled = false;

    for (let y = 0; y < this.map.height; y++) {
      const row = this.map.tiles[y];
      if (row === undefined) continue;
      for (let x = 0; x < this.map.width; x++) {
        const kind = row[x];
        if (kind === undefined || kind === 'void') continue;
        this.drawTile(ctx, kind, x, y, s);
      }
    }
    this.drawHullRim(ctx, s);
    this.drawSignage(ctx, s);
    return canvas;
  }

  private tile(x: number, y: number): TileKind | undefined {
    return this.map.tiles[y]?.[x];
  }

  private drawTile(ctx: CanvasRenderingContext2D, kind: TileKind, x: number, y: number, s: number): void {
    const px = x * s;
    const py = y * s;
    switch (kind) {
      case 'corridor':
        this.drawCorridor(ctx, x, y, px, py, s);
        break;
      case 'floor':
      case 'workstation':
        this.drawFloor(ctx, x, y, px, py, s);
        if (kind === 'workstation') this.drawConsole(ctx, x, y, px, py, s);
        break;
      case 'wall':
        this.drawWall(ctx, x, y, px, py, s);
        break;
      case 'door':
        this.drawDoor(ctx, x, y, px, py, s);
        break;
      case 'core-eye':
        this.drawFloor(ctx, x, y, px, py, s);
        ctx.fillStyle = '#160609';
        ctx.fillRect(px, py, s, s);
        break;
      case 'reactor-core':
        this.drawFloor(ctx, x, y, px, py, s);
        ctx.fillStyle = '#061a1f';
        ctx.fillRect(px, py, s, s);
        break;
      case 'void':
        break;
    }
  }

  private drawCorridor(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    ctx.fillStyle = STEEL.corridor;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = STEEL.corridorLine;
    ctx.fillRect(px, py + s - 1, s, 1);
    ctx.fillRect(px + s - 1, py, 1, s);
    if (hash2(x, y) < 0.18) {
      ctx.fillStyle = STEEL.corridorRivet;
      const r = Math.max(1, Math.floor(s / 8));
      ctx.fillRect(px + Math.floor(s * 0.3), py + Math.floor(s * 0.3), r, r);
      ctx.fillRect(px + Math.floor(s * 0.65), py + Math.floor(s * 0.65), r, r);
    }
  }

  private drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    const room = this.roomAt(x, y);
    const tint = room === null ? ROOM_TINTS.quarters : ROOM_TINTS[room];
    ctx.fillStyle = (x + y) % 2 === 0 ? tint.floor : tint.floorAlt;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(px, py + s - 1, s, 1);
    ctx.fillRect(px + s - 1, py, 1, s);
    if (hash2(x * 3, y * 7) < 0.08) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(px + 1, py + 1, s - 2, 1);
    }
  }

  private drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    ctx.fillStyle = STEEL.wall;
    ctx.fillRect(px, py, s, s);
    const edge = Math.max(1, Math.round(s / 8));
    const below = this.tile(x, y + 1);
    const above = this.tile(x, y - 1);
    const left = this.tile(x - 1, y);
    const right = this.tile(x + 1, y);
    const isInterior = (k: TileKind | undefined): boolean =>
      k === 'floor' || k === 'workstation' || k === 'core-eye' || k === 'reactor-core';
    // Lit edge on the side that faces the room interior; dark edge opposite.
    ctx.fillStyle = STEEL.wallLit;
    if (isInterior(below)) ctx.fillRect(px, py + s - edge, s, edge);
    if (isInterior(above)) ctx.fillRect(px, py, s, edge);
    if (isInterior(right)) ctx.fillRect(px + s - edge, py, edge, s);
    if (isInterior(left)) ctx.fillRect(px, py, edge, s);
    ctx.fillStyle = STEEL.wallDark;
    if (below === 'corridor' || below === 'void') ctx.fillRect(px, py + s - 1, s, 1);
    if (right === 'corridor' || right === 'void') ctx.fillRect(px + s - 1, py, 1, s);
    // Thin light strip along horizontal walls facing corridors.
    if (below === 'corridor' || above === 'corridor') {
      ctx.fillStyle = STEEL.wallStrip;
      ctx.fillRect(px + 1, py + Math.floor(s / 2), s - 2, 1);
    }
  }

  private drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    const horizontal = this.tile(x - 1, y) === 'wall' && this.tile(x + 1, y) === 'wall';
    ctx.fillStyle = STEEL.corridor;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = STEEL.door;
    const inset = Math.max(1, Math.round(s / 6));
    if (horizontal) {
      ctx.fillRect(px, py + inset, inset, s - inset * 2);
      ctx.fillRect(px + s - inset, py + inset, inset, s - inset * 2);
    } else {
      ctx.fillRect(px + inset, py, s - inset * 2, inset);
      ctx.fillRect(px + inset, py + s - inset, s - inset * 2, inset);
    }
    ctx.fillStyle = STEEL.doorGlow;
    ctx.fillRect(px + inset, py + inset, s - inset * 2, s - inset * 2);
  }

  private drawConsole(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    const room = this.roomAt(x, y);
    const glow = room === null ? '#4fd1ff' : ROOM_TINTS[room].label;
    const w = Math.max(4, Math.round(s * 0.6));
    const h = Math.max(3, Math.round(s * 0.42));
    const ox = px + Math.round((s - w) / 2);
    const oy = py + Math.max(1, Math.round(s * 0.1));
    ctx.fillStyle = '#0b0e15';
    ctx.fillRect(ox, oy, w, h);
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(ox + 1, oy + 1, w - 2, Math.max(1, h - 2));
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e9f6ff';
    ctx.fillRect(ox + 2, oy + 2, Math.max(1, Math.round(w * 0.4)), 1);
    // Keyboard strip below the screen.
    ctx.fillStyle = '#1a2030';
    ctx.fillRect(ox, oy + h + 1, w, Math.max(1, Math.round(s * 0.12)));
  }

  /** Bright rim where hull corridors meet space. */
  private drawHullRim(ctx: CanvasRenderingContext2D, s: number): void {
    ctx.fillStyle = STEEL.hull;
    const edge = Math.max(1, Math.round(s / 6));
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (this.tile(x, y) !== 'void') continue;
        const px = x * s;
        const py = y * s;
        if (this.tile(x + 1, y) === 'corridor') ctx.fillRect(px + s - edge, py, edge, s);
        if (this.tile(x - 1, y) === 'corridor') ctx.fillRect(px, py, edge, s);
        if (this.tile(x, y + 1) === 'corridor') ctx.fillRect(px, py + s - edge, s, edge);
        if (this.tile(x, y - 1) === 'corridor') ctx.fillRect(px, py, s, edge);
      }
    }
  }

  private drawSignage(ctx: CanvasRenderingContext2D, s: number): void {
    const fontPx = Math.min(20, Math.max(8, Math.round(s * 0.55)));
    ctx.font = `700 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const id of ROOM_IDS) {
      const r = this.map.rooms[id];
      const name = ROOM_SPECS[id].name.toUpperCase();
      // Signage sits in the corridor row above the room so bubbles near the top wall do not cover it.
      const cx = (r.x + r.w / 2) * s;
      const cy = (r.y - 0.5) * s;
      const width = ctx.measureText(name).width + fontPx;
      ctx.fillStyle = 'rgba(8,10,16,0.85)';
      ctx.fillRect(cx - width / 2, cy - fontPx * 0.75, width, fontPx * 1.5);
      ctx.fillStyle = ROOM_TINTS[id].label;
      ctx.fillText(name, cx, cy + 1);
    }
  }
}

export interface RoomOverlayState {
  status: VentureStatus | null;
  hovered: boolean;
  selected: boolean;
}

/** Per-frame room decorations: gold border for scaling, dim for killed, hover/selection frames. */
export function drawRoomOverlays(
  ctx: CanvasRenderingContext2D,
  map: StationMap,
  cam: Camera,
  states: Readonly<Record<RoomId, RoomOverlayState>>,
  nowMs: number,
): void {
  const t = cam.tilePx();
  for (const id of ROOM_IDS) {
    const r = map.rooms[id];
    const st = states[id];
    const x = cam.tileScreenX(r.x);
    const y = cam.tileScreenY(r.y);
    const w = r.w * t;
    const h = r.h * t;
    if (st.status === 'killed') {
      ctx.fillStyle = 'rgba(4,5,9,0.62)';
      ctx.fillRect(x, y, w, h);
    }
    const border = st.status === null ? undefined : STATUS_BORDER[st.status];
    if (border !== undefined) {
      const pulse = st.status === 'scaling' ? 0.7 + 0.3 * Math.sin(nowMs / 600) : 1;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = border;
      ctx.lineWidth = Math.max(1.5, t * 0.12);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.restore();
    }
    if (st.selected) {
      ctx.strokeStyle = 'rgba(79,209,255,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    } else if (st.hovered) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(219,228,243,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
}

interface Star {
  x: number;
  y: number;
  size: number;
  alpha: number;
  phase: number;
}

/** Slow-parallax starfield drawn behind the hull each frame. */
export class Starfield {
  private readonly stars: Star[] = [];

  constructor(count = 260, seed = 7) {
    let s = seed;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const size = rnd() < 0.12 ? 2 : 1;
      this.stars.push({ x: rnd(), y: rnd(), size, alpha: 0.25 + rnd() * 0.7, phase: rnd() * Math.PI * 2 });
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, nowMs: number): void {
    const gradient = ctx.createRadialGradient(w * 0.55, h * 0.5, 10, w * 0.55, h * 0.5, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, '#0d1120');
    gradient.addColorStop(1, '#05070c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    const span = Math.max(w, h) * 1.5;
    const ox = (camX * 0.05) % span;
    const oy = (camY * 0.05) % span;
    for (const star of this.stars) {
      const x = (((star.x * span + ox) % span) + span) % span - (span - w) / 2;
      const y = (((star.y * span + oy) % span) + span) % span - (span - h) / 2;
      if (x < 0 || y < 0 || x > w || y > h) continue;
      const tw = 0.75 + 0.25 * Math.sin(nowMs / 900 + star.phase);
      ctx.fillStyle = `rgba(200,215,255,${(star.alpha * tw).toFixed(3)})`;
      ctx.fillRect(x, y, star.size, star.size);
    }
  }
}
