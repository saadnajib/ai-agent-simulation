/**
 * The Airlock: human approval queue. Nothing that publishes, spends, creates
 * accounts or moves money proceeds without a decision here. In sim mode
 * low-risk requests auto-approve after a short delay unless AUTO_APPROVE is
 * off; medium and high always wait for a human.
 */
import type { ApprovalRequest, RiskLevel } from '@eternity/core';
import type { ApprovalInput } from './brains/types.js';
import type { World } from './state.js';

export const AUTO_APPROVE_AFTER_TICKS = 6;
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export type Decision = 'approved' | 'rejected';
export type DecisionHandler = (approval: ApprovalRequest, decision: Decision) => void;

export interface AirlockOptions {
  autoApprove: boolean;
  autoApproveAfterTicks?: number;
}

export interface RequestInput extends ApprovalInput {
  requestedBy: string;
  ventureId?: string;
  taskId?: string;
}

export class Airlock {
  private readonly handlers = new Set<DecisionHandler>();
  private readonly waiters = new Map<string, (approval: ApprovalRequest) => void>();
  private readonly delay: number;

  constructor(
    private readonly world: World,
    private readonly opts: AirlockOptions,
  ) {
    this.delay = opts.autoApproveAfterTicks ?? AUTO_APPROVE_AFTER_TICKS;
  }

  onDecision(handler: DecisionHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  request(input: RequestInput): ApprovalRequest {
    const approval: ApprovalRequest = {
      id: this.world.id('apr'),
      kind: input.kind,
      risk: input.risk,
      title: input.title,
      summary: input.summary,
      requestedBy: input.requestedBy,
      payload: input.payload,
      status: 'pending',
      requestedAtTick: this.world.tick,
    };
    if (input.ventureId) approval.ventureId = input.ventureId;
    if (input.taskId) approval.taskId = input.taskId;
    if (input.listingId) approval.listingId = input.listingId;
    if (input.manualInstructions) approval.manualInstructions = input.manualInstructions;
    this.world.putApproval(approval, 'approval.requested');
    this.world.log('info', `Airlock: ${approval.title} (${approval.risk} risk) awaits approval`, approval.requestedBy);
    return approval;
  }

  /** Promise-flavoured request used by brains: resolves when decided. */
  requestAndWait(input: RequestInput): Promise<ApprovalRequest> {
    const approval = this.request(input);
    return new Promise((resolve) => {
      this.waiters.set(approval.id, resolve);
    });
  }

  pending(): ApprovalRequest[] {
    return [...this.world.approvals.values()].filter((a) => a.status === 'pending');
  }

  decide(id: string, decision: Decision, note?: string, by = 'human'): { ok: true; approval: ApprovalRequest } | { ok: false; reason: string } {
    const approval = this.world.approvals.get(id);
    if (!approval) return { ok: false, reason: `Unknown approval ${id}` };
    if (approval.status !== 'pending') return { ok: false, reason: `Approval ${id} is already ${approval.status}` };
    approval.status = decision;
    approval.decidedAt = this.world.now();
    if (note) approval.note = note;
    this.world.putApproval(approval, 'approval.decided');
    this.world.log('info', `Airlock: ${approval.title} ${decision} by ${by}`);
    const waiter = this.waiters.get(id);
    if (waiter) {
      this.waiters.delete(id);
      waiter(approval);
    }
    for (const handler of this.handlers) handler(approval, decision);
    return { ok: true, approval };
  }

  decideAll(decision: Decision, maxRisk: RiskLevel, by = 'human'): number {
    let count = 0;
    for (const approval of this.pending()) {
      if (RISK_RANK[approval.risk] > RISK_RANK[maxRisk]) continue;
      const result = this.decide(approval.id, decision, undefined, by);
      if (result.ok) count++;
    }
    return count;
  }

  /** Sim-mode auto approval of aged low-risk requests. */
  tick(): void {
    if (this.world.mode !== 'sim' || !this.opts.autoApprove) return;
    for (const approval of this.pending()) {
      if (approval.risk !== 'low') continue;
      if (this.world.tick - approval.requestedAtTick < this.delay) continue;
      this.decide(approval.id, 'approved', 'auto-approved (sim, low risk)', 'auto');
    }
  }
}
