/**
 * OverseerEngine: runs the deterministic allocator every epoch and, in live
 * mode, lets the Claude Overseer adjust the plan within policy bounds.
 */
import type { OverseerAction, OverseerDirective, StationState, Venture } from '@eternity/core';
import { formatCents, planEpoch, tokenCostCents } from '@eternity/core';
import type { AdapterRegistry } from '@eternity/adapters';
import type { World } from '../state.js';
import { aliveVentures, applyOverseerAction, refreshMetrics, renormaliseShares, type CancelTask } from '../ventures.js';
import type { ClaudeOverseer, OverseerProposal } from './claude.js';

export interface EngineOptions {
  registry: AdapterRegistry;
  cancel: CancelTask;
  hermesId: string;
  claude?: ClaudeOverseer | null;
}

export class OverseerEngine {
  private readonly registry: AdapterRegistry;
  private readonly cancel: CancelTask;
  private readonly hermesId: string;
  private readonly claude: ClaudeOverseer | null;

  constructor(
    private readonly world: World,
    opts: EngineOptions,
  ) {
    this.registry = opts.registry;
    this.cancel = opts.cancel;
    this.hermesId = opts.hermesId;
    this.claude = opts.claude ?? null;
  }

  async runEpoch(): Promise<OverseerDirective> {
    const world = this.world;
    refreshMetrics(world);
    const state = world.state();
    const deterministic = planEpoch(state, world.rng('epoch'));
    const instructions = [...world.instructions];
    let actions = deterministic;
    let rationale = this.deterministicRationale(state, deterministic);

    if (this.claude) {
      world.bus.emit({ type: 'overseer.thinking', text: 'HERMES is reviewing the epoch metrics.' });
      const result = await this.claude.propose({
        tick: world.tick,
        summary: this.summary(state),
        deterministicActions: deterministic,
        instructions,
        policyText: JSON.stringify(world.policy),
      });
      if (result.tokensIn + result.tokensOut > 0) this.billOverseer(result.tokensIn, result.tokensOut);
      if (result.proposal) {
        actions = this.merge(deterministic, result.proposal, state);
        rationale = `${result.proposal.rationale.trim()}\n\n${rationale}`;
      } else if (result.error) {
        world.log('warn', `HERMES advisor unavailable (${result.error}); deterministic plan applied`, this.hermesId);
      }
    } else if (instructions.length > 0) {
      rationale += ` Operator notes acknowledged: ${instructions.map((t) => `"${t}"`).join('; ')}.`;
    }

    const applied: OverseerAction[] = [];
    for (const action of actions) {
      const outcome = applyOverseerAction(world, this.registry, action, this.cancel);
      if (outcome !== null) applied.push(action);
    }
    renormaliseShares(world);
    refreshMetrics(world);
    world.instructions = [];
    world.markMeta();

    const directive: OverseerDirective = { id: world.id('dir'), tick: world.tick, rationale, actions: applied };
    world.pushDirective(directive);
    world.bus.emit({ type: 'overseer.thinking', text: rationale });
    world.speak(this.hermesId, this.speechFor(applied), 10);
    return directive;
  }

  private billOverseer(tokensIn: number, tokensOut: number): void {
    const model = this.claude?.model ?? this.world.config.overseerModel;
    const cost = tokenCostCents(model, tokensIn, tokensOut);
    const hermes = this.world.agents.get(this.hermesId);
    if (hermes) {
      hermes.stats.tokensIn += tokensIn;
      hermes.stats.tokensOut += tokensOut;
      hermes.stats.costCents += cost;
      this.world.putAgent(hermes, false);
    }
    if (cost > 0) this.world.record({ kind: 'token-cost', amountCents: -cost, memo: `${model}: overseer epoch`, agentId: this.hermesId });
  }

  private deterministicRationale(state: StationState, actions: OverseerAction[]): string {
    const broadcast = actions.find((a): a is Extract<OverseerAction, { type: 'broadcast' }> => a.type === 'broadcast');
    const treasury = state.treasury;
    const eta = treasury.etaTicksToTarget === null ? 'never at current velocity' : `${Math.ceil(treasury.etaTicksToTarget / 24)} days`;
    return `${broadcast?.message ?? `Epoch at tick ${state.clock.tick}.`} Balance ${formatCents(treasury.balanceCents)}, daily profit ${formatCents(treasury.dailyProfitCents)}, ETA to target: ${eta}.`;
  }

