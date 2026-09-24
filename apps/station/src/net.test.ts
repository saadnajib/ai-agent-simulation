import { describe, expect, it } from 'vitest';
import { backoffDelay, defaultWsUrl, isStationEvent } from './net.js';

describe('net helpers', () => {
  it('derives the websocket url from the page location', () => {
    expect(defaultWsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws');
    expect(defaultWsUrl({ protocol: 'https:', host: 'station.example' })).toBe('wss://station.example/ws');
  });

  it('backs off exponentially with a cap and jitter', () => {
    expect(backoffDelay(0, 500, 15000, 0.5)).toBe(500);
    expect(backoffDelay(1, 500, 15000, 0.5)).toBe(1000);
    expect(backoffDelay(10, 500, 15000, 0.5)).toBe(15000);
    expect(backoffDelay(3, 500, 15000, 0)).toBe(3000);
    expect(backoffDelay(3, 500, 15000, 1)).toBe(5000);
  });

  it('only accepts frames with a string type', () => {
    expect(isStationEvent({ type: 'tick' })).toBe(true);
    expect(isStationEvent({ tick: 1 })).toBe(false);
    expect(isStationEvent(null)).toBe(false);
    expect(isStationEvent('tick')).toBe(false);
  });
});
