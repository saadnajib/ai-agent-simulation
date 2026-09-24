/**
 * Thin ledger wrapper: keeps entries in memory in insertion order, hands new
 * entries to the persistence layer, and recomputes the Treasury through core.
 */
import type { LedgerEntry, LedgerKind, Milestone, Treasury } from '@eternity/core';
import { computeTreasury, DEFAULT_MILESTONES } from '@eternity/core';

export interface LedgerRecordInput {
  id: string;
  tick: number;
  kind: LedgerKind;
  amountCents: number;
  memo: string;
  source: 'sim' | 'live';
  ventureId?: string;
  agentId?: string;
  taskId?: string;
  listingId?: string;
  ts?: string;
}

export interface TreasuryInputs {
  targetCents: number;
  dailyTokenBudgetCents: number;
  startingBalanceCents?: number;
}

export class Ledger {
  private readonly entries: LedgerEntry[];
  private readonly onRecord: (entry: LedgerEntry) => void;
  private treasuryCache: { tick: number; target: number; value: Treasury } | null = null;

  constructor(initial: readonly LedgerEntry[], onRecord: (entry: LedgerEntry) => void) {
    this.entries = [...initial];
    this.onRecord = onRecord;
  }

  /** Appends persisted entries at boot without re-emitting them. */
  load(entries: readonly LedgerEntry[]): void {
    this.entries.push(...entries);
    this.treasuryCache = null;
  }

  record(input: LedgerRecordInput): LedgerEntry {
    if (!Number.isFinite(input.amountCents)) throw new RangeError('ledger amount must be finite');
    const entry: LedgerEntry = {
      id: input.id,
      tick: input.tick,
      ts: input.ts ?? new Date().toISOString(),
      kind: input.kind,
      amountCents: Math.round(input.amountCents),
      memo: input.memo,
      source: input.source,
    };
    if (input.ventureId) entry.ventureId = input.ventureId;
    if (input.agentId) entry.agentId = input.agentId;
    if (input.taskId) entry.taskId = input.taskId;
    if (input.listingId) entry.listingId = input.listingId;
    this.entries.push(entry);
    this.treasuryCache = null;
    this.onRecord(entry);
    return entry;
  }

  all(): readonly LedgerEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }

  recent(limit: number): LedgerEntry[] {
    return this.entries.slice(Math.max(0, this.entries.length - limit));
  }

  since(sinceTick: number, limit: number): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (const entry of this.entries) {
      if (entry.tick < sinceTick) continue;
      out.push(entry);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Token spend per venture inside [fromTick, toTick]. Ventureless spend lands under "". */
  tokenSpendByVenture(fromTick: number, toTick: number): Map<string, number> {
    const out = new Map<string, number>();
    for (const entry of this.entries) {
      if (entry.kind !== 'token-cost' || entry.tick < fromTick || entry.tick > toTick || entry.amountCents >= 0) continue;
      const key = entry.ventureId ?? '';
      out.set(key, (out.get(key) ?? 0) - entry.amountCents);
    }
    return out;
  }

  treasury(tick: number, inputs: TreasuryInputs, milestones: Milestone[] = DEFAULT_MILESTONES): Treasury {
    const cached = this.treasuryCache;
    if (cached && cached.tick === tick && cached.target === inputs.targetCents) return cached.value;
    const opts: Parameters<typeof computeTreasury>[2] = {
      targetCents: inputs.targetCents,
      dailyTokenBudgetCents: inputs.dailyTokenBudgetCents,
      milestones,
    };
    if (inputs.startingBalanceCents !== undefined) opts.startingBalanceCents = inputs.startingBalanceCents;
    const value = computeTreasury(this.entries, tick, opts);
    this.treasuryCache = { tick, target: inputs.targetCents, value };
    return value;
  }
}
