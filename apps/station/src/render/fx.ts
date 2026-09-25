/**
 * Dynamic effects drawn over the static map each frame: the Overseer's eye,
 * the reactor glow, the Airlock lamp, floating "+$" sale text, plus the DOM
 * milestone toast. Floaters are pooled so steady-state frames allocate nothing.
 */
import type { StationMap } from '@eternity/core';
import { TILE, type Camera } from './camera.js';

export const PLATFORM_COLOURS: Record<string, string> = {
  etsy: '#ff8a3d',
  printify: '#5cff9d',
  printful: '#5cff9d',
  fiverr: '#1dbf73',
  itch: '#fa5c5c',
  gumroad: '#ff90e8',
  lemonsqueezy: '#ffc233',
  wordpress: '#8ed8ff',
  'amazon-associates': '#ff9900',
  'unity-asset-store': '#b6bfd6',
  distrokid: '#c9b0ff',
  pinterest: '#e60023',
  x: '#e3e9f5',
  mock: '#39ff8a',
};

export function platformColour(platform: string): string {
  return PLATFORM_COLOURS[platform] ?? '#5cff9d';
}

interface Floater {
  active: boolean;
  tileX: number;
  tileY: number;
  text: string;
  colour: string;
  bornMs: number;
  ttlMs: number;
}

const FLOATER_POOL = 96;
const FLOATER_TTL_MS = 1700;
const FLOATER_RISE_TILES = 1.4;
const TOAST_MS = 4000;
const FLASH_P = 0.18;
const RING_DASH: number[] = [3, 5];
const NO_DASH: number[] = [];
/** Sale pop-up colours: phosphor green for income, red for refunds and losses. */
export const SALE_GREEN = '#39ff8a';
export const SALE_RED = '#ff4d5e';

export interface FxFrameInput {
  nowMs: number;
  tick: number;
  workingAgents: number;
  dailyProfitCents: number;
  pendingApprovals: number;
}

export class FxLayer {
  private readonly floaters: Floater[] = [];
  private readonly toastHost: HTMLElement | null;
  private readonly toastQueue: { title: string; sub: string }[] = [];
  private toastActive = false;
  private readonly coreCentre: { x: number; y: number };
  private readonly reactorCentre: { x: number; y: number };
  private readonly airlockLamp: { x: number; y: number };

  constructor(
    private readonly map: StationMap,
    toastHost: HTMLElement | null,
  ) {
    this.toastHost = toastHost;
    for (let i = 0; i < FLOATER_POOL; i++) {
      this.floaters.push({ active: false, tileX: 0, tileY: 0, text: '', colour: '', bornMs: 0, ttlMs: 1 });
    }
    this.coreCentre = decorativeCentre(map, 'core-eye');
    this.reactorCentre = decorativeCentre(map, 'reactor-core');
    const door = map.rooms.airlock.door;
    this.airlockLamp = { x: door.x + 0.5, y: door.y + 0.5 };
  }

  /** Centre tile of a room in tile units, for placing floaters. */
  roomCentre(roomId: keyof StationMap['rooms']): { x: number; y: number } {
    const r = this.map.rooms[roomId];
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  }

  spawnFloater(tileX: number, tileY: number, text: string, colour: string, nowMs: number): void {
    let slot = this.floaters.find((f) => !f.active);
    if (slot === undefined) {
      // Pool exhausted: recycle the oldest.
      slot = this.floaters.reduce((a, b) => (a.bornMs <= b.bornMs ? a : b));
    }
    slot.active = true;
    slot.tileX = tileX + (Math.random() - 0.5) * 1.5;
    slot.tileY = tileY + (Math.random() - 0.5) * 0.8;
    slot.text = text;
    slot.colour = colour;
    slot.bornMs = nowMs;
    slot.ttlMs = FLOATER_TTL_MS;
  }

  showToast(title: string, sub: string): void {
    if (this.toastHost === null) return;
    this.toastQueue.push({ title, sub });
    if (!this.toastActive) this.nextToast();
  }

