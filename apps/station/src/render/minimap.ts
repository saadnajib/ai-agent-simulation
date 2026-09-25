/**
 * Console minimap in the bottom-right of the stage: room modules in their
 * hues, the camera viewport and crew dots. Drawn straight onto the main
 * canvas each frame from the room geometry; clicking it recentres the camera.
 */
import { ROOM_IDS, type StationMap } from '@eternity/core';
import { TILE, type Camera } from './camera.js';
import { ROOM_TINTS } from './map.js';

export const MINIMAP_W = 180;
export const MINIMAP_H = 120;
const MARGIN = 14;
const PAD = 8;

export interface MinimapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Minimap {
  private readonly rect: MinimapRect = { x: 0, y: 0, w: MINIMAP_W, h: MINIMAP_H };
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(private readonly map: StationMap) {}

  /** Recompute placement for the current viewport. */
  layout(viewW: number, viewH: number): void {
    this.rect.x = viewW - MINIMAP_W - MARGIN;
    this.rect.y = viewH - MINIMAP_H - MARGIN;
    const innerW = MINIMAP_W - PAD * 2;
    const innerH = MINIMAP_H - PAD * 2;
    this.scale = Math.min(innerW / this.map.width, innerH / this.map.height);
    this.ox = this.rect.x + (MINIMAP_W - this.map.width * this.scale) / 2;
    this.oy = this.rect.y + (MINIMAP_H - this.map.height * this.scale) / 2;
  }

  hit(sx: number, sy: number): boolean {
    const r = this.rect;
    return sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h;
  }

  /** World pixel coordinates (zoom 1) under a screen point inside the minimap. */
  toWorld(sx: number, sy: number, out: { x: number; y: number }): { x: number; y: number } {
    out.x = ((sx - this.ox) / this.scale) * TILE;
    out.y = ((sy - this.oy) / this.scale) * TILE;
    return out;
  }

  begin(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const r = this.rect;
    const k = this.scale;
    ctx.fillStyle = 'rgba(1,8,4,0.88)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // Hull footprint.
    ctx.fillStyle = 'rgba(57,255,138,0.08)';
    ctx.fillRect(this.ox + k, this.oy + k, (this.map.width - 2) * k, (this.map.height - 2) * k);
    for (const id of ROOM_IDS) {
      const room = this.map.rooms[id];
      const t = ROOM_TINTS[id];
      const x = this.ox + room.x * k;
      const y = this.oy + room.y * k;
      ctx.fillStyle = `rgba(${t.rgb},0.45)`;
      ctx.fillRect(x, y, room.w * k, room.h * k);
      ctx.strokeStyle = t.label;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(room.w * k) - 1, Math.round(room.h * k) - 1);
    }
    // Camera viewport.
    const t = cam.tilePx();
    const vx = this.ox + (-cam.x / t) * k;
    const vy = this.oy + (-cam.y / t) * k;
    const vw = (cam.viewW / t) * k;
    const vh = (cam.viewH / t) * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(230,255,240,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(vw), Math.round(vh));
    ctx.restore();
    ctx.fillStyle = '#e6fff0';
  }

  /** Call between begin() and end() for each agent, in tile coordinates. */
  dot(ctx: CanvasRenderingContext2D, tileX: number, tileY: number): void {
    const k = this.scale;
    ctx.fillRect(Math.round(this.ox + (tileX + 0.5) * k) - 1, Math.round(this.oy + (tileY + 0.5) * k) - 1, 2, 2);
  }

  end(ctx: CanvasRenderingContext2D): void {
    const r = this.rect;
    ctx.strokeStyle = 'rgba(57,255,138,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    ctx.strokeStyle = 'rgba(57,255,138,0.35)';
    ctx.strokeRect(r.x + 3.5, r.y + 3.5, r.w - 7, r.h - 7);
    // Corner brackets.
    ctx.fillStyle = '#39ff8a';
    const a = 12;
    ctx.fillRect(r.x - 2, r.y - 2, a, 3);
    ctx.fillRect(r.x - 2, r.y - 2, 3, a);
    ctx.fillRect(r.x + r.w - a + 2, r.y + r.h - 1, a, 3);
    ctx.fillRect(r.x + r.w - 1, r.y + r.h - a + 2, 3, a);
    ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(57,255,138,0.8)';
    ctx.fillText('NAV', r.x + 6, r.y + 5);
  }
}
