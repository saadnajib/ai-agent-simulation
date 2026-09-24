import { describe, expect, it } from 'vitest';
import { IMPLICIT_SPEECH_TTL_TICKS, MAX_LOG_LINES, StationStore, expectedTickMs, resolveAgentPosition } from './store.js';
import { createMockState } from './mockState.js';

function storeWithSnapshot(now = 1000): { store: StationStore; clock: { now: number } } {
  const clock = { now };
  const store = new StationStore(() => clock.now);
  store.apply({ type: 'snapshot', state: createMockState() });
  return { store, clock };
}

describe('StationStore', () => {
  it('applies a snapshot and derives the tick duration from speed', () => {
    const { store } = storeWithSnapshot();
    expect(store.station).not.toBeNull();
    expect(store.station?.clock.speed).toBe(4);
    expect(store.state.tickDurationMs).toBe(expectedTickMs(4));
    expect(store.state.tickDurationMs).toBeCloseTo(125);
  });

  it('records interpolation targets on agent.moved and interpolates over the tick duration', () => {
    const { store, clock } = storeWithSnapshot();
    const agent = store.station?.agents.find((a) => a.id === 'agt_lyra');
    if (agent === undefined) throw new Error('missing agent');
    const from = { ...agent.position };
    const to = { x: from.x + 1, y: from.y };
    clock.now = 2000;
    store.apply({ type: 'agent.moved', agentId: agent.id, from, to, roomId: agent.roomId });
    expect(agent.position).toEqual(to);
    const motion = store.state.motions.get(agent.id);
    expect(motion).toMatchObject({ fromX: from.x, toX: to.x, startMs: 2000 });
    const out = { x: 0, y: 0, moving: false };
    resolveAgentPosition(agent, motion, 2000 + store.state.tickDurationMs / 2, out);
    expect(out.x).toBeCloseTo(from.x + 0.5);
    expect(out.moving).toBe(true);
    resolveAgentPosition(agent, motion, 2000 + store.state.tickDurationMs * 2, out);
    expect(out.x).toBe(to.x);
    expect(out.moving).toBe(false);
  });

  it('learns the tick duration from consecutive tick timestamps', () => {
    const { store, clock } = storeWithSnapshot(0);
    const tick = store.tick;
    for (let i = 1; i <= 12; i++) {
      clock.now = i * 300;
      store.apply({ type: 'tick', tick: tick + i, simTime: '2030-01-01T00:00:00.000Z', paused: false, speed: 4 });
    }
    expect(store.state.tickDurationMs).toBeGreaterThan(250);
    expect(store.state.tickDurationMs).toBeLessThanOrEqual(300);
  });

  it('resets the tick duration when speed changes', () => {
    const { store, clock } = storeWithSnapshot(0);
    clock.now = 500;
    store.apply({ type: 'tick', tick: store.tick + 1, simTime: '', paused: false, speed: 64 });
    expect(store.state.tickDurationMs).toBe(expectedTickMs(64));
  });

  it('expires speech bubbles after ttlTicks', () => {
    const { store } = storeWithSnapshot();
    const tick = store.tick;
    store.apply({ type: 'agent.speech', agentId: 'agt_lyra', text: 'hello', ttlTicks: 2 });
    expect(store.speechFor('agt_lyra')).toBe('hello');
    store.apply({ type: 'tick', tick: tick + 1, simTime: '', paused: false, speed: 4 });
    expect(store.speechFor('agt_lyra')).toBe('hello');
    store.apply({ type: 'tick', tick: tick + 2, simTime: '', paused: false, speed: 4 });
    expect(store.speechFor('agt_lyra')).toBeNull();
    expect(store.state.speech.has('agt_lyra')).toBe(false);
  });

  it('gives snapshot speech an implicit ttl', () => {
    const { store } = storeWithSnapshot();
    const bubble = store.state.speech.get('agt_hermes');
    expect(bubble?.expiresAtTick).toBe(store.tick + IMPLICIT_SPEECH_TTL_TICKS);
  });

  it('caps the log at MAX_LOG_LINES and logs sales, milestones and rejections', () => {
    const { store } = storeWithSnapshot();
    for (let i = 0; i < MAX_LOG_LINES + 50; i++) {
      store.apply({ type: 'log', level: 'debug', message: `line ${i}`, tick: i });
    }
    expect(store.state.logs).toHaveLength(MAX_LOG_LINES);
    expect(store.state.logs[0]?.message).toBe('line 50');
    store.apply({ type: 'sale', ventureId: 'ven_vega01', listingId: 'x', platform: 'etsy', grossCents: 2499, netCents: 900, itemTitle: 'Tee', tick: 1 });
    expect(store.state.logs.at(-1)?.message).toContain('Tee');
    store.apply({ type: 'command.rejected', reason: 'nope' });
    expect(store.state.lastRejection).toBe('nope');
    expect(store.state.logs.at(-1)?.level).toBe('warn');
  });

  it('marks milestones and upserts entities', () => {
    const { store } = storeWithSnapshot();
    const station = store.station;
    if (station === null) throw new Error('no station');
    const unmet = station.treasury.milestones.find((m) => m.reachedAtTick === undefined);
    if (unmet === undefined) throw new Error('all milestones reached');
    store.apply({ type: 'milestone.reached', label: unmet.label, cents: unmet.cents, tick: 999 });
    expect(unmet.reachedAtTick).toBe(999);

    const venture = station.ventures[0];
    if (venture === undefined) throw new Error('no venture');
    store.apply({ type: 'venture.upserted', venture: { ...venture, status: 'killed' } });
    expect(store.ventureById(venture.id)?.status).toBe('killed');
    expect(station.ventures.filter((v) => v.id === venture.id)).toHaveLength(1);
    store.apply({ type: 'venture.removed', ventureId: venture.id });
    expect(store.ventureById(venture.id)).toBeUndefined();
  });

  it('notifies subscribers and typed event listeners', () => {
    const { store } = storeWithSnapshot();
    let notified = 0;
    let sales = 0;
    store.subscribe(() => notified++);
    store.on('sale', () => sales++);
    store.apply({ type: 'sale', ventureId: 'v', listingId: 'l', platform: 'mock', grossCents: 1, netCents: 1, itemTitle: 'x', tick: 1 });
    store.apply({ type: 'overseer.thinking', text: 'hmm' });
    expect(notified).toBe(2);
    expect(sales).toBe(1);
    expect(store.state.overseerThinking).toBe('hmm');
  });

  it('keeps room selection toggleable and drops selection of vanished agents', () => {
    const { store } = storeWithSnapshot();
    store.selectRoom('core');
    expect(store.state.ui.selectedRoomId).toBe('core');
    store.selectRoom('core');
    expect(store.state.ui.selectedRoomId).toBeNull();
    store.selectAgent('agt_lyra');
    expect(store.state.ui.followSelected).toBe(true);
    const next = createMockState();
    next.agents = next.agents.filter((a) => a.id !== 'agt_lyra');
    store.apply({ type: 'snapshot', state: next });
    expect(store.state.ui.selectedAgentId).toBeNull();
  });
});
