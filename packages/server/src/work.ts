/**
 * Task lifecycle: assignment, arrival at a workstation, asynchronous brain
 * execution with bounded concurrency, completion accounting (tokens to the
 * ledger, stats to the agent), failures with retries, cancellation cascades,
 * and the publish path through the Airlock.
 */
import type { ApprovalRequest, CrewAgent, Task, TaskOutput } from '@eternity/core';
import { TASK_TOKEN_PROFILES, estimateTaskCostCents, tokenCostCents } from '@eternity/core';
import type { AdapterRegistry } from '@eternity/adapters';
import type { Airlock, Decision } from './airlock.js';
import { BrainError, type Brain, type BrainContext, type BrainUsage } from './brains/types.js';
import { isTerminal, pickWorkTile, sendAgentTo } from './dispatch.js';
import { applyOutputEffects, beginPublish, completePublish } from './effects.js';
import type { World } from './state.js';
import { createWorkspace, type Workspace } from './workspace.js';

const MAX_ATTEMPTS = 3;
const FAILURE_REST_TICKS = 4;

export interface WorkOptions {
  brain: Brain;
  airlock: Airlock;
  registry: AdapterRegistry;
  concurrency: number;
}

interface Waiter {
  due: number;
  resolve: () => void;
}

export class WorkRunner {
  private readonly active = new Set<string>();
  private readonly waiters: Waiter[] = [];
  private readonly workspaces = new Map<string, Workspace>();
  private readonly brain: Brain;
  private readonly airlock: Airlock;
  private readonly registry: AdapterRegistry;
  private readonly concurrency: number;

  constructor(
    private readonly world: World,
    opts: WorkOptions,
  ) {
    this.brain = opts.brain;
    this.airlock = opts.airlock;
    this.registry = opts.registry;
    this.concurrency = opts.concurrency;
    this.airlock.onDecision((approval, decision) => void this.onApprovalDecided(approval, decision));
  }

  hasCapacity(): boolean {
    return this.active.size < this.concurrency;
  }

  activeCount(): number {
    return this.active.size;
  }

  workspaceFor(ventureId: string): Workspace {
    let ws = this.workspaces.get(ventureId);
    if (!ws) {
      ws = createWorkspace(this.world.config.workspaceRoot, ventureId);
      this.workspaces.set(ventureId, ws);
    }
    return ws;
  }

  /** Rebuilds runtime state after a restart: in-flight tasks go back to the queue. */
  recover(): void {
    for (const task of this.world.tasks.values()) {
      if (task.status === 'assigned' || task.status === 'in-progress') {
        delete task.assignedTo;
        task.status = 'queued';
        this.world.putTask(task);
      }
    }
    for (const agent of this.world.agents.values()) {
      if (agent.role === 'overseer' || agent.status === 'offline') continue;
      if (agent.status === 'blocked' && agent.currentTaskId) {
        const task = this.world.tasks.get(agent.currentTaskId);
        if (task?.status === 'awaiting-approval') continue;
      }
      delete agent.currentTaskId;
      agent.status = 'idle';
      this.world.putAgent(agent, false);
    }
  }

  // ---------------------------------------------------------------------
  // Assignment and arrival
  // ---------------------------------------------------------------------

  assign(task: Task, agent: CrewAgent): void {
    task.status = 'assigned';
    task.assignedTo = agent.id;
    this.world.assignedAt.set(task.id, this.world.tick);
    this.world.putTask(task);
    agent.currentTaskId = task.id;
    const tile = pickWorkTile(this.world, task.roomId, agent.id);
    const arrived = sendAgentTo(this.world, agent, task.roomId, tile);
    if (arrived) this.onArrive(agent);
    else this.world.putAgent(agent);
  }

  onArrive(agent: CrewAgent): void {
    const task = agent.currentTaskId ? this.world.tasks.get(agent.currentTaskId) : undefined;
    if (!task || task.status !== 'assigned' || task.assignedTo !== agent.id) {
      if (agent.status === 'walking') {
        agent.status = agent.role === 'overseer' ? 'working' : 'idle';
        this.world.putAgent(agent);
      }
      return;
    }
    this.begin(task, agent);
  }

  private begin(task: Task, agent: CrewAgent): void {
    task.status = 'in-progress';
    task.startedAtTick = this.world.tick;
    task.attempts += 1;
    this.world.assignedAt.delete(task.id);
    this.world.putTask(task);
    agent.status = 'working';
    this.world.putAgent(agent);
    if (task.kind === 'publish-listing') {
      void this.startPublish(task, agent);
      return;
    }
    void this.runBrain(task, agent);
  }

  // ---------------------------------------------------------------------
  // Brains
  // ---------------------------------------------------------------------

