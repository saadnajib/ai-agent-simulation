/**
 * Procedural pixel crew. Each agent is a 12x16 sprite drawn with fillRect in
 * zoom-scaled pixel units: helmet with visor, role-coloured suit, walking legs
 * and a bob. HERMES (the overseer) is a hovering drone instead.
 */
import type { AgentRole, AgentStatus, CrewAgent } from '@eternity/core';
import { TILE, type Camera } from './camera.js';

export interface RolePalette {
  suit: string;
  suitDark: string;
  trim: string;
}

export const ROLE_PALETTE: Record<AgentRole, RolePalette> = {
  overseer: { suit: '#3a0b12', suitDark: '#1f050a', trim: '#ff4d5e' },
  scout: { suit: '#3f57c9', suitDark: '#2a3b8c', trim: '#a9b8ff' },
  designer: { suit: '#c94aa8', suitDark: '#8a2f73', trim: '#ff9ce6' },
  'pixel-artist': { suit: '#2fb56b', suitDark: '#1e7a48', trim: '#8dffb9' },
  'thumbnail-artist': { suit: '#e07a2f', suitDark: '#9c521d', trim: '#ffb27a' },
  writer: { suit: '#c7a94f', suitDark: '#8a7332', trim: '#e9d59a' },
  engineer: { suit: '#2f9fd9', suitDark: '#1f6c94', trim: '#8ed8ff' },
  composer: { suit: '#8a5fe0', suitDark: '#5c3d9c', trim: '#c9b0ff' },
  marketer: { suit: '#2fbfb4', suitDark: '#1f827a', trim: '#8ff0e6' },
  reviewer: { suit: '#9aa5bd', suitDark: '#66708a', trim: '#e3e9f5' },
};

export const SPRITE_W = 12;
export const SPRITE_H = 16;
const HELMET = '#dfe6f2';
const HELMET_SHADE = '#aab4c8';
const VISOR = '#132238';
const VISOR_GLINT = '#9be7ff';
const BOOT = '#1a1d26';

const STATUS_GLYPH: Partial<Record<AgentStatus, { text: string; colour: string }>> = {
  working: { text: '⚙', colour: '#5cff9d' },
  blocked: { text: '!', colour: '#ffb02e' },
  resting: { text: 'z', colour: '#b48cff' },
  offline: { text: '×', colour: '#5b6680' },
};

export interface AgentDrawInput {
  agent: CrewAgent;
  /** Interpolated tile coordinates. */
  tileX: number;
  tileY: number;
  moving: boolean;
  selected: boolean;
  hovered: boolean;
  speech: string | null;
  nowMs: number;
}

export interface SpriteRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen rectangle occupied by the sprite (for hit testing). */
export function spriteRect(cam: Camera, tileX: number, tileY: number, out: SpriteRect): SpriteRect {
  const u = cam.zoom;
  const tile = cam.tilePx();
  const left = cam.x + tileX * tile + (TILE - SPRITE_W) * 0.5 * u;
  const top = cam.y + tileY * tile - (SPRITE_H - TILE) * u;
  out.x = left;
  out.y = top;
  out.w = SPRITE_W * u;
  out.h = SPRITE_H * u;
  return out;
}

function px(ctx: CanvasRenderingContext2D, ox: number, oy: number, u: number, x: number, y: number, w: number, h: number): void {
  ctx.fillRect(ox + x * u, oy + y * u, w * u, h * u);
}

function walkPhase(input: AgentDrawInput): number {
  if (!input.moving) return 0;
  return Math.sin(input.nowMs / 90) > 0 ? 1 : -1;
}

