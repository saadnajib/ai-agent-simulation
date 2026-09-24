/**
 * The deterministic half of HERMES: capital allocation across ventures.
 *
 * Each epoch:
 * 1. Score every non-killed, non-paused venture from trailing ROI (softmax);
 *    ventures still in their grace period get the mean score.
 * 2. Shares = explorationFloor + (1 - n*floor) * softmax. Emit set-budget-share.
 * 3. Kill rule (after grace): trailingRoi < killRoiThreshold or no sale for
 *    longer than killNoSaleTicks -> set-status killed.
 * 4. Scale rule: trailingRoi >= scaleRoiThreshold -> scaling; demote
 *    scaling -> active when it drops below.
 * 5. If fewer than maxVentures ventures are alive, spawn one in the kind with
 *    the best mean trailing ROI (ties -> least represented).
 * 6. One broadcast summarising the epoch.
 */
import type { AllocationPolicy, OverseerAction, StationState, Venture, VentureKind } from './types.js';
import { VENTURE_KINDS } from './types.js';
import { PLAYBOOKS, ventureNameFor } from './playbooks.js';
import type { Rng } from './rng.js';
import { formatCents } from './ledger.js';

export const DEFAULT_POLICY: AllocationPolicy = {
  epochTicks: 24,
  windowTicks: 168,
  explorationFloor: 0.05,
  // Two simulated weeks: the fastest honest signal a new store can give.
  graceTicks: 336,
  killRoiThreshold: -0.5,
  // Three weeks without a sale after the grace period is a dead niche, not bad luck.
  killNoSaleTicks: 504,
  scaleRoiThreshold: 0.5,
  maxVentures: 8,
  maxVenturesPerKind: 3,
  maxCrewPerVenture: 3,
};

/** Softmax temperature over clamped trailing ROI. */
export const SOFTMAX_TEMPERATURE = 0.5;
export const ROI_CLAMP_MIN = -1;
export const ROI_CLAMP_MAX = 3;

function clampRoi(roi: number): number {
  if (!Number.isFinite(roi)) return ROI_CLAMP_MIN;
  return Math.min(ROI_CLAMP_MAX, Math.max(ROI_CLAMP_MIN, roi));
}

function ageOf(venture: Venture, tick: number): number {
  return Math.max(0, tick - venture.createdAtTick);
}

function inGrace(venture: Venture, tick: number, policy: AllocationPolicy): boolean {
  return ageOf(venture, tick) < policy.graceTicks;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Softmax over scores with the module temperature; returns weights summing to 1. */
export function softmax(scores: readonly number[], temperature = SOFTMAX_TEMPERATURE): number[] {
  if (scores.length === 0) return [];
  const t = Math.max(1e-6, temperature);
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - max) / t));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/** Budget shares for the given ventures: floor plus softmax of the remainder. Sums to 1. */
export function computeShares(ventures: readonly Venture[], tick: number, policy: AllocationPolicy): number[] {
  const n = ventures.length;
  if (n === 0) return [];
  const matured = ventures.filter((v) => !inGrace(v, tick, policy)).map((v) => clampRoi(v.metrics.trailingRoi));
  const graceScore = mean(matured);
  const scores = ventures.map((v) => (inGrace(v, tick, policy) ? graceScore : clampRoi(v.metrics.trailingRoi)));
  const weights = softmax(scores);
  const floor = Math.min(policy.explorationFloor, 1 / n);
  const remainder = Math.max(0, 1 - n * floor);
  return weights.map((w) => floor + remainder * w);
}

interface KillDecision {
  venture: Venture;
  reason: string;
}

function killDecision(venture: Venture, tick: number, policy: AllocationPolicy): KillDecision | null {
  if (inGrace(venture, tick, policy)) return null;
  const m = venture.metrics;
  const age = ageOf(venture, tick);
  // A venture that has never put anything on sale cannot be judged on ROI yet,
  // but one that still has nothing live after two grace periods is stalled.
  if (m.unitsPublished === 0) {
    if (age >= policy.graceTicks * 2) {
      return { venture, reason: `Nothing published after ${age} ticks (spent ${formatCents(m.costCents)}); the pipeline is stalled.` };
    }
    return null;
  }
  if (m.trailingRoi < policy.killRoiThreshold) {
    return {
      venture,
      reason: `Trailing ROI ${m.trailingRoi.toFixed(2)} below kill threshold ${policy.killRoiThreshold} after ${ageOf(venture, tick)} ticks (spent ${formatCents(m.trailingCostCents)}, earned ${formatCents(m.trailingRevenueCents)}).`,
    };
  }
  const sinceSale = m.ticksSinceLastSale ?? ageOf(venture, tick);
  if (sinceSale > policy.killNoSaleTicks) {
    const never = m.ticksSinceLastSale === null;
    return {
      venture,
      reason: never
        ? `No sale in ${sinceSale} ticks since launch (limit ${policy.killNoSaleTicks}).`
        : `No sale for ${sinceSale} ticks (limit ${policy.killNoSaleTicks}).`,
    };
  }
  return null;
}

