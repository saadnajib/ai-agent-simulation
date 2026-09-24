import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';
import { VENTURE_KINDS } from './types.js';
import { ROOM_SPECS } from './stationMap.js';
import { KIND_ECONOMICS } from './economics.js';
import {
  CYCLE_REF_PREFIX,
  PLAYBOOKS,
  instantiateCycle,
  isCycleRef,
  nichesFor,
  playbookFor,
  ventureNameFor,
} from './playbooks.js';
import { makeVenture } from './testFixtures.js';

const BANNED = /disney|nintendo|pokemon|marvel|star wars|lakers|yankees|beatles|taylor swift|harry potter/i;

describe('playbooks', () => {
  it('defines a playbook for every venture kind in its own room', () => {
    for (const kind of VENTURE_KINDS) {
      const pb = playbookFor(kind);
      expect(pb.kind).toBe(kind);
      expect(ROOM_SPECS[pb.roomId].ventureKind).toBe(kind);
      expect(pb.pipeline.length).toBeGreaterThanOrEqual(5);
      expect(pb.pipeline).toContain('review-output');
      expect(pb.pipeline).toContain('publish-listing');
      expect(pb.platforms.length).toBeGreaterThan(0);
      expect(pb.reviewCriteria.length).toBeGreaterThanOrEqual(4);
      expect(pb.roles).toContain('reviewer');
    }
  });

  it('suggests theses from a curated list of at least 12 niches with no trademarked IP', () => {
    for (const kind of VENTURE_KINDS) {
      const niches = nichesFor(kind);
      expect(niches.length).toBeGreaterThanOrEqual(12);
      expect(new Set(niches).size).toBe(niches.length);
      for (const n of niches) expect(n).not.toMatch(BANNED);
      const rng = createRng(`thesis-${kind}`);
      const seen = new Set<string>();
      for (let i = 0; i < 60; i++) seen.add(PLAYBOOKS[kind].suggestThesis(rng));
      expect(seen.size).toBeGreaterThan(6);
      for (const s of seen) expect(niches).toContain(s);
    }
  });

  it('builds a wired cycle whose dependencies all point backwards within the cycle', () => {
    for (const kind of VENTURE_KINDS) {
      const venture = makeVenture({ kind });
      const cycle = PLAYBOOKS[kind].buildCycle(venture, 100, createRng('cycle'));
      expect(cycle.length).toBeGreaterThanOrEqual(6);
      expect(cycle[0]!.kind).toBe('research-niche');
      expect(cycle[0]!.roomId).toBe('observatory');
      expect(cycle[0]!.dependsOn).toEqual([]);
      cycle.forEach((task, index) => {
        expect(task.ventureId).toBe(venture.id);
        expect(task.estimateCents).toBeGreaterThanOrEqual(0);
        expect(ROOM_SPECS[task.roomId].roles).toContain(task.role);
        for (const dep of task.dependsOn) {
          expect(isCycleRef(dep)).toBe(true);
          const target = Number.parseInt(dep.slice(CYCLE_REF_PREFIX.length), 10);
          expect(target).toBeLessThan(index);
        }
      });
      const publishes = cycle.filter((t) => t.kind === 'publish-listing');
      expect(publishes).toHaveLength(KIND_ECONOMICS[kind].unitsPerBatch);
      for (const p of publishes) {
        const review = cycle[Number.parseInt(p.dependsOn[0]!.slice(CYCLE_REF_PREFIX.length), 10)]!;
        expect(review.kind).toBe('review-output');
        expect(Array.isArray(review.input['criteria'])).toBe(true);
      }
      const promote = cycle[cycle.length - 1]!;
      expect(promote.kind).toBe('promote');
      expect(promote.roomId).toBe('broadcast-tower');
      expect(promote.dependsOn).toHaveLength(publishes.length);
    }
  });

  it('instantiates a cycle into queued tasks with real ids and resolved references', () => {
    const venture = makeVenture({ kind: 'pod-store' });
    const cycle = PLAYBOOKS['pod-store'].buildCycle(venture, 5, createRng('c'));
    const tasks = instantiateCycle(cycle, 5, createRng('ids'));
    expect(tasks).toHaveLength(cycle.length);
    const ids = new Set(tasks.map((t) => t.id));
    expect(ids.size).toBe(tasks.length);
    for (const task of tasks) {
      expect(task.status).toBe('queued');
      expect(task.attempts).toBe(0);
      expect(task.costCents).toBe(0);
      expect(task.createdAtTick).toBe(5);
      for (const dep of task.dependsOn) expect(ids.has(dep)).toBe(true);
      expect(JSON.stringify(task.input)).not.toContain(CYCLE_REF_PREFIX);
    }
    const review = tasks.find((t) => t.kind === 'review-output')!;
    expect(ids.has(review.input['targetRef'] as string)).toBe(true);
  });

  it('names ventures without reusing taken names', () => {
    const rng = createRng('names');
    const first = ventureNameFor('pod-store', rng);
    expect(first).toMatch(/ Prints$/);
    const second = ventureNameFor('pod-store', rng, [first]);
    expect(second).not.toBe(first);
  });
});
