/**
 * Camera: maps world units (tile pixels at zoom 1, 16 per tile) to screen
 * pixels. Pure math in the class; DOM wiring lives in attachCameraControls.
 */
import type { GridPosition } from '@eternity/core';

export const TILE = 16;
export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 3;
const ZOOM_STEP = 1.12;
const FOLLOW_ALPHA = 0.12;
const DRAG_THRESHOLD_PX = 4;

export interface ScreenPoint {
  x: number;
  y: number;
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export class Camera {
  /** Screen position of the world origin. */
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 1;
  viewH = 1;
  private worldW: number;
  private worldH: number;

  constructor(worldTilesW: number, worldTilesH: number) {
    this.worldW = worldTilesW * TILE;
    this.worldH = worldTilesH * TILE;
  }

  setViewport(w: number, h: number): void {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
  }

  tilePx(): number {
    return TILE * this.zoom;
  }

  /** Zoom so the whole station fits with padding, then centre it. */
  fit(paddingPx = 24): void {
    const zx = (this.viewW - paddingPx * 2) / this.worldW;
    const zy = (this.viewH - paddingPx * 2) / this.worldH;
    this.zoom = clampZoom(Math.min(zx, zy));
    this.centreOn(this.worldW / 2, this.worldH / 2);
  }

  centreOn(worldX: number, worldY: number): void {
    this.x = this.viewW / 2 - worldX * this.zoom;
    this.y = this.viewH / 2 - worldY * this.zoom;
  }

  /** Ease the view toward a world point; used to follow the selected agent. */
  follow(worldX: number, worldY: number, alpha = FOLLOW_ALPHA): void {
    const targetX = this.viewW / 2 - worldX * this.zoom;
    const targetY = this.viewH / 2 - worldY * this.zoom;
    this.x += (targetX - this.x) * alpha;
    this.y += (targetY - this.y) * alpha;
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.clampPan();
  }

  /** Multiply zoom by `factor` keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = clampZoom(this.zoom * factor);
    if (next === this.zoom) return;
    const wx = (sx - this.x) / this.zoom;
    const wy = (sy - this.y) / this.zoom;
    this.zoom = next;
    this.x = sx - wx * next;
    this.y = sy - wy * next;
    this.clampPan();
  }

  zoomStep(direction: 1 | -1, sx = this.viewW / 2, sy = this.viewH / 2): void {
    this.zoomAt(sx, sy, direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  /** Keep at least a quarter of the station on screen. */
  private clampPan(): void {
    const w = this.worldW * this.zoom;
    const h = this.worldH * this.zoom;
    const minX = -w + this.viewW * 0.25;
    const maxX = this.viewW * 0.75;
    const minY = -h + this.viewH * 0.25;
    const maxY = this.viewH * 0.75;
    this.x = Math.min(maxX, Math.max(minX, this.x));
    this.y = Math.min(maxY, Math.max(minY, this.y));
  }

  worldToScreen(wx: number, wy: number, out: ScreenPoint): ScreenPoint {
    out.x = this.x + wx * this.zoom;
    out.y = this.y + wy * this.zoom;
    return out;
  }

  screenToWorld(sx: number, sy: number, out: ScreenPoint): ScreenPoint {
    out.x = (sx - this.x) / this.zoom;
    out.y = (sy - this.y) / this.zoom;
    return out;
  }

  screenToTile(sx: number, sy: number): GridPosition {
    const t = this.tilePx();
    return { x: Math.floor((sx - this.x) / t), y: Math.floor((sy - this.y) / t) };
  }

  /** Screen x of a tile column's left edge. */
  tileScreenX(tileX: number): number {
    return this.x + tileX * this.tilePx();
  }

  tileScreenY(tileY: number): number {
    return this.y + tileY * this.tilePx();
  }
}

export interface CameraControlHandlers {
  onClick(sx: number, sy: number): void;
  onHover(sx: number, sy: number): void;
  onLeave(): void;
  /** Called when the user pans or zooms by hand, so follow mode can release. */
  onUserMove(): void;
}

/** Wire pointer drag, wheel zoom and click detection to a canvas. */
export function attachCameraControls(canvas: HTMLCanvasElement, camera: Camera, handlers: CameraControlHandlers): () => void {
  let dragging = false;
  let moved = false;
  let lastX = 0;
  let lastY = 0;
  let activePointer: number | null = null;

  const local = (e: PointerEvent | WheelEvent): ScreenPoint => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    dragging = true;
    moved = false;
    lastX = p.x;
    lastY = p.y;
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const p = local(e);
    if (dragging && e.pointerId === activePointer) {
      const dx = p.x - lastX;
      const dy = p.y - lastY;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      canvas.classList.add('dragging');
      camera.panBy(dx, dy);
      lastX = p.x;
      lastY = p.y;
      handlers.onUserMove();
      return;
    }
    handlers.onHover(p.x, p.y);
  };

  const endDrag = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== activePointer) return;
    dragging = false;
    activePointer = null;
    canvas.classList.remove('dragging');
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!moved) {
      const p = local(e);
      handlers.onClick(p.x, p.y);
    }
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = local(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    camera.zoomAt(p.x, p.y, factor);
    handlers.onUserMove();
  };

  const onLeave = (): void => {
    handlers.onLeave();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', endDrag);
    canvas.removeEventListener('pointercancel', endDrag);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
  };
}
