import { describe, expect, it } from 'vitest';
import { buildStationMap, isWalkable } from '@eternity/core';
import { createMockState, createMockTransport } from './mockState.js';
import type { StationEvent } from '@eternity/core';

describe('createMockState', () => {
  const state = createMockState();

  it('fabricates the promised population', () => {
    expect(state.agents).toHaveLength(10);
    expect(state.ventures).toHaveLength(3);
    expect(state.approvals.filter((a) => a.status === 'pending')).toHaveLength(6);
    expect(state.listings.filter((l) => l.status === 'live').length).toBeGreaterThanOrEqual(8);
    expect(state.ledger.some((e) => e.kind === 'revenue')).toBe(true);
    expect(state.directives.length).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic under the same seed', () => {
    const again = createMockState();
    expect(again.treasury).toEqual(state.treasury);
    expect(again.ledger.length).toBe(state.ledger.length);
  });

  it('places every agent on a walkable tile inside its room', () => {
    const map = buildStationMap();
    for (const agent of state.agents) {
      expect(isWalkable(map, agent.position)).toBe(true);
      const room = map.rooms[agent.roomId];
      expect(agent.position.x).toBeGreaterThan(room.x);
      expect(agent.position.x).toBeLessThan(room.x + room.w - 1);
    }
    const positions = new Set(state.agents.map((a) => `${a.position.x},${a.position.y}`));
    expect(positions.size).toBe(state.agents.length);
  });

  it('keeps treasury and metrics consistent with the ledger', () => {
    const revenue = state.ledger.filter((e) => e.kind === 'revenue').reduce((s, e) => s + e.amountCents, 0);
    expect(state.treasury.lifetimeRevenueCents).toBe(revenue);
    expect(state.treasury.targetCents).toBe(1e14);
    const total = state.ventures.reduce((s, v) => s + v.metrics.revenueCents, 0);
    expect(total).toBe(revenue);
  });
});

describe('createMockTransport', () => {
  it('sends a snapshot on start and answers commands locally', () => {
    const events: StationEvent[] = [];
    const transport = createMockTransport((e) => events.push(e));
    transport.start();
    transport.stop();
    expect(events[0]?.type).toBe('snapshot');
    const snapshot = events[0];
    if (snapshot?.type !== 'snapshot') throw new Error('expected snapshot');
    const approval = snapshot.state.approvals[0];
    if (approval === undefined) throw new Error('no approvals');

    transport.sendCommand({ type: 'clock.pause' });
    transport.sendCommand({ type: 'approval.decide', approvalId: approval.id, decision: 'approved' });
    transport.sendCommand({ type: 'venture.spawn', kind: 'music-packs', thesis: 'Lo-fi loops for study streams' });
    transport.sendCommand({ type: 'approval.decide', approvalId: 'missing', decision: 'approved' });
    transport.stop();

    const types = events.map((e) => e.type);
    expect(types).toContain('approval.decided');
    expect(types).toContain('venture.upserted');
    expect(types).toContain('command.rejected');
    const paused = events.find((e) => e.type === 'tick');
    expect(paused && paused.type === 'tick' && paused.paused).toBe(true);
  });
});
