import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, chooseSpawnKind, computeShares, planEpoch, softmax } from './allocation.js';
import { createRng } from './rng.js';
import { VENTURE_KINDS, type OverseerAction } from './types.js';
import { makeState, makeVenture } from './testFixtures.js';

const TICK = 1000;

function shareActions(actions: OverseerAction[]) {
  return actions.filter((a): a is Extract<OverseerAction, { type: 'set-budget-share' }> => a.type === 'set-budget-share');
}

function statusActions(actions: OverseerAction[]) {
  return actions.filter((a): a is Extract<OverseerAction, { type: 'set-status' }> => a.type === 'set-status');
}

describe('DEFAULT_POLICY', () => {
  it('matches the contract values', () => {
    expect(DEFAULT_POLICY).toEqual({
      epochTicks: 24,
      windowTicks: 168,
      explorationFloor: 0.05,
      graceTicks: 72,
      killRoiThreshold: -0.5,
      killNoSaleTicks: 240,
      scaleRoiThreshold: 0.5,
      maxVentures: 8,
      maxCrewPerVenture: 3,
    });
  });
});

describe('softmax and shares', () => {
  it('softmax weights sum to 1 and favour the higher score', () => {
    const w = softmax([-1, 0, 3]);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(w[2]!).toBeGreaterThan(w[1]!);
    expect(w[1]!).toBeGreaterThan(w[0]!);
    expect(softmax([])).toEqual([]);
  });

  it('shares sum to 1 and respect the exploration floor', () => {
    const ventures = [-0.9, -0.2, 0.4, 1.5, 9].map((roi, i) =>
      makeVenture({ id: `v${i}`, metrics: { trailingRoi: roi, trailingCostCents: 100 } }),
    );
    const shares = computeShares(ventures, TICK, DEFAULT_POLICY);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (const s of shares) expect(s).toBeGreaterThanOrEqual(DEFAULT_POLICY.explorationFloor - 1e-9);
    expect(shares[4]!).toBeGreaterThan(shares[3]!);
  });

  it('gives ventures in grace the mean matured score', () => {
    const ventures = [
      makeVenture({ id: 'old-low', metrics: { trailingRoi: -1 } }),
      makeVenture({ id: 'old-high', metrics: { trailingRoi: 1 } }),
      makeVenture({ id: 'young', createdAtTick: TICK - 10, metrics: { trailingRoi: 5 } }),
    ];
    const shares = computeShares(ventures, TICK, DEFAULT_POLICY);
    expect(shares[2]!).toBeGreaterThan(shares[0]!);
    expect(shares[2]!).toBeLessThan(shares[1]!);
  });
});