  summary(state: StationState): string {
    const lines = aliveVentures(this.world).map((v) => ventureLine(v, state.clock.tick));
    const t = state.treasury;
    lines.unshift(
      `treasury: balance ${formatCents(t.balanceCents)}, lifetime revenue ${formatCents(t.lifetimeRevenueCents)}, lifetime cost ${formatCents(t.lifetimeCostCents)}, daily profit ${formatCents(t.dailyProfitCents)}, token budget left today ${formatCents(t.dailyTokenBudgetRemainingCents)}`,
      `pending approvals: ${state.approvals.filter((a) => a.status === 'pending').length}; crew: ${state.agents.filter((a) => a.status !== 'offline').length}; live listings: ${state.listings.filter((l) => l.status === 'live').length}`,
      `platform capabilities: ${this.registry
        .capabilities()
        .map((c) => `${c.platform}${c.connected ? '' : ' (not connected)'}`)
        .join(', ')}`,
    );
    return lines.join('\n');
  }

  /** Validates Claude's actions against policy and merges them over the deterministic plan. */
  private merge(deterministic: OverseerAction[], proposal: OverseerProposal, state: StationState): OverseerAction[] {
    const policy = this.world.policy;
    const tick = state.clock.tick;
    const ventures = new Map(state.ventures.map((v) => [v.id, v]));
    const merged: OverseerAction[] = [...deterministic];
    let alive = state.ventures.filter((v) => v.status !== 'killed').length;
    alive += deterministic.filter((a) => a.type === 'spawn-venture').length;
    alive -= deterministic.filter((a) => a.type === 'set-status' && a.status === 'killed').length;
    let crew = state.agents.filter((a) => a.status !== 'offline').length;

    for (const action of proposal.actions) {
      switch (action.type) {
        case 'set-budget-share': {
          const venture = ventures.get(action.ventureId);
          if (!venture || venture.status === 'killed' || venture.status === 'paused') break;
          const share = Math.max(policy.explorationFloor, Math.min(1, action.share));
          replaceOrPush(merged, (a) => a.type === 'set-budget-share' && a.ventureId === action.ventureId, { ...action, share });
          break;
        }
        case 'set-status': {
          const venture = ventures.get(action.ventureId);
          if (!venture || venture.status === 'killed') break;
          if (action.status === 'killed' && tick - venture.createdAtTick < policy.graceTicks) break;
          replaceOrPush(merged, (a) => a.type === 'set-status' && a.ventureId === action.ventureId, action);
          if (action.status === 'killed') alive -= 1;
          break;
        }
        case 'spawn-venture': {
          if (alive >= policy.maxVentures) break;
          merged.push(action);
          alive += 1;
          break;
        }
        case 'hire': {
          if (crew >= this.world.config.maxCrew || action.role === 'overseer') break;
          merged.push(action);
          crew += 1;
          break;
        }
        case 'broadcast':
          merged.push(action);
          break;
      }
    }
    return merged;
  }

  private speechFor(actions: OverseerAction[]): string {
    const kills = actions.filter((a) => a.type === 'set-status' && a.status === 'killed').length;
    const spawns = actions.filter((a) => a.type === 'spawn-venture').length;
    if (kills > 0) return `Cut ${kills} venture${kills > 1 ? 's' : ''}. Capital flows to what returns.`;
    if (spawns > 0) return 'New experiment funded. Show me a sale.';
    return 'Shares rebalanced. Keep shipping.';
  }
}

function replaceOrPush(list: OverseerAction[], match: (a: OverseerAction) => boolean, action: OverseerAction): void {
  const index = list.findIndex(match);
  if (index >= 0) list[index] = action;
  else list.push(action);
}

function ventureLine(v: Venture, tick: number): string {
  const m = v.metrics;
  return `${v.name} [${v.id}] kind=${v.kind} status=${v.status} age=${tick - v.createdAtTick}t share=${(v.budgetShare * 100).toFixed(1)}% revenue=${formatCents(m.revenueCents)} cost=${formatCents(m.costCents)} roi=${m.roi.toFixed(2)} trailingRoi=${m.trailingRoi.toFixed(2)} published=${m.unitsPublished} sold=${m.unitsSold} sinceLastSale=${m.ticksSinceLastSale ?? 'never'} crew=${v.crew.length} thesis="${v.thesis}"`;
}