function drawCrewSprite(ctx: CanvasRenderingContext2D, ox: number, oy: number, u: number, input: AgentDrawInput): void {
  const pal = ROLE_PALETTE[input.agent.role];
  const step = walkPhase(input);
  const bob = input.moving ? (step > 0 ? -1 : 0) : 0;
  const y0 = bob;

  // Legs and boots.
  ctx.fillStyle = pal.suitDark;
  px(ctx, ox, oy, u, 3, 13 + y0, 2, 2 + (step > 0 ? 1 : 0));
  px(ctx, ox, oy, u, 7, 13 + y0, 2, 2 + (step < 0 ? 1 : 0));
  ctx.fillStyle = BOOT;
  px(ctx, ox, oy, u, 2, 15, 3, 1);
  px(ctx, ox, oy, u, 7, 15, 3, 1);

  // Torso.
  ctx.fillStyle = pal.suit;
  px(ctx, ox, oy, u, 2, 6 + y0, 8, 7);
  ctx.fillStyle = pal.suitDark;
  px(ctx, ox, oy, u, 2, 12 + y0, 8, 1);
  // Chest panel and trim stripe.
  ctx.fillStyle = pal.trim;
  px(ctx, ox, oy, u, 5, 7 + y0, 2, 2);
  px(ctx, ox, oy, u, 2, 10 + y0, 8, 1);
  // Arms swing while walking.
  ctx.fillStyle = pal.suitDark;
  px(ctx, ox, oy, u, 1, 6 + y0 + (step > 0 ? 1 : 0), 1, 5);
  px(ctx, ox, oy, u, 10, 6 + y0 + (step < 0 ? 1 : 0), 1, 5);
  ctx.fillStyle = HELMET_SHADE;
  px(ctx, ox, oy, u, 1, 11 + y0 + (step > 0 ? 1 : 0), 1, 1);
  px(ctx, ox, oy, u, 10, 11 + y0 + (step < 0 ? 1 : 0), 1, 1);

  // Helmet.
  ctx.fillStyle = HELMET;
  px(ctx, ox, oy, u, 3, 0 + y0, 6, 1);
  px(ctx, ox, oy, u, 2, 1 + y0, 8, 5);
  ctx.fillStyle = HELMET_SHADE;
  px(ctx, ox, oy, u, 2, 5 + y0, 8, 1);
  px(ctx, ox, oy, u, 9, 1 + y0, 1, 4);
  // Visor.
  ctx.fillStyle = VISOR;
  px(ctx, ox, oy, u, 3, 2 + y0, 6, 3);
  ctx.fillStyle = VISOR_GLINT;
  px(ctx, ox, oy, u, 4, 2 + y0, 2, 1);
  // Role light on the helmet.
  ctx.fillStyle = pal.trim;
  px(ctx, ox, oy, u, 8, 3 + y0, 1, 1);
}

function drawOverseerSprite(ctx: CanvasRenderingContext2D, ox: number, oy: number, u: number, input: AgentDrawInput): void {
  const pal = ROLE_PALETTE.overseer;
  const hover = Math.round(Math.sin(input.nowMs / 500) * 1.5);
  const y0 = hover;
  // Shadow on the floor.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  px(ctx, ox, oy, u, 3, 15, 6, 1);
  // Chassis: a dark obelisk with a red core.
  ctx.fillStyle = pal.suitDark;
  px(ctx, ox, oy, u, 3, 1 + y0, 6, 12);
  ctx.fillStyle = pal.suit;
  px(ctx, ox, oy, u, 4, 2 + y0, 4, 10);
  ctx.fillStyle = '#5b6680';
  px(ctx, ox, oy, u, 2, 4 + y0, 1, 6);
  px(ctx, ox, oy, u, 9, 4 + y0, 1, 6);
  // Eye.
  const glow = 0.6 + 0.4 * Math.sin(input.nowMs / 350);
  ctx.fillStyle = `rgba(255,77,94,${glow.toFixed(2)})`;
  px(ctx, ox, oy, u, 4, 4 + y0, 4, 3);
  ctx.fillStyle = '#fff1f2';
  px(ctx, ox, oy, u, 5, 5 + y0, 1, 1);
  // Antenna.
  ctx.fillStyle = pal.trim;
  px(ctx, ox, oy, u, 5, 0 + y0, 2, 1);
}