describe('planEpoch', () => {
  it('emits shares that sum to 1 across scored ventures', () => {
    const ventures = VENTURE_KINDS.map((kind, i) =>
      makeVenture({ id: `v${i}`, kind, metrics: { trailingRoi: i * 0.3 - 0.4, ticksSinceLastSale: 10 } }),
    );
    const actions = planEpoch(makeState(ventures, TICK), createRng('epoch'));
    const shares = shareActions(actions);
    expect(shares).toHaveLength(ventures.length);
    expect(shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 9);
  });

  it('kills a venture with negative ROI past grace but spares one still in grace', () => {
    const ventures = [
      makeVenture({ id: 'loser', createdAtTick: 0, metrics: { trailingRoi: -0.9, ticksSinceLastSale: 10 } }),
      makeVenture({ id: 'baby', createdAtTick: TICK - 20, metrics: { trailingRoi: -0.9 } }),
    ];
    const actions = planEpoch(makeState(ventures, TICK), createRng('kill'));
    const statuses = statusActions(actions);
    expect(statuses.find((a) => a.ventureId === 'loser')?.status).toBe('killed');
    expect(statuses.find((a) => a.ventureId === 'loser')?.reason).toMatch(/ROI/);
    expect(statuses.find((a) => a.ventureId === 'baby')).toBeUndefined();
    expect(shareActions(actions).map((a) => a.ventureId)).toEqual(['baby']);
    expect(shareActions(actions)[0]!.share).toBeCloseTo(1, 9);
  });

  it('kills a venture that has gone too long without a sale, including one that never sold', () => {
    const ventures = [
      makeVenture({ id: 'stale', metrics: { trailingRoi: 0, ticksSinceLastSale: 300 } }),
      makeVenture({ id: 'never', createdAtTick: TICK - 500, metrics: { trailingRoi: 0, ticksSinceLastSale: null } }),
      makeVenture({ id: 'fresh', metrics: { trailingRoi: 0, ticksSinceLastSale: 100 } }),
    ];
    const statuses = statusActions(planEpoch(makeState(ventures, TICK), createRng('stale')));
    expect(statuses.find((a) => a.ventureId === 'stale')?.status).toBe('killed');
    expect(statuses.find((a) => a.ventureId === 'never')?.status).toBe('killed');
    expect(statuses.find((a) => a.ventureId === 'fresh')).toBeUndefined();
  });

  it('never kills or funds a paused venture', () => {
    const ventures = [
      makeVenture({ id: 'paused', status: 'paused', metrics: { trailingRoi: -1, ticksSinceLastSale: 9999 } }),
      makeVenture({ id: 'ok', metrics: { trailingRoi: 0.1, ticksSinceLastSale: 5 } }),
    ];
    const actions = planEpoch(makeState(ventures, TICK), createRng('paused'));
    expect(statusActions(actions).some((a) => a.ventureId === 'paused')).toBe(false);
    expect(shareActions(actions).map((a) => a.ventureId)).toEqual(['ok']);
  });

  it('promotes strong ROI to scaling, demotes scaling that slipped, and gives scaling the largest share', () => {
    const ventures = [
      makeVenture({ id: 'star', metrics: { trailingRoi: 2, ticksSinceLastSale: 1 } }),
      makeVenture({ id: 'slipped', status: 'scaling', metrics: { trailingRoi: 0.1, ticksSinceLastSale: 1 } }),
      makeVenture({ id: 'meh', metrics: { trailingRoi: 0, ticksSinceLastSale: 1 } }),
    ];
    const actions = planEpoch(makeState(ventures, TICK), createRng('scale'));
    const statuses = statusActions(actions);
    expect(statuses.find((a) => a.ventureId === 'star')?.status).toBe('scaling');
    expect(statuses.find((a) => a.ventureId === 'slipped')?.status).toBe('active');
    const shares = shareActions(actions);
    const top = shares.reduce((best, s) => (s.share > best.share ? s : best));
    expect(top.ventureId).toBe('star');
  });

  it('spawns one venture below maxVentures and none at the cap', () => {
    const rng = createRng('spawn');
    const few = planEpoch(makeState([makeVenture({ id: 'a' })], TICK), rng);
    const spawns = few.filter((a) => a.type === 'spawn-venture');
    expect(spawns).toHaveLength(1);
    const spawn = spawns[0]!;
    if (spawn.type !== 'spawn-venture') throw new Error('unreachable');
    expect(VENTURE_KINDS).toContain(spawn.kind);
    expect(spawn.thesis.length).toBeGreaterThan(3);
    expect(spawn.name.length).toBeGreaterThan(0);

    const full = Array.from({ length: DEFAULT_POLICY.maxVentures }, (_, i) =>
      makeVenture({ id: `v${i}`, status: i % 2 === 0 ? 'paused' : 'active', metrics: { ticksSinceLastSale: 1 } }),
    );
    expect(planEpoch(makeState(full, TICK), rng).some((a) => a.type === 'spawn-venture')).toBe(false);
  });

  it('counts a venture killed this epoch as freeing a slot', () => {
    const full = Array.from({ length: DEFAULT_POLICY.maxVentures }, (_, i) =>
      makeVenture({ id: `v${i}`, metrics: { trailingRoi: i === 0 ? -1 : 0, ticksSinceLastSale: 1 } }),
    );
    const actions = planEpoch(makeState(full, TICK), createRng('slot'));
    expect(statusActions(actions).filter((a) => a.status === 'killed')).toHaveLength(1);
    expect(actions.filter((a) => a.type === 'spawn-venture')).toHaveLength(1);
  });

  it('spawns in the best-performing kind, breaking ties toward the least represented kind', () => {
    const alive = [
      makeVenture({ id: 'a', kind: 'pod-store', metrics: { trailingRoi: 1.2 } }),
      makeVenture({ id: 'b', kind: 'game-assets', metrics: { trailingRoi: -0.3 } }),
    ];
    expect(chooseSpawnKind(alive, createRng('k'))).toBe('pod-store');

    const tie = [
      makeVenture({ id: 'a', kind: 'pod-store', metrics: { trailingRoi: 0 } }),
      makeVenture({ id: 'b', kind: 'game-assets', metrics: { trailingRoi: 0 } }),
    ];
    const chosen = chooseSpawnKind(tie, createRng('k'));
    expect(['pod-store', 'game-assets']).not.toContain(chosen);
  });

  it('ends with exactly one broadcast summarising the epoch', () => {
    const actions = planEpoch(makeState([makeVenture({ id: 'a', name: 'Vega Prints' })], TICK), createRng('b'));
    const broadcasts = actions.filter((a) => a.type === 'broadcast');
    expect(broadcasts).toHaveLength(1);
    expect(actions[actions.length - 1]).toBe(broadcasts[0]);
    const b = broadcasts[0]!;
    if (b.type !== 'broadcast') throw new Error('unreachable');
    expect(b.message).toContain('Vega Prints');
    expect(b.message).toMatch(/^Epoch at tick 1000: .*\.$/);
  });

  it('is deterministic for the same seed', () => {
    const state = makeState([makeVenture({ id: 'a' })], TICK);
    expect(planEpoch(state, createRng('d'))).toEqual(planEpoch(state, createRng('d')));
  });
});
