/**
 * Brain contract. A brain turns a Task into a TaskOutput using only the
 * context it is given: a confined workspace, the upstream outputs it depends
 * on, and a handful of callbacks into the station.
 */
import { z } from 'zod';
import type {
  ApprovalKind,
  ApprovalRequest,
  CrewAgent,
  Rng,
  RiskLevel,
  RunMode,
  Task,
  TaskOutput,
  Venture,
} from '@eternity/core';
import type { LogLevel } from '../bus.js';

export interface BrainWorkspace {
  root: string;
  write(rel: string, content: string | Uint8Array): string;
  read(rel: string): string;
  list(): string[];
}

export interface ApprovalInput {
  kind: ApprovalKind;
  risk: RiskLevel;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  manualInstructions?: string;
  listingId?: string;
}

export interface BrainUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface BrainContext {
  mode: RunMode;
  venture: Venture;
  agent: CrewAgent;
  workspace: BrainWorkspace;
  tick: number;
  rng: Rng;
  /** Outputs of the tasks this task depends on, keyed by task id. */
  deps: Record<string, TaskOutput>;
  log(level: LogLevel, message: string): void;
  /** Parks the task in the Airlock and resolves once a human (or auto-approval) decides. */
  requestApproval(input: ApprovalInput): Promise<ApprovalRequest>;
  /** Short in-character line for the speech bubble. */
  speak(text: string): void;
  /** Resolves after `n` simulation ticks have passed (not wall time). */
  waitTicks(n: number): Promise<void>;
  /** Reports real token usage so the ledger can bill it. */
  reportUsage(usage: BrainUsage): void;
}

export interface Brain {
  readonly name: string;
  run(task: Task, ctx: BrainContext): Promise<TaskOutput>;
}

export interface BrainErrorOptions {
  /** Whether the station should requeue the task. Defaults to true. */
  retryable?: boolean;
  /** Ticks the agent should rest before taking new work (rate limits). */
  restTicks?: number;
  cause?: unknown;
}

export class BrainError extends Error {
  readonly retryable: boolean;
  readonly restTicks: number;

  constructor(message: string, opts: BrainErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'BrainError';
    this.retryable = opts.retryable ?? true;
    this.restTicks = opts.restTicks ?? 0;
  }
}

export const TaskOutputSchema = z.object({
  summary: z.string().min(1).max(2000),
  files: z.array(z.string().min(1)).max(200),
  data: z.record(z.string(), z.unknown()),
  quality: z.number().min(0).max(1).optional(),
});

export function parseTaskOutput(value: unknown): TaskOutput {
  const parsed = TaskOutputSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new BrainError(`Invalid task output: ${issues}`, { retryable: true });
  }
  const out: TaskOutput = { summary: parsed.data.summary, files: parsed.data.files, data: parsed.data.data };
  if (parsed.data.quality !== undefined) out.quality = parsed.data.quality;
  return out;
}

/** Task input helpers shared by brains. */
export function inputString(task: Task, key: string, fallback = ''): string {
  const value = task.input[key];
  return typeof value === 'string' ? value : fallback;
}

export function inputNumber(task: Task, key: string, fallback: number): number {
  const value = task.input[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function depOutput(ctx: BrainContext, task: Task, refKey: string): TaskOutput | undefined {
  const ref = task.input[refKey];
  return typeof ref === 'string' ? ctx.deps[ref] : undefined;
}