function statusActions(venture: Venture, policy: AllocationPolicy): OverseerAction[] {
  const roi = venture.metrics.trailingRoi;
  if (roi >= policy.scaleRoiThreshold && venture.status !== 'scaling') {
    return [
      {
        type: 'set-status',
        ventureId: venture.id,
        status: 'scaling',
        reason: `Trailing ROI ${roi.toFixed(2)} at or above scale threshold ${policy.scaleRoiThreshold}; doubling down.`,
      },
    ];
  }
  if (roi < policy.scaleRoiThreshold && venture.status === 'scaling') {
    return [
      {
        type: 'set-status',
        ventureId: venture.id,
        status: 'active',
        reason: `Trailing ROI ${roi.toFixed(2)} fell below scale threshold ${policy.scaleRoiThreshold}; back to normal budget.`,
      },
    ];
  }
  return [];
}

/**
 * Kind with the best mean trailing ROI among live ventures; ties go to the
 * least represented kind. Kinds already at `maxVenturesPerKind` are skipped.
 * Returns null when every kind is at its cap.
 */
export function chooseSpawnKind(alive: readonly Venture[], rng: Rng, policy: AllocationPolicy = DEFAULT_POLICY): VentureKind | null {
  const byKind = new Map<VentureKind, number[]>();
  for (const kind of VENTURE_KINDS) byKind.set(kind, []);
  for (const v of alive) byKind.get(v.kind)?.push(clampRoi(v.metrics.trailingRoi));

  let best: VentureKind[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const kind of VENTURE_KINDS) {
    const rois = byKind.get(kind) ?? [];
    if (rois.length >= policy.maxVenturesPerKind) continue;
    const score = mean(rois);
    const count = rois.length;
    if (score > bestScore + 1e-9) {
      best = [kind];
      bestScore = score;
      bestCount = count;
    } else if (Math.abs(score - bestScore) <= 1e-9) {
      if (count < bestCount) {
        best = [kind];
        bestCount = count;
      } else if (count === bestCount) {
        best.push(kind);
      }
    }
  }
  if (best.length === 0) return null;
  return best.length === 1 ? (best[0] as VentureKind) : rng.pick(best);
}

function spawnAction(alive: readonly Venture[], all: readonly Venture[], rng: Rng, policy: AllocationPolicy): OverseerAction | null {
  const kind = chooseSpawnKind(alive, rng, policy);
  if (kind === null) return null;
  const playbook = PLAYBOOKS[kind];
  // Do not re-run a thesis that is live or that already failed.
  const takenTheses = new Set(all.map((v) => v.thesis.toLowerCase()));
  let thesis = playbook.suggestThesis(rng);
  for (let attempt = 0; attempt < 16 && takenTheses.has(thesis.toLowerCase()); attempt++) {
    thesis = playbook.suggestThesis(rng);
  }
  const name = ventureNameFor(kind, rng, all.map((v) => v.name));
  return { type: 'spawn-venture', kind, thesis, name };
}

function summarise(
  tick: number,
  scored: readonly Venture[],
  shares: readonly number[],
  kills: readonly KillDecision[],
  promoted: number,
  demoted: number,
  spawned: OverseerAction | null,
): string {
  const parts: string[] = [];
  if (scored.length === 0) parts.push('no ventures to fund');
  else {
    let top = 0;
    for (let i = 1; i < shares.length; i++) if ((shares[i] as number) > (shares[top] as number)) top = i;
    const leader = scored[top] as Venture;
    parts.push(`funded ${scored.length} venture${scored.length === 1 ? '' : 's'} with ${leader.name} leading at ${Math.round((shares[top] as number) * 100)}%`);
  }
  if (kills.length > 0) parts.push(`killed ${kills.map((k) => k.venture.name).join(', ')}`);
  if (promoted > 0) parts.push(`scaled ${promoted}`);
  if (demoted > 0) parts.push(`demoted ${demoted}`);
  if (spawned !== null && spawned.type === 'spawn-venture') parts.push(`spawned ${spawned.name} (${spawned.kind}: ${spawned.thesis})`);
  return `Epoch at tick ${tick}: ${parts.join('; ')}.`;
}

export function planEpoch(state: StationState, rng: Rng): OverseerAction[] {
  const policy = state.policy;
  const tick = state.clock.tick;
  const actions: OverseerAction[] = [];

  const alive = state.ventures.filter((v) => v.status !== 'killed');
  const candidates = alive.filter((v) => v.status !== 'paused');

  // Step 3 is decided first so killed ventures do not receive a budget share.
  const kills = candidates.map((v) => killDecision(v, tick, policy)).filter((k): k is KillDecision => k !== null);
  const killedIds = new Set(kills.map((k) => k.venture.id));
  const scored = candidates.filter((v) => !killedIds.has(v.id));

  // Steps 1 and 2.
  const shares = computeShares(scored, tick, policy);
  scored.forEach((v, i) => actions.push({ type: 'set-budget-share', ventureId: v.id, share: shares[i] as number }));

  // Step 3.
  for (const k of kills) {
    actions.push({ type: 'set-status', ventureId: k.venture.id, status: 'killed', reason: k.reason });
  }

  // Step 4.
  let promoted = 0;
  let demoted = 0;
  for (const v of scored) {
    for (const action of statusActions(v, policy)) {
      if (action.type === 'set-status' && action.status === 'scaling') promoted++;
      else demoted++;
      actions.push(action);
    }
  }

  // Step 5.
  const survivors = alive.filter((v) => !killedIds.has(v.id));
  let spawned: OverseerAction | null = null;
  if (survivors.length < policy.maxVentures) {
    spawned = spawnAction(survivors, state.ventures, rng, policy);
    if (spawned !== null) actions.push(spawned);
  }

  // Step 6.
  actions.push({ type: 'broadcast', message: summarise(tick, scored, shares, kills, promoted, demoted, spawned) });
  return actions;
}
