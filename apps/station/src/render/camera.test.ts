import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM, MIN_ZOOM, TILE, clampZoom } from './camera.js';

describe('Camera', () => {
  it('clamps zoom between 0.75x and 3x', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    const cam = new Camera(56, 36);
    cam.setViewport(1000, 700);
    for (let i = 0; i < 40; i++) cam.zoomAt(500, 350, 1.5);
    expect(cam.zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 40; i++) cam.zoomAt(500, 350, 0.5);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('fits the whole station centred in the viewport', () => {
    const cam = new Camera(56, 36);
    cam.setViewport(1440, 900);
    cam.fit(24);
    const worldW = 56 * TILE * cam.zoom;
    const worldH = 36 * TILE * cam.zoom;
    expect(worldW).toBeLessThanOrEqual(1440);
    expect(worldH).toBeLessThanOrEqual(900);
    expect(cam.x + worldW / 2).toBeCloseTo(720);
    expect(cam.y + worldH / 2).toBeCloseTo(450);
  });

  it('keeps the world point under the cursor fixed while zooming', () => {
    const cam = new Camera(56, 36);
    cam.setViewport(800, 600);
    cam.fit();
    const before = cam.screenToWorld(300, 200, { x: 0, y: 0 });
    cam.zoomAt(300, 200, 1.3);
    const after = cam.screenToWorld(300, 200, { x: 0, y: 0 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('converts screen positions to tiles and follows a target', () => {
    const cam = new Camera(56, 36);
    cam.setViewport(800, 600);
    cam.zoom = 2;
    cam.centreOn(10.5 * TILE, 5.5 * TILE);
    expect(cam.screenToTile(400, 300)).toEqual({ x: 10, y: 5 });
    for (let i = 0; i < 200; i++) cam.follow(20.5 * TILE, 8.5 * TILE);
    expect(cam.screenToTile(400, 300)).toEqual({ x: 20, y: 8 });
  });
});
