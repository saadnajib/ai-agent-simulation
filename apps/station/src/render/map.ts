/**
 * Static station map rendered once per zoom level into an offscreen canvas,
 * plus the per-frame room overlays (venture status borders, hover, selection)
 * and the animated corridor conduit pulse that sit on top of it. No image
 * assets: every tile is drawn procedurally in a green-phosphor console style.
 */
import { ROOM_IDS, ROOM_SPECS, type RoomId, type StationMap, type TileKind, type VentureStatus } from '@eternity/core';
import type { Camera } from './camera.js';

export interface RoomTint {
  /** "r,g,b" of the room hue, for building rgba() strings. */
  rgb: string;
  floor: string;
  floorAlt: string;
  glow: string;
  label: string;
  grid: string;
  gridFine: string;
  trace: string;
  traceV: string;
  pad: string;
  chip: string;
  chipLit: string;
  chipCore: string;
  seam: string;
  door: string;
  rim: string;
}

function tint(r: number, g: number, b: number, floorK = 0.1): RoomTint {
  const f = (k: number): string => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  const lift = (c: number): number => Math.round(c + (255 - c) * 0.45);
  return {
    rgb: `${r},${g},${b}`,
    floor: f(floorK),
    floorAlt: f(floorK * 1.18),
    glow: `rgba(${r},${g},${b},0.9)`,
    label: `rgb(${lift(r)},${lift(g)},${lift(b)})`,
    grid: `rgba(${r},${g},${b},0.2)`,
    gridFine: `rgba(${r},${g},${b},0.08)`,
    trace: `rgba(${r},${g},${b},0.5)`,
    traceV: `rgba(${r},${g},${b},0.42)`,
    pad: `rgba(${r},${g},${b},0.85)`,
    chip: `rgba(${r},${g},${b},0.55)`,
    chipLit: `rgba(${r},${g},${b},0.9)`,
    chipCore: `rgba(${r},${g},${b},0.35)`,
    seam: `rgba(${r},${g},${b},0.22)`,
    door: `rgba(${r},${g},${b},0.18)`,
    rim: `rgb(${r},${g},${b})`,
  };
}

/** Hue per room module. */
export const ROOM_TINTS: Record<RoomId, RoomTint> = {
  core: tint(120, 255, 170, 0.11),
  airlock: tint(255, 160, 40),
  reactor: tint(150, 200, 255),
  quarters: tint(110, 125, 165, 0.09),
  observatory: tint(60, 110, 255, 0.13),
  'print-foundry': tint(255, 60, 180),
  'pixel-forge': tint(60, 255, 120),
  'thumbnail-bay': tint(255, 120, 30, 0.13),
  scriptorium: tint(255, 190, 60),
  'prototype-lab': tint(30, 215, 255),
  'sound-deck': tint(160, 95, 255, 0.12),
  'broadcast-tower': tint(30, 230, 190),
};

/** Console palette: phosphor green on near-black. */
export const PHOSPHOR = {
  green: '#39ff8a',
  rgb: '57,255,138',
  channel: '#020805',
  channelSeam: 'rgba(57,255,138,0.06)',
  lane: '#0b1a12',
  rail: 'rgba(90,255,160,0.85)',
  railEdge: 'rgba(0,0,0,0.6)',
  seam: 'rgba(210,255,225,0.5)',
  node: 'rgba(200,255,220,0.95)',
  nodeHalo: 'rgba(57,255,138,0.28)',
  wall: '#050907',
};

const RENDER_SETTLE_MS = 140;
/** Module halos are blurred on a canvas this many times smaller, then stretched: blur cost drops by its square. */
const GLOW_DOWNSCALE = 4;

const STATUS_BORDER: Partial<Record<VentureStatus, string>> = {
  scaling: 'rgba(255,204,77,0.75)',
  paused: 'rgba(255,176,46,0.5)',
  incubating: 'rgba(180,140,255,0.4)',
};

/** Deterministic pseudo-random in [0,1) from tile coords, for traces and floor noise. */
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

function isInterior(k: TileKind | undefined): boolean {
  return k === 'floor' || k === 'workstation' || k === 'core-eye' || k === 'reactor-core';
}