  private buildContext(task: Task, agent: CrewAgent, usage: { value: BrainUsage | null }): BrainContext {
    const venture = this.world.venture(task.ventureId);
    if (!venture) throw new BrainError(`Task ${task.id} has no venture`, { retryable: false });
    const deps: Record<string, TaskOutput> = {};
    for (const id of task.dependsOn) {
      const output = this.world.tasks.get(id)?.output;
      if (output) deps[id] = output;
    }
    const workspace = this.workspaceFor(venture.id);
    return {
      mode: this.world.mode,
      venture,
      agent,
      workspace,
      tick: this.world.tick,
      rng: this.world.rng(`brain:${task.id}:${task.attempts}`),
      deps,
      log: (level, message) => this.world.log(level, message, agent.id),
      requestApproval: (input) =>
        this.airlock.requestAndWait({ ...input, requestedBy: agent.id, ...(task.ventureId ? { ventureId: task.ventureId } : {}), taskId: task.id }),
      speak: (text) => this.world.speak(agent.id, text),
      waitTicks: (n) => this.waitTicks(n),
      reportUsage: (report) => {
        usage.value = report;
      },
    };
  }

  private async runBrain(task: Task, agent: CrewAgent): Promise<void> {
    this.active.add(task.id);
    const usage: { value: BrainUsage | null } = { value: null };
    try {
      const ctx = this.buildContext(task, agent, usage);
      const output = await this.brain.run(task, ctx);
      this.active.delete(task.id);
      if (!this.stillRunning(task, agent)) return;
      this.finish(task, agent, output, usage.value);
    } catch (error) {
      this.active.delete(task.id);
      if (!this.stillRunning(task, agent)) return;
      this.fail(task, agent, error, usage.value);
    }
  }

  private stillRunning(task: Task, agent: CrewAgent): boolean {
    const current = this.world.tasks.get(task.id);
    return current !== undefined && current.status === 'in-progress' && current.assignedTo === agent.id && agent.status !== 'offline';
  }

  waitTicks(n: number): Promise<void> {
    const due = this.world.tick + Math.max(1, Math.round(n));
    return new Promise((resolve) => this.waiters.push({ due, resolve }));
  }

