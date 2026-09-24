import { afterEach, describe, expect, it } from 'vitest';
import type { StationEvent } from '@eternity/core';
import { TICKS_PER_DAY } from '@eternity/core';
import { join } from 'node:path';
import { createAdapterRegistry } from '@eternity/adapters';
import { ScriptedBrain } from './brains/scripted.js';
import { StationBus } from './bus.js';
import { StationDb } from './db.js';
import { Station } from './station.js';
import { headlessStation, tempDir, testConfig, type HeadlessStation } from './testUtil.js';

const TWO_WEEKS = TICKS_PER_DAY * 14;

describe('headless station (sim, seed 42)', () => {
  let h: HeadlessStation | null = null;
  afterEach(() => {
    h?.cleanup();
    h = null;
  });

  it('runs two simulated weeks and produces listings, sales and revenue', async () => {
    h = headlessStation();
    const { station, bus } = h;
    const events = new Map<StationEvent['type'], number>();
    bus.onAny((event) => events.set(event.type, (events.get(event.type) ?? 0) + 1));

    for (let i = 0; i < TWO_WEEKS; i++) await station.step();

    const state = station.state();
    expect(state.clock.tick).toBe(TWO_WEEKS);
    const live = state.listings.filter((l) => l.status === 'live');
    expect(live.length).toBeGreaterThan(0);
    expect(events.get('sale') ?? 0).toBeGreaterThan(0);
    expect(state.treasury.lifetimeRevenueCents).toBeGreaterThan(0);
    expect(state.treasury.lifetimeCostCents).toBeGreaterThan(0);

    // Nothing stuck: an 'assigned' task must have a walking agent behind it, and none is ancient.
    expect(station.orphanedAssignments()).toEqual([]);
    for (const task of state.tasks.filter((t) => t.status === 'assigned')) {
      const since = station.world.assignedAt.get(task.id) ?? task.createdAtTick;
      expect(state.clock.tick - since).toBeLessThan(80);
    }
    expect(state.tasks.filter((t) => t.status === 'done').length).toBeGreaterThan(20);

    // Budget shares over funded ventures sum to one.
    const funded = state.ventures.filter((v) => v.status !== 'killed' && v.status !== 'paused');
    const sum = funded.reduce((acc, v) => acc + v.budgetShare, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
    for (const v of state.ventures.filter((v) => v.status === 'killed')) expect(v.budgetShare).toBe(0);

    // The Overseer spoke every epoch and the crew moved around.
    expect(state.directives.length).toBeGreaterThan(0);
    expect(events.get('agent.moved') ?? 0).toBeGreaterThan(100);
    expect(events.get('agent.speech') ?? 0).toBeGreaterThan(10);
    expect(events.get('approval.requested') ?? 0).toBeGreaterThan(0);
    expect(state.approvals.filter((a) => a.status === 'pending' && a.risk === 'low').every((a) => TWO_WEEKS - a.requestedAtTick < 8)).toBe(true);
    expect(state.agents.every((a) => station.world.map.tiles[a.position.y]?.[a.position.x] !== 'void')).toBe(true);
  });

  it('is deterministic: two runs at the same seed produce the same ledger', async () => {
    const a = headlessStation();
    const b = headlessStation();
    try {
      for (let i = 0; i < TICKS_PER_DAY * 5; i++) {
        await a.station.step();
        await b.station.step();
      }
      const strip = (s: ReturnType<typeof a.station.state>) => s.ledger.map((e) => [e.tick, e.kind, e.amountCents, e.memo]);
      expect(strip(a.station.state())).toEqual(strip(b.station.state()));
      expect(a.station.state().treasury.balanceCents).toBe(b.station.state().treasury.balanceCents);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it('honours commands: pause, target, spawn, kill, approvals', async () => {
    h = headlessStation({ autoApprove: false });
    const { station } = h;
    expect(station.command({ type: 'clock.pause' })).toEqual({ ok: true });
    expect(station.state().clock.paused).toBe(true);
    expect(station.command({ type: 'treasury.set-target', targetCents: 1_000_00 })).toEqual({ ok: true });
    expect(station.state().treasury.targetCents).toBe(1_000_00);
    expect(station.command({ type: 'venture.spawn', kind: 'game-assets', thesis: '1-bit dungeon crawler tile pack' })).toEqual({ ok: true });
    const spawned = station.state().ventures.find((v) => v.kind === 'game-assets');
    expect(spawned).toBeDefined();
    expect(station.command({ type: 'venture.set-status', ventureId: 'nope', status: 'paused' }).ok).toBe(false);
    expect(station.command({ type: 'venture.set-status', ventureId: spawned!.id, status: 'killed', reason: 'test' })).toEqual({ ok: true });
    expect(station.state().tasks.filter((t) => t.ventureId === spawned!.id).every((t) => t.status === 'cancelled')).toBe(true);
    expect(station.command({ type: 'approval.decide', approvalId: 'missing', decision: 'approved' }).ok).toBe(false);

    for (let i = 0; i < TICKS_PER_DAY * 4; i++) await station.step();
    const pending = station.state().approvals.filter((a) => a.status === 'pending');
    expect(pending.length).toBeGreaterThan(0);
    expect(station.command({ type: 'approval.decide-all', decision: 'approved', maxRisk: 'low' })).toEqual({ ok: true });
    await station.step();
    const after = station.state();
    for (const p of pending) expect(after.approvals.find((a) => a.id === p.id)?.status).toBe('approved');
    expect(after.listings.some((l) => l.status === 'live')).toBe(true);
    expect(station.command({ type: 'overseer.instruct', text: 'Focus on game assets.' })).toEqual({ ok: true });
    expect(station.command({ type: 'agent.hire', role: 'composer' })).toEqual({ ok: true });
    const composer = station.state().agents.find((a) => a.role === 'composer');
    expect(station.command({ type: 'agent.dismiss', agentId: composer!.id })).toEqual({ ok: true });
    expect(station.state().agents.find((a) => a.id === composer!.id)?.status).toBe('offline');
  });

  it('persists to SQLite and restores at the same tick', async () => {
    const dir = tempDir('persist-');
    const dbPath = join(dir.path, 'station.sqlite');
    const registry = createAdapterRegistry({}, { mode: 'sim' });
    const config = testConfig(join(dir.path, 'ws'), { dbPath });
    try {
      const first = Station.create({ config, db: new StationDb(dbPath), bus: new StationBus(), brain: new ScriptedBrain(), registry });
      for (let i = 0; i < 40; i++) await first.step();
      const before = first.state();
      first.stop();
      first.world.db.close();

      const second = Station.create({ config, db: new StationDb(dbPath), bus: new StationBus(), brain: new ScriptedBrain(), registry });
      const restored = second.state();
      expect(restored.clock.tick).toBe(before.clock.tick);
      expect(restored.ventures.map((v) => v.id)).toEqual(before.ventures.map((v) => v.id));
      expect(restored.agents.length).toBe(before.agents.length);
      expect(restored.ledger.length).toBe(before.ledger.length);
      expect(restored.treasury.balanceCents).toBe(before.treasury.balanceCents);
      expect(restored.tasks.filter((t) => t.status === 'assigned' || t.status === 'in-progress')).toHaveLength(0);
      for (let i = 0; i < 24; i++) await second.step();
      expect(second.state().clock.tick).toBe(before.clock.tick + 24);
      second.stop();
      second.world.db.close();
    } finally {
      dir.cleanup();
    }
  });
});