  private nextToast(): void {
    const next = this.toastQueue.shift();
    if (next === undefined || this.toastHost === null) {
      this.toastActive = false;
      return;
    }
    this.toastActive = true;
    const el = document.createElement('div');
    el.className = 'toast';
    const title = document.createElement('div');
    title.textContent = next.title;
    const sub = document.createElement('div');
    sub.className = 'toast-sub';
    sub.textContent = next.sub;
    el.append(title, sub);
    this.toastHost.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => {
        el.remove();
        this.nextToast();
      }, 320);
    }, TOAST_MS);
  }

  /** Ambient effects that sit under the crew: core eye, reactor glow, Airlock lamp. */
  drawAmbient(ctx: CanvasRenderingContext2D, cam: Camera, input: FxFrameInput): void {
    this.drawCoreEye(ctx, cam, input);
    this.drawReactor(ctx, cam, input);
    this.drawAirlockLamp(ctx, cam, input);
  }

  /** Effects that sit above the crew: floating sale text. */
  drawOverlay(ctx: CanvasRenderingContext2D, cam: Camera, nowMs: number): void {
    this.drawFloaters(ctx, cam, nowMs);
  }

  private drawCoreEye(ctx: CanvasRenderingContext2D, cam: Camera, input: FxFrameInput): void {
    const t = cam.tilePx();
    const cx = cam.x + this.coreCentre.x * t;
    const cy = cam.y + this.coreCentre.y * t;
    const pulse = 1 + 0.06 * Math.sin(input.nowMs / 420);
    const dilation = Math.min(1, input.workingAgents / 12);
    const irisR = t * (0.55 + 0.4 * dilation) * pulse;

    // Large green-white halo that breathes with the number of working crew.
    const breath = 0.5 + 0.5 * Math.sin(input.nowMs / (1400 - 600 * dilation));
    const haloR = t * (5.5 + 2.5 * dilation + 0.6 * breath);
    const haloA = 0.2 + 0.22 * dilation + 0.08 * breath;
    const halo = ctx.createRadialGradient(cx, cy, t * 0.6, cx, cy, haloR);
    halo.addColorStop(0, `rgba(215,255,230,${haloA.toFixed(3)})`);
    halo.addColorStop(0.35, `rgba(80,255,150,${(haloA * 0.55).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(57,255,138,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - haloR, cy - haloR, haloR * 2, haloR * 2);

    // Concentric instrument rings, one dashed and slowly turning.
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(190,255,215,${(0.45 + 0.2 * breath).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 1.45, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,255,170,0.3)';
    ctx.beginPath();
    ctx.arc(cx, cy, t * 2.35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(RING_DASH);
    ctx.lineDashOffset = -input.nowMs / 60;
    ctx.strokeStyle = 'rgba(120,255,170,0.55)';
    ctx.lineWidth = Math.max(1, t * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, t * 1.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
    ctx.lineDashOffset = 0;
    ctx.lineWidth = 1;

    const ambient = ctx.createRadialGradient(cx, cy, irisR * 0.5, cx, cy, t * 1.8);
    ambient.addColorStop(0, `rgba(255,50,60,${(0.35 * pulse).toFixed(3)})`);
    ambient.addColorStop(1, 'rgba(255,50,60,0)');
    ctx.fillStyle = ambient;
    ctx.fillRect(cx - t * 1.8, cy - t * 1.8, t * 3.6, t * 3.6);

    // Sclera, iris, pupil.
    ctx.fillStyle = '#1a0507';
    ctx.beginPath();
    ctx.ellipse(cx, cy, t * 1.0, t * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,255,220,0.6)';
    ctx.stroke();
    const iris = ctx.createRadialGradient(cx - irisR * 0.2, cy - irisR * 0.2, irisR * 0.1, cx, cy, irisR);
    iris.addColorStop(0, '#ff9aa2');
    iris.addColorStop(0.45, '#ff2d3f');
    iris.addColorStop(1, '#5a0410');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(cx, cy, irisR, 0, Math.PI * 2);
    ctx.fill();
    const pupilR = Math.max(1.5, irisR * (0.32 + 0.18 * dilation));
    ctx.fillStyle = '#05000a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, pupilR * 0.6, pupilR, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(cx - irisR * 0.3, cy - irisR * 0.3, Math.max(1, irisR * 0.14), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawReactor(ctx: CanvasRenderingContext2D, cam: Camera, input: FxFrameInput): void {
    const t = cam.tilePx();
    const cx = cam.x + this.reactorCentre.x * t;
    const cy = cam.y + this.reactorCentre.y * t;
    const profit = input.dailyProfitCents;
    const magnitude = profit === 0 ? 0 : Math.min(1, Math.log10(1 + Math.abs(profit) / 100) / 4);
    const positive = profit > 0;
    // Blue-white when profitable; a smaller, dimmer, red-cored glow when losing money.
    const base = positive ? '185,220,255' : profit < 0 ? '255,120,130' : '140,160,190';
    const freq = 900 - 500 * magnitude;
    const pulse = 0.75 + 0.25 * Math.sin(input.nowMs / freq);
    const scale = positive ? 1 : 0.45;
    const alpha = (0.18 + 0.5 * magnitude * scale) * pulse;
    const radius = t * (2 + 3.2 * magnitude * scale);
    const glow = ctx.createRadialGradient(cx, cy, t * 0.3, cx, cy, radius);
    glow.addColorStop(0, `rgba(240,248,255,${Math.min(1, alpha * 1.3).toFixed(3)})`);
    glow.addColorStop(0.3, `rgba(${base},${alpha.toFixed(3)})`);
    glow.addColorStop(1, `rgba(${base},0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.strokeStyle = `rgba(${base},${(0.35 + 0.25 * pulse).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, t * 2.3, 0, Math.PI * 2);
    ctx.stroke();
    // Four rods in a 2x2 block around the centre.
    const rod = t * 0.7;
    const gap = t * 0.15;
    ctx.fillStyle = `rgba(${base},${(0.55 + 0.45 * pulse).toFixed(3)})`;
    for (let i = 0; i < 4; i++) {
      const x = cx + (i % 2 === 0 ? -rod - gap / 2 : gap / 2);
      const y = cy + (i < 2 ? -rod - gap / 2 : gap / 2);
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(rod), Math.round(rod));
    }
    ctx.fillStyle = `rgba(255,255,255,${(0.5 * pulse).toFixed(3)})`;
    ctx.fillRect(Math.round(cx - t * 0.15), Math.round(cy - t * 0.15), Math.round(t * 0.3), Math.round(t * 0.3));
  }

  private drawAirlockLamp(ctx: CanvasRenderingContext2D, cam: Camera, input: FxFrameInput): void {
    const t = cam.tilePx();
    const x = cam.x + this.airlockLamp.x * t;
    const y = cam.y + this.airlockLamp.y * t;
    const pending = input.pendingApprovals > 0;
    const on = pending ? Math.sin(input.nowMs / 300) > 0 : true;
    const colour = pending ? '255,176,46' : '57,255,138';
    const r = Math.max(2, t * 0.22);
    if (pending) {
      // Module burns brighter while approvals wait: stacked rims fake a halo without shadowBlur.
      const room = this.map.rooms.airlock;
      const rx = cam.x + room.x * t;
      const ry = cam.y + room.y * t;
      const rw = room.w * t;
      const rh = room.h * t;
      const beat = 0.6 + 0.4 * Math.sin(input.nowMs / 420);
      ctx.fillStyle = `rgba(255,176,46,${(0.05 + 0.05 * beat).toFixed(3)})`;
      ctx.fillRect(rx + t, ry + t, rw - 2 * t, rh - 2 * t);
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const g = i * 3;
        ctx.strokeStyle = `rgba(255,176,46,${((0.5 * beat) / i).toFixed(3)})`;
        ctx.strokeRect(rx - g, ry - g, rw + g * 2, rh + g * 2);
      }
    }
    if (on) {
      const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 6);
      glow.addColorStop(0, `rgba(${colour},0.5)`);
      glow.addColorStop(1, `rgba(${colour},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
    }
    ctx.fillStyle = on ? `rgb(${colour})` : `rgba(${colour},0.25)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(2,8,4,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, cam: Camera, nowMs: number): void {
    const t = cam.tilePx();
    ctx.font = `700 ${Math.max(12, Math.round(8.5 * cam.zoom))}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      if (!f.active) continue;
      const p = (nowMs - f.bornMs) / f.ttlMs;
      if (p >= 1) {
        f.active = false;
        continue;
      }
      const ease = 1 - (1 - p) * (1 - p);
      const x = cam.x + f.tileX * t;
      const y = cam.y + (f.tileY - ease * FLOATER_RISE_TILES) * t;
      const alpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      // Brief flash: an expanding ring at the spawn point and a white-hot first few frames.
      if (p < FLASH_P) {
        const k = p / FLASH_P;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, cam.y + f.tileY * t, t * (0.3 + 1.2 * k), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(1,6,3,0.92)';
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = p < FLASH_P * 0.6 ? '#eafff2' : f.colour;
      ctx.fillText(f.text, x, y);
    }
    ctx.globalAlpha = 1;
  }
}

function decorativeCentre(map: StationMap, kind: 'core-eye' | 'reactor-core'): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < map.height; y++) {
    const row = map.tiles[y];
    if (row === undefined) continue;
    for (let x = 0; x < map.width; x++) {
      if (row[x] !== kind) continue;
      sx += x + 0.5;
      sy += y + 0.5;
      n++;
    }
  }
  if (n === 0) {
    const room = kind === 'core-eye' ? map.rooms.core : map.rooms.reactor;
    return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  }
  return { x: sx / n, y: sy / n };
}

export const WORLD_TILE = TILE;