/** Draw one agent body. Labels and bubbles are drawn in a second pass so they sit above other bodies. */
export function drawAgentBody(ctx: CanvasRenderingContext2D, cam: Camera, input: AgentDrawInput, rect: SpriteRect): void {
  const u = cam.zoom;
  spriteRect(cam, input.tileX, input.tileY, rect);
  const ox = Math.round(rect.x);
  const oy = Math.round(rect.y);

  if (input.selected || input.hovered) {
    ctx.save();
    ctx.strokeStyle = input.selected ? 'rgba(79,209,255,0.95)' : 'rgba(219,228,243,0.55)';
    ctx.lineWidth = input.selected ? 2 : 1;
    ctx.strokeRect(ox - 2.5, oy - 2.5, rect.w + 5, rect.h + 5);
    ctx.restore();
  }

  if (input.agent.role === 'overseer') drawOverseerSprite(ctx, ox, oy, u, input);
  else drawCrewSprite(ctx, ox, oy, u, input);

  const glyph = STATUS_GLYPH[input.agent.status];
  if (glyph !== undefined) {
    const blink = input.agent.status === 'working' ? Math.sin(input.nowMs / 250) > -0.3 : true;
    if (blink) {
      ctx.font = `${Math.max(9, Math.round(7 * u))}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = glyph.colour;
      ctx.fillText(glyph.text, ox + rect.w / 2 + rect.w * 0.55, oy - 1);
    }
  }
}

const LABEL_FONT = '10px ui-monospace, Menlo, Consolas, monospace';
const BUBBLE_FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BUBBLE_MAX_CHARS = 44;

export function drawAgentLabel(ctx: CanvasRenderingContext2D, cam: Camera, input: AgentDrawInput, rect: SpriteRect): void {
  const showLabel = cam.zoom >= 1 || input.selected || input.hovered;
  if (!showLabel) return;
  spriteRect(cam, input.tileX, input.tileY, rect);
  const cx = rect.x + rect.w / 2;
  const top = rect.y + rect.h + 3;
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const name = input.agent.name;
  const w = ctx.measureText(name).width + 6;
  ctx.fillStyle = 'rgba(5,7,12,0.75)';
  ctx.fillRect(Math.round(cx - w / 2), Math.round(top), Math.round(w), 13);
  ctx.fillStyle = input.selected ? '#4fd1ff' : ROLE_PALETTE[input.agent.role].trim;
  ctx.fillText(name, Math.round(cx), Math.round(top) + 2);
}

const MAX_BUBBLES = 64;
const placedBubbles: SpriteRect[] = Array.from({ length: MAX_BUBBLES }, () => ({ x: 0, y: 0, w: 0, h: 0 }));
let placedCount = 0;

/** Call once per frame before the bubble pass so bubbles can avoid each other. */
export function beginBubblePass(): void {
  placedCount = 0;
}

function overlaps(a: SpriteRect, x: number, y: number, w: number, h: number): boolean {
  return x < a.x + a.w + 4 && x + w + 4 > a.x && y < a.y + a.h + 2 && y + h + 2 > a.y;
}

/** Shift a bubble upward until it clears every bubble already placed this frame. */
function settleBubble(x: number, y: number, w: number, h: number): number {
  let settled = y;
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    for (let i = 0; i < placedCount; i++) {
      const p = placedBubbles[i];
      if (p !== undefined && overlaps(p, x, settled, w, h)) {
        settled = p.y - h - 3;
        moved = true;
      }
    }
    if (!moved) break;
  }
  if (placedCount < MAX_BUBBLES) {
    const slot = placedBubbles[placedCount++];
    if (slot !== undefined) {
      slot.x = x;
      slot.y = settled;
      slot.w = w;
      slot.h = h;
    }
  }
  return settled;
}

export function drawSpeechBubble(ctx: CanvasRenderingContext2D, cam: Camera, input: AgentDrawInput, rect: SpriteRect): void {
  if (input.speech === null || input.speech.length === 0) return;
  spriteRect(cam, input.tileX, input.tileY, rect);
  let text = input.speech;
  if (text.length > BUBBLE_MAX_CHARS) text = `${text.slice(0, BUBBLE_MAX_CHARS - 1).trimEnd()}…`;
  ctx.font = BUBBLE_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const padX = 6;
  const h = 18;
  const w = ctx.measureText(text).width + padX * 2;
  const cx = rect.x + rect.w / 2;
  const x = Math.round(cx - w / 2);
  const anchorY = Math.round(rect.y - h - 10);
  const y = settleBubble(x, anchorY, w, h);
  ctx.fillStyle = 'rgba(236,241,250,0.96)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fill();
  // Short tail stub; a bubble pushed up by a neighbour stacks above it rather than drawing through it.
  ctx.beginPath();
  ctx.moveTo(cx - 4, y + h);
  ctx.lineTo(cx + 4, y + h);
  ctx.lineTo(cx, y + h + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0e1220';
  ctx.fillText(text, x + padX, y + h / 2 + 0.5);
}