  /** Wakes scripted brains whose simulated work is complete. */
  resolveWaiters(): void {
    const tick = this.world.tick;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i]!;
      if (waiter.due > tick) continue;
      this.waiters.splice(i, 1);
      waiter.resolve();
    }
  }

  // ---------------------------------------------------------------------
  // Completion accounting
  // ---------------------------------------------------------------------

  private bill(task: Task, agent: CrewAgent, usage: BrainUsage | null): void {
    let tokensIn: number;
    let tokensOut: number;
    let cost: number;
    let memo: string;
    if (usage) {
      tokensIn = usage.tokensIn;
      tokensOut = usage.tokensOut;
      cost = tokenCostCents(usage.model, tokensIn, tokensOut);
      memo = `${usage.model}: ${task.kind} (${tokensIn} in / ${tokensOut} out)`;
    } else {
      const profile = TASK_TOKEN_PROFILES[task.kind];
      tokensOut = Math.round(profile.totalTokens * profile.outputShare);
      tokensIn = profile.totalTokens - tokensOut;
      cost = estimateTaskCostCents(task.kind, this.world.config.workerModel);
      memo = `simulated ${task.kind} priced as ${this.world.config.workerModel}`;
    }
    task.costCents += cost;
    agent.stats.tokensIn += tokensIn;
    agent.stats.tokensOut += tokensOut;
    agent.stats.costCents += cost;
    if (cost > 0) {
      this.world.record({
        kind: 'token-cost',
        amountCents: -cost,
        memo,
        agentId: agent.id,
        taskId: task.id,
        ...(task.ventureId ? { ventureId: task.ventureId } : {}),
      });
    }
  }

  finish(task: Task, agent: CrewAgent, output: TaskOutput, usage: BrainUsage | null = null): void {
    this.bill(task, agent, usage);
    task.output = output;
    task.status = 'done';
    task.finishedAtTick = this.world.tick;
    delete task.error;
    const effect = applyOutputEffects(this.world, task, output);
    this.world.putTask(task);
    agent.stats.tasksCompleted += 1;
    this.release(agent);
    this.world.log('info', `${agent.name} finished ${task.kind}: ${output.summary}`, agent.id);
    if (!effect.approved) this.cancelDependents(task.id, effect.note ?? 'blocked upstream');
  }

  fail(task: Task, agent: CrewAgent, error: unknown, usage: BrainUsage | null = null): void {
    this.bill(task, agent, usage);
    const brainError = error instanceof BrainError ? error : null;
    const message = error instanceof Error ? error.message : String(error);
    const retryable = brainError ? brainError.retryable : true;
    agent.stats.tasksFailed += 1;
    task.error = message;
    delete task.assignedTo;
    if (retryable && task.attempts < MAX_ATTEMPTS) {
      task.status = 'queued';
      this.world.log('warn', `${agent.name} failed ${task.kind} (attempt ${task.attempts}/${MAX_ATTEMPTS}): ${message}`, agent.id);
    } else {
      task.status = 'failed';
      task.finishedAtTick = this.world.tick;
      this.world.log('error', `${task.kind} failed permanently: ${message}`, agent.id);
      this.cancelDependents(task.id, `upstream ${task.kind} failed`);
    }
    this.world.putTask(task);
    const rest = brainError?.restTicks ?? FAILURE_REST_TICKS;
    this.release(agent, rest);
  }

  cancel(task: Task, reason: string): void {
    if (isTerminal(task)) return;
    const agentId = task.assignedTo;
    task.status = 'cancelled';
    task.error = reason;
    task.finishedAtTick = this.world.tick;
    delete task.assignedTo;
    this.world.assignedAt.delete(task.id);
    this.active.delete(task.id);
    this.world.putTask(task);
    if (agentId) {
      const agent = this.world.agents.get(agentId);
      if (agent && agent.currentTaskId === task.id) this.release(agent);
    }
    this.cancelDependents(task.id, reason);
  }

  private cancelDependents(taskId: string, reason: string): void {
    for (const other of this.world.tasks.values()) {
      if (isTerminal(other) || !other.dependsOn.includes(taskId)) continue;
      this.cancel(other, reason);
    }
  }

  release(agent: CrewAgent, restTicks = 0): void {
    delete agent.currentTaskId;
    if (agent.status === 'offline') return;
    if (restTicks > 0) {
      agent.status = 'resting';
      this.world.restUntil.set(agent.id, this.world.tick + restTicks);
    } else {
      agent.status = 'idle';
    }
    this.world.putAgent(agent);
  }

  /** Returns rested agents to the idle pool. */
  wakeRested(): void {
    for (const [agentId, until] of this.world.restUntil) {
      if (until > this.world.tick) continue;
      this.world.restUntil.delete(agentId);
      const agent = this.world.agents.get(agentId);
      if (agent && agent.status === 'resting') {
        agent.status = 'idle';
        this.world.putAgent(agent);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Publishing
  // ---------------------------------------------------------------------

  private async startPublish(task: Task, agent: CrewAgent): Promise<void> {
    this.active.add(task.id);
    try {
      const approval = await beginPublish(this.world, this.airlock, this.registry, task, agent);
      this.active.delete(task.id);
      if (!this.stillRunning(task, agent)) return;
      if (!approval) {
        this.fail(task, agent, new BrainError('Nothing to publish: no reviewed listing upstream', { retryable: false }));
        return;
      }
      task.status = 'awaiting-approval';
      this.world.putTask(task);
      agent.status = 'blocked';
      this.world.putAgent(agent);
      this.world.speak(agent.id, 'Waiting on the Airlock.', 8);
    } catch (error) {
      this.active.delete(task.id);
      if (this.stillRunning(task, agent)) this.fail(task, agent, error);
    }
  }

  private async onApprovalDecided(approval: ApprovalRequest, decision: Decision): Promise<void> {
    if (approval.kind !== 'publish' || !approval.taskId) return;
    const task = this.world.tasks.get(approval.taskId);
    if (!task || task.status !== 'awaiting-approval') return;
    const agent = task.assignedTo ? this.world.agents.get(task.assignedTo) : undefined;
    const listing = approval.listingId ? this.world.listings.get(approval.listingId) : undefined;
    if (decision === 'rejected' || !listing) {
      if (listing) {
        listing.status = 'rejected';
        this.world.putListing(listing);
      }
      task.status = 'rejected';
      task.error = approval.note ?? 'rejected at the Airlock';
      task.finishedAtTick = this.world.tick;
      delete task.assignedTo;
      this.world.putTask(task);
      if (agent) this.release(agent);
      this.cancelDependents(task.id, 'publish rejected at the Airlock');
      return;
    }
    task.status = 'approved';
    this.world.putTask(task);
    const outcome = await completePublish(this.world, this.registry, approval, listing);
    const current = this.world.tasks.get(task.id);
    if (!current || current.status !== 'approved') return;
    if (!outcome.ok || !outcome.output) {
      current.status = 'in-progress';
      this.world.putTask(current);
      if (agent) this.fail(current, agent, new BrainError(outcome.error ?? 'publish failed', { retryable: true }));
      return;
    }
    if (agent) {
      current.status = 'in-progress';
      this.finish(current, agent, outcome.output);
      this.world.speak(agent.id, `"${listing.title.slice(0, 32)}" is live.`, 8);
    } else {
      current.status = 'done';
      current.output = outcome.output;
      current.finishedAtTick = this.world.tick;
      this.world.putTask(current);
    }
  }
}