function isChannel(k: TileKind | undefined): boolean {
  return k === 'corridor' || k === 'door';
}

export class MapLayer {
  private canvas: HTMLCanvasElement | null = null;
  private renderedScale = 0;
  private pendingScale = 0;
  private pendingSince = 0;
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

  /**
   * Returns the cached canvas for `scale` pixels per tile. When `nowMs` is
   * given, a scale change re-renders only once the zoom has settled for
   * RENDER_SETTLE_MS; until then the previous canvas is returned and the
   * caller stretches it, so a continuous wheel zoom does not re-render every
   * frame.
   */
  ensure(scale: number, nowMs?: number): HTMLCanvasElement {
    const rounded = Math.max(4, Math.round(scale * 4) / 4);
    if (this.canvas !== null && this.renderedScale !== rounded && nowMs !== undefined) {
      if (this.pendingScale !== rounded) {
        this.pendingScale = rounded;
        this.pendingSince = nowMs;
      }
      if (nowMs - this.pendingSince < RENDER_SETTLE_MS) return this.canvas;
    }
    if (this.canvas === null || this.renderedScale !== rounded) {
      this.canvas = this.render(rounded);
      this.renderedScale = rounded;
      this.pendingScale = rounded;
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

    for (const id of ROOM_IDS) this.drawRoomFloorGrid(ctx, id, s);
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
    this.drawHalos(ctx, s, canvas.width, canvas.height);
    for (const id of ROOM_IDS) this.drawRoomModule(ctx, id, s);
    // Rails go on after the module halos so the glow does not wash them out.
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        if (this.tile(x, y) === 'corridor') this.drawRails(ctx, x, y, x * s, y * s, s);
      }
    }
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
        if (kind === 'workstation') this.drawComponent(ctx, x, y, px, py, s, true);
        break;
      case 'wall':
        this.drawWall(ctx, x, y, px, py, s);
        break;
      case 'door':
        this.drawDoor(ctx, x, y, px, py, s);
        break;
      case 'core-eye':
        this.drawFloor(ctx, x, y, px, py, s);
        ctx.fillStyle = 'rgba(2,10,5,0.85)';
        ctx.fillRect(px, py, s, s);
        break;
      case 'reactor-core':
        this.drawFloor(ctx, x, y, px, py, s);
        ctx.fillStyle = 'rgba(2,6,14,0.85)';
        ctx.fillRect(px, py, s, s);
        break;
      case 'void':
        break;
    }
  }

  /** Dark channel base plus scattered deck hardware in open areas. */
  private drawCorridor(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    ctx.fillStyle = PHOSPHOR.channel;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = PHOSPHOR.channelSeam;
    ctx.fillRect(px, py, 1, 1);
    const railed =
      !isChannel(this.tile(x, y - 1)) || !isChannel(this.tile(x, y + 1)) || !isChannel(this.tile(x - 1, y)) || !isChannel(this.tile(x + 1, y));
    if (railed) {
      ctx.fillStyle = PHOSPHOR.lane;
      ctx.fillRect(px, py, s, s);
      return;
    }
    // Open deck: faint scattered hardware like the reference's loose wiring.
    const lw = Math.max(1, Math.round(s / 16));
    const h = hash2(x * 5 + 3, y * 9 + 1);
    if (h < 0.1) {
      ctx.fillStyle = h < 0.03 ? 'rgba(210,230,220,0.35)' : 'rgba(57,255,138,0.2)';
      const w = Math.max(2, Math.round(s * (0.3 + h * 4)));
      ctx.fillRect(px + Math.round(s * 0.2), py + Math.round(s * (0.2 + h * 5)), w, lw);
      ctx.fillRect(px + Math.round(s * 0.2), py + Math.round(s * 0.2), lw, Math.max(2, Math.round(s * 0.4)));
    } else if (h > 0.97) {
      ctx.fillStyle = 'rgba(57,255,138,0.25)';
      ctx.fillRect(px + Math.round(s * 0.4), py + Math.round(s * 0.4), Math.max(1, Math.round(s * 0.2)), Math.max(1, Math.round(s * 0.2)));
    }
  }

  /** Bright green rails along every channel edge that meets a wall or the hull, a dashed lane seam, and light nodes. */
  private drawRails(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    const inset = Math.max(2, Math.round(s * 0.2));
    const lw = s >= 12 ? Math.max(2, Math.round(s / 12)) : 1;
    const up = !isChannel(this.tile(x, y - 1));
    const down = !isChannel(this.tile(x, y + 1));
    const left = !isChannel(this.tile(x - 1, y));
    const right = !isChannel(this.tile(x + 1, y));
    if (!(up || down || left || right)) return;
    ctx.fillStyle = PHOSPHOR.railEdge;
    if (up) ctx.fillRect(px, py, s, lw);
    if (down) ctx.fillRect(px, py + s - lw, s, lw);
    if (left) ctx.fillRect(px, py, lw, s);
    if (right) ctx.fillRect(px + s - lw, py, lw, s);
    ctx.fillStyle = PHOSPHOR.rail;
    if (up) ctx.fillRect(px, py + inset, s, lw);
    if (down) ctx.fillRect(px, py + s - inset - lw, s, lw);
    if (left) ctx.fillRect(px + inset, py, lw, s);
    if (right) ctx.fillRect(px + s - inset - lw, py, lw, s);
    // Dashed seam between the two lanes of a two-wide conduit, drawn once from the upper/left lane.
    ctx.fillStyle = PHOSPHOR.seam;
    const dash = Math.max(2, Math.round(s * 0.45));
    if (up && !down && !isChannel(this.tile(x, y + 2))) ctx.fillRect(px + Math.round((s - dash) / 2), py + s - Math.ceil(lw / 2), dash, lw);
    if (left && !right && !isChannel(this.tile(x + 2, y))) ctx.fillRect(px + s - Math.ceil(lw / 2), py + Math.round((s - dash) / 2), lw, dash);

    if ((x * 7 + y * 13) % 5 === 0) {
      const n = Math.max(2, Math.round(s / 6));
      const nx = left ? px + inset : right ? px + s - inset - lw : px + s / 2;
      const ny = up ? py + inset : down ? py + s - inset - lw : py + s / 2;
      ctx.fillStyle = PHOSPHOR.nodeHalo;
      ctx.fillRect(Math.round(nx - n), Math.round(ny - n), n * 2 + lw, n * 2 + lw);
      ctx.fillStyle = PHOSPHOR.node;
      ctx.fillRect(Math.round(nx - n / 2), Math.round(ny - n / 2), n + lw - 1, n + lw - 1);
    }
  }

  /** Floor base and fine grid for a whole room interior, as long lines rather than per-tile rects. */
  private drawRoomFloorGrid(ctx: CanvasRenderingContext2D, id: RoomId, s: number): void {
    const r = this.map.rooms[id];
    const t = ROOM_TINTS[id];
    const x0 = (r.x + 1) * s;
    const y0 = (r.y + 1) * s;
    const w = (r.w - 2) * s;
    const h = (r.h - 2) * s;
    ctx.fillStyle = t.floor;
    ctx.fillRect(x0, y0, w, h);
    const lw = Math.max(1, Math.round(s / 18));
    ctx.fillStyle = t.grid;
    for (let i = 0; i < r.w - 2; i++) ctx.fillRect(x0 + i * s, y0, lw, h);
    for (let j = 0; j < r.h - 2; j++) ctx.fillRect(x0, y0 + j * s, w, lw);
    if (s >= 10) {
      ctx.fillStyle = t.gridFine;
      const half = Math.round(s / 2);
      for (let i = 0; i < r.w - 2; i++) ctx.fillRect(x0 + i * s + half, y0, 1, h);
      for (let j = 0; j < r.h - 2; j++) ctx.fillRect(x0, y0 + j * s + half, w, 1);
    }
  }

  /** Circuit-board floor detail on top of the room grid: seeded traces with pads, sparse chips. */
  private drawFloor(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    const room = this.roomAt(x, y) ?? 'quarters';
    const t = ROOM_TINTS[room];
    const lw = Math.max(1, Math.round(s / 18));
    // Horizontal traces run in 3-tile segments so they read as continuous wiring.
    const segX = Math.floor(x / 3);
    if (hash2(segX * 5 + 11, y) < 0.42) {
      const q = (1 + Math.floor(hash2(segX, y * 3) * 3)) / 4;
      const ty = py + Math.round(q * s);
      ctx.fillStyle = t.trace;
      ctx.fillRect(px, ty, s, lw);
      if (x % 3 === 0) {
        ctx.fillStyle = t.pad;
        const pad = Math.max(2, Math.round(s / 7));
        ctx.fillRect(px, ty - Math.floor(pad / 2), pad, pad);
      }
    }
    const segY = Math.floor(y / 3);
    if (hash2(x, segY * 7 + 5) < 0.28) {
      const q = (1 + Math.floor(hash2(x * 3, segY) * 3)) / 4;
      const tx = px + Math.round(q * s);
      ctx.fillStyle = t.traceV;
      ctx.fillRect(tx, py, lw, s);
    }
    if (hash2(x * 11, y * 5) < 0.05) this.drawComponent(ctx, x, y, px, py, s, false);
  }

  /** Square IC glyph with pins; workstations get a larger lit one. */
  private drawComponent(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number, lit: boolean): void {
    const room = this.roomAt(x, y) ?? 'quarters';
    const t = ROOM_TINTS[room];
    const size = Math.max(4, Math.round(s * (lit ? 0.62 : 0.4)));
    const ox = px + Math.round((s - size) / 2);
    const oy = py + Math.round((s - size) / 2);
    const pin = Math.max(1, Math.round(s / 16));
    const pinLen = Math.max(1, Math.round(s * 0.08));
    ctx.fillStyle = lit ? t.chipLit : t.chip;
    for (let i = 1; i <= 3; i++) {
      const o = Math.round((size * i) / 4);
      ctx.fillRect(ox + o, oy - pinLen, pin, pinLen);
      ctx.fillRect(ox + o, oy + size, pin, pinLen);
      ctx.fillRect(ox - pinLen, oy + o, pinLen, pin);
      ctx.fillRect(ox + size, oy + o, pinLen, pin);
    }
    ctx.fillStyle = '#020403';
    ctx.fillRect(ox, oy, size, size);
    ctx.strokeStyle = lit ? t.label : t.chip;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, size - 1, size - 1);
    if (lit) {
      const core = Math.max(2, Math.round(size * 0.4));
      ctx.fillStyle = t.chipCore;
      ctx.fillRect(ox + Math.round((size - core) / 2) - 1, oy + Math.round((size - core) / 2) - 1, core + 2, core + 2);
      ctx.fillStyle = t.label;
      ctx.fillRect(ox + Math.round((size - core) / 2), oy + Math.round((size - core) / 2), core, core);
    }
  }

  /** Thin dark frame; the bright rim in the room hue is stroked with glow in drawRoomModule. */
  private drawWall(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    ctx.fillStyle = PHOSPHOR.wall;
    ctx.fillRect(px, py, s, s);
    const room = this.roomAt(x, y);
    if (room === null) return;
    const t = ROOM_TINTS[room];
    const edge = Math.max(1, Math.round(s / 12));
    ctx.fillStyle = t.seam;
    const mid = Math.round(s / 2);
    // Panel seam down the middle of the frame.
    if (isInterior(this.tile(x, y + 1)) || isInterior(this.tile(x, y - 1))) ctx.fillRect(px, py + mid, s, edge);
    else if (isInterior(this.tile(x + 1, y)) || isInterior(this.tile(x - 1, y))) ctx.fillRect(px + mid, py, edge, s);
  }

  private drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, s: number): void {
    const horizontal = this.tile(x - 1, y) === 'wall' && this.tile(x + 1, y) === 'wall';
    const t = ROOM_TINTS[this.roomAt(x, y) ?? 'core'];
    ctx.fillStyle = PHOSPHOR.channel;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = t.door;
    ctx.fillRect(px, py, s, s);
    ctx.fillStyle = t.rim;
    const inset = Math.max(1, Math.round(s / 6));
    if (horizontal) {
      ctx.fillRect(px, py, inset, s);
      ctx.fillRect(px + s - inset, py, inset, s);
    } else {
      ctx.fillRect(px, py, s, inset);
      ctx.fillRect(px, py + s - inset, s, inset);
    }
  }

  /** Outer halo and inner-rim glow for every module, blurred at low resolution and stretched onto the layer. */
  private drawHalos(ctx: CanvasRenderingContext2D, s: number, width: number, height: number): void {
    const g = s / GLOW_DOWNSCALE;
    const glow = document.createElement('canvas');
    glow.width = Math.max(1, Math.ceil(width / GLOW_DOWNSCALE));
    glow.height = Math.max(1, Math.ceil(height / GLOW_DOWNSCALE));
    const gc = glow.getContext('2d');
    if (gc === null) return;
    for (const id of ROOM_IDS) {
      const r = this.map.rooms[id];
      const t = ROOM_TINTS[id];
      const strong = id === 'core' ? 1.35 : id === 'quarters' ? 0.6 : 1;
      gc.shadowColor = t.glow;
      gc.shadowBlur = Math.max(2, s * 1.7 * strong * (glow.width / width));
      gc.strokeStyle = `rgba(${t.rgb},${(0.8 * Math.min(1, strong)).toFixed(3)})`;
      gc.lineWidth = Math.max(1, g * 0.3);
      for (let i = 0; i < 3; i++) gc.strokeRect(r.x * g, r.y * g, r.w * g, r.h * g);
      gc.shadowBlur = Math.max(1, s * 0.7 * (glow.width / width));
      gc.strokeStyle = t.label;
      gc.lineWidth = Math.max(1, g * 0.15);
      gc.strokeRect((r.x + 1) * g, (r.y + 1) * g, (r.w - 2) * g, (r.h - 2) * g);
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow, 0, 0, width, height);
    ctx.restore();
  }

  /** Glowing module frame: outer halo, lit inner rim, corner brackets, interior wash. */
  private drawRoomModule(ctx: CanvasRenderingContext2D, id: RoomId, s: number): void {
    const r = this.map.rooms[id];
    const t = ROOM_TINTS[id];
    const x = r.x * s;
    const y = r.y * s;
    const w = r.w * s;
    const h = r.h * s;
    const ix = x + s;
    const iy = y + s;
    const iw = w - 2 * s;
    const ih = h - 2 * s;
    const strong = id === 'core' ? 1.35 : id === 'quarters' ? 0.6 : 1;

    // Interior wash: brighter centre so the module reads as lit.
    const wash = ctx.createRadialGradient(ix + iw / 2, iy + ih / 2, 0, ix + iw / 2, iy + ih / 2, Math.max(iw, ih) * 0.75);
    wash.addColorStop(0, `rgba(${t.rgb},${(0.2 * strong).toFixed(3)})`);
    wash.addColorStop(1, `rgba(${t.rgb},${(0.05 * strong).toFixed(3)})`);
    ctx.fillStyle = wash;
    ctx.fillRect(ix, iy, iw, ih);

    // Crisp outer frame line and lit inner rim where the frame meets the floor.
    ctx.strokeStyle = `rgba(${t.rgb},0.85)`;
    const outerLw = Math.max(1, Math.round(s / 10));
    ctx.lineWidth = outerLw;
    ctx.strokeRect(x + outerLw / 2, y + outerLw / 2, w - outerLw, h - outerLw);
    ctx.strokeStyle = t.label;
    const innerLw = Math.max(1, Math.round(s / 12));
    ctx.lineWidth = innerLw;
    ctx.strokeRect(ix - innerLw / 2, iy - innerLw / 2, iw + innerLw, ih + innerLw);

    // Corner brackets, like console viewport marks.
    const arm = Math.round(s * 1.2);
    const bw = Math.max(2, Math.round(s / 6));
    ctx.fillStyle = t.label;
    const ox = x - bw;
    const oy = y - bw;
    const ex = x + w;
    const ey = y + h;
    ctx.fillRect(ox, oy, arm, bw);
    ctx.fillRect(ox, oy, bw, arm);
    ctx.fillRect(ex - arm + bw, oy, arm, bw);
    ctx.fillRect(ex, oy, bw, arm);
    ctx.fillRect(ox, ey, arm, bw);
    ctx.fillRect(ox, ey - arm + bw, bw, arm);
    ctx.fillRect(ex - arm + bw, ey, arm, bw);
    ctx.fillRect(ex, ey - arm + bw, bw, arm);

    // Door gaps: re-open the rim over each door tile so the entrance reads.
    const d = r.door;
    ctx.fillStyle = `rgba(${t.rgb},0.25)`;
    ctx.fillRect(d.x * s + s * 0.3, d.y * s + s * 0.3, s * 0.4, s * 0.4);
  }

  /** Dim green line where the hull corridors meet space. */
  private drawHullRim(ctx: CanvasRenderingContext2D, s: number): void {
    ctx.fillStyle = 'rgba(57,255,138,0.4)';
    const edge = Math.max(1, Math.round(s / 12));
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
    const fontPx = Math.min(18, Math.max(8, Math.round(s * 0.5)));
    ctx.font = `700 ${fontPx}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${Math.max(1, Math.round(fontPx * 0.12))}px`;
    for (const id of ROOM_IDS) {
      const r = this.map.rooms[id];
      const t = ROOM_TINTS[id];
      const name = ROOM_SPECS[id].name.toUpperCase();
      // Signage sits in the corridor row above the room so bubbles near the top wall do not cover it.
      const cx = (r.x + r.w / 2) * s;
      const cy = (r.y - 0.55) * s;
      const width = ctx.measureText(name).width + fontPx * 1.2;
      const bh = fontPx * 1.45;
      ctx.fillStyle = 'rgba(1,6,3,0.92)';
      ctx.fillRect(cx - width / 2, cy - bh / 2, width, bh);
      ctx.strokeStyle = `rgba(${t.rgb},0.7)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(cx - width / 2) + 0.5, Math.round(cy - bh / 2) + 0.5, Math.round(width) - 1, Math.round(bh) - 1);
      // Cheap phosphor bloom: a faint offset pass under the crisp text instead of shadowBlur.
      ctx.fillStyle = t.seam;
      ctx.fillText(name, cx - 1, cy + 1);
      ctx.fillText(name, cx + 1, cy + 1);
      ctx.fillStyle = t.label;
      ctx.fillText(name, cx, cy + 1);
    }
    ctx.letterSpacing = '0px';
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
      ctx.fillStyle = 'rgba(1,4,2,0.62)';
      ctx.fillRect(x, y, w, h);
    }
    const border = st.status === null ? undefined : STATUS_BORDER[st.status];
    if (border !== undefined) {
      const pulse = st.status === 'scaling' ? 0.7 + 0.3 * Math.sin(nowMs / 600) : 1;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = border;
      ctx.lineWidth = Math.max(1.5, t * 0.1);
      ctx.strokeRect(x + t + 2, y + t + 2, w - 2 * t - 4, h - 2 * t - 4);
      ctx.globalAlpha = 1;
    }
    if (st.selected) {
      ctx.strokeStyle = 'rgba(57,255,138,0.95)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 3.5, y - 3.5, w + 7, h + 7);
    } else if (st.hovered) {
      ctx.fillStyle = 'rgba(57,255,138,0.05)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(57,255,138,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5);
    }
  }
}

const FLOW_PERIOD = 7;
const FLOW_MS_PER_TILE = 260;

/**
 * Animated pulse flowing along the corridor conduits toward the Overseer Core.
 * Distances come from a BFS over walkable channel tiles seeded at the core door;
 * each railed tile knows which neighbour is one step closer. Per frame it is a
 * flat loop over typed arrays with no allocation.
 */
export class ConduitFlow {
  private readonly xs: Int16Array;
  private readonly ys: Int16Array;
  private readonly dist: Int16Array;
  private readonly dx: Int8Array;
  private readonly dy: Int8Array;
  private readonly count: number;

  constructor(map: StationMap) {
    const W = map.width;
    const H = map.height;
    const kind = (x: number, y: number): TileKind | undefined => map.tiles[y]?.[x];
    const dist = new Int32Array(W * H).fill(-1);
    const queue = new Int32Array(W * H);
    let head = 0;
    let tail = 0;
    const door = map.rooms.core.door;
    dist[door.y * W + door.x] = 0;
    queue[tail++] = door.y * W + door.x;
    const NX = [1, -1, 0, 0];
    const NY = [0, 0, 1, -1];
    while (head < tail) {
      const i = queue[head++] ?? 0;
      const x = i % W;
      const y = (i - x) / W;
      for (let k = 0; k < 4; k++) {
        const nx = x + (NX[k] ?? 0);
        const ny = y + (NY[k] ?? 0);
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (dist[j] !== -1 || kind(nx, ny) !== 'corridor') continue;
        dist[j] = (dist[i] ?? 0) + 1;
        queue[tail++] = j;
      }
    }
    // Keep the pulse off the tiles behind each room's signage plate.
    const underSign = new Uint8Array(W * H);
    for (const id of ROOM_IDS) {
      const r = map.rooms[id];
      const sy = r.y - 1;
      if (sy < 0) continue;
      const cx = r.x + r.w / 2;
      const half = (ROOM_SPECS[id].name.length * 0.37 + 0.6) / 2 + 0.5;
      for (let x = Math.max(0, Math.floor(cx - half)); x < Math.min(W, Math.ceil(cx + half)); x++) underSign[sy * W + x] = 1;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    const ds: number[] = [];
    const dxs: number[] = [];
    const dys: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (kind(x, y) !== 'corridor') continue;
        const d = dist[y * W + x] ?? -1;
        if (d <= 0 || underSign[y * W + x] === 1) continue;
        const railed = !isChannel(kind(x, y - 1)) || !isChannel(kind(x, y + 1)) || !isChannel(kind(x - 1, y)) || !isChannel(kind(x + 1, y));
        if (!railed) continue;
        let best = -1;
        for (let k = 0; k < 4; k++) {
          const nx = x + (NX[k] ?? 0);
          const ny = y + (NY[k] ?? 0);
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if ((dist[ny * W + nx] ?? -1) === d - 1) {
            best = k;
            break;
          }
        }
        if (best < 0) continue;
        xs.push(x);
        ys.push(y);
        ds.push(d);
        dxs.push(NX[best] ?? 0);
        dys.push(NY[best] ?? 0);
      }
    }
    this.count = xs.length;
    this.xs = Int16Array.from(xs);
    this.ys = Int16Array.from(ys);
    this.dist = Int16Array.from(ds);
    this.dx = Int8Array.from(dxs);
    this.dy = Int8Array.from(dys);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, nowMs: number): void {
    const t = cam.tilePx();
    const phase = nowMs / FLOW_MS_PER_TILE;
    const len = t * 0.6;
    const thick = Math.max(2, t * 0.12);
    const vw = cam.viewW;
    const vh = cam.viewH;
    ctx.fillStyle = 'rgba(215,255,230,0.95)';
    for (let i = 0; i < this.count; i++) {
      const d = this.dist[i] ?? 0;
      let f = (d - phase) % FLOW_PERIOD;
      if (f < 0) f += FLOW_PERIOD;
      if (f >= 1) continue;
      const sx = cam.x + ((this.xs[i] ?? 0) + 0.5) * t;
      const sy = cam.y + ((this.ys[i] ?? 0) + 0.5) * t;
      if (sx < -t || sy < -t || sx > vw + t || sy > vh + t) continue;
      const ddx = this.dx[i] ?? 0;
      const ddy = this.dy[i] ?? 0;
      // f runs 1 -> 0 while the pulse crosses this tile toward the core.
      const off = (0.5 - f) * t;
      const cx = sx + ddx * off;
      const cy = sy + ddy * off;
      if (ddx !== 0) ctx.fillRect(cx - len / 2, cy - thick / 2, len, thick);
      else ctx.fillRect(cx - thick / 2, cy - len / 2, thick, len);
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

  constructor(count = 220, seed = 7) {
    let s = seed;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < count; i++) {
      const size = rnd() < 0.1 ? 2 : 1;
      this.stars.push({ x: rnd(), y: rnd(), size, alpha: 0.15 + rnd() * 0.5, phase: rnd() * Math.PI * 2 });
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, camX: number, camY: number, nowMs: number): void {
    const gradient = ctx.createRadialGradient(w * 0.5, h * 0.5, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, '#04110a');
    gradient.addColorStop(1, '#010302');
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
      ctx.fillStyle = `rgba(190,255,215,${(star.alpha * tw).toFixed(3)})`;
      ctx.fillRect(x, y, star.size, star.size);
    }
  }
}
