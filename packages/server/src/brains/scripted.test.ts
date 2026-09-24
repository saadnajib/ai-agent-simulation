import { afterEach, describe, expect, it } from 'vitest';
import type { Task, TaskKind, TaskOutput } from '@eternity/core';
import { createRng } from '@eternity/core';
import { TaskOutputSchema } from './types.js';
import { REVIEW_QUALITY_CENTRE, ScriptedBrain, sampleReviewQuality } from './scripted.js';
import { fakeAgent, fakeContext, fakeVenture } from '../testUtil.js';

const KINDS: TaskKind[] = [
  'research-niche',
  'analyse-competitors',
  'design-artwork',
  'create-mockups',
  'create-asset-pack',
  'design-thumbnail',
  'write-article',
  'build-template',
  'compose-track',
  'write-listing',
  'publish-listing',
  'fulfil-order',
  'optimise-listing',
  'promote',
  'review-output',
  'overseer-epoch',
];

const REQUIRED_KEYS: Record<TaskKind, string[]> = {
  'research-niche': ['niche', 'demandScore', 'competition', 'keywords', 'suggestedPriceCents', 'rationale'],
  'analyse-competitors': ['niche', 'competitors', 'gap'],
  'design-artwork': ['title', 'description', 'niche', 'files', 'specs'],
  'create-mockups': ['productType', 'files', 'provider'],
  'create-asset-pack': ['title', 'description', 'niche', 'files', 'specs'],
  'design-thumbnail': ['title', 'description', 'niche', 'files', 'specs'],
  'write-article': ['title', 'slug', 'wordCount', 'affiliateLinks', 'files'],
  'build-template': ['title', 'description', 'niche', 'files', 'specs'],
  'compose-track': ['title', 'description', 'niche', 'files', 'specs'],
  'write-listing': ['listing'],
  'publish-listing': ['listingId'],
  'fulfil-order': ['orderId', 'deliverables'],
  'optimise-listing': ['listingId', 'changes'],
  promote: ['channel', 'posts'],
  'review-output': ['quality', 'approved', 'notes', 'targetTaskId'],
  'overseer-epoch': ['directiveId'],
};

function taskOf(kind: TaskKind, input: Record<string, unknown> = {}): Task {
  return {
    id: `task_${kind}`,
    kind,
    title: kind,
    ventureId: 'ven_test0001',
    roomId: 'print-foundry',
    role: 'designer',
    status: 'in-progress',
    priority: 50,
    input: { thesis: 'vintage botanical cat tees', ventureKind: 'pod-store', batchIndex: 0, batchSize: 3, ...input },
    dependsOn: [],
    estimateCents: 5,
    costCents: 0,
    attempts: 1,
    createdAtTick: 0,
  };
}

describe('ScriptedBrain', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const fn of cleanups.splice(0)) fn();
  });

  it('produces a valid TaskOutput with the contract data shape for every TaskKind', async () => {
    const brain = new ScriptedBrain();
    const rng = createRng(42);
    const research: TaskOutput = { summary: 'r', files: [], data: { niche: 'vintage botanical cat tees', keywords: ['cat', 'tee'], suggestedPriceCents: 2499 } };
    for (const kind of KINDS) {
      const fake = fakeContext(rng.fork(kind), fakeVenture(kind === 'write-article' ? 'affiliate-blog' : 'pod-store'), fakeAgent(), { task_research: research });
      cleanups.push(fake.cleanup);
      const output = await brain.run(taskOf(kind, { researchRef: 'task_research', listingRef: 'task_research' }), fake.ctx);
      expect(TaskOutputSchema.safeParse(output).success, kind).toBe(true);
      for (const key of REQUIRED_KEYS[kind]) expect(output.data, `${kind}.${key}`).toHaveProperty(key);
      for (const file of output.files) expect(fake.ctx.workspace.list(), `${kind} wrote ${file}`).toContain(file);
      expect(fake.speech.length, `${kind} speaks`).toBeGreaterThanOrEqual(2);
    }
  });

  it('writes an SVG containing the thesis text and a ~600 word article', async () => {
    const brain = new ScriptedBrain();
    const design = fakeContext(createRng(1), fakeVenture(), fakeAgent());
    cleanups.push(design.cleanup);
    const art = await brain.run(taskOf('design-artwork'), design.ctx);
    const svg = design.ctx.workspace.read(art.files[0]!);
    expect(svg).toContain('<svg');
    expect(svg.toLowerCase()).toContain('botanical');

    const writer = fakeContext(createRng(2), fakeVenture('affiliate-blog'), fakeAgent('writer'));
    cleanups.push(writer.cleanup);
    const article = await brain.run(taskOf('write-article', { thesis: 'budget espresso machines under $300' }), writer.ctx);
    const words = article.data['wordCount'] as number;
    expect(words).toBeGreaterThan(450);
    expect(words).toBeLessThan(900);
    expect(writer.ctx.workspace.read(article.files[0]!)).toContain('Disclosure');
  });

  it('is deterministic under a seed', async () => {
    const brain = new ScriptedBrain();
    const a = fakeContext(createRng(7), fakeVenture(), fakeAgent());
    const b = fakeContext(createRng(7), fakeVenture(), fakeAgent());
    cleanups.push(a.cleanup, b.cleanup);
    const outA = await brain.run(taskOf('research-niche'), a.ctx);
    const outB = await brain.run(taskOf('research-niche'), b.ctx);
    expect(outA).toEqual(outB);
  });

  it('samples review quality around the kind centre inside the documented band', () => {
    const rng = createRng(3);
    const samples = Array.from({ length: 500 }, () => sampleReviewQuality('game-assets', rng));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(Math.abs(mean - REVIEW_QUALITY_CENTRE['game-assets'])).toBeLessThan(0.03);
    for (const q of samples) {
      expect(q).toBeGreaterThanOrEqual(0.3);
      expect(q).toBeLessThanOrEqual(0.95);
    }
  });
});
