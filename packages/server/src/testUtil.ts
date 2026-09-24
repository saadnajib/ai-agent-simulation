/**
 * Shared helpers for the server test suite: temp directories, headless
 * stations and a fake brain context.
 */
import './warnings.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CrewAgent, Rng, Venture } from '@eternity/core';
import { createAdapterRegistry } from '@eternity/adapters';
import { ScriptedBrain } from './brains/scripted.js';
import type { BrainContext, BrainUsage } from './brains/types.js';
import { StationBus } from './bus.js';
import { loadConfig, type ServerConfig } from './config.js';
import { StationDb } from './db.js';
import { Station } from './station.js';
import { createWorkspace } from './workspace.js';
import { emptyMetrics } from './ventures.js';

export function tempDir(prefix = 'eternity-'): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function testConfig(workspaceRoot: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return { ...loadConfig({ MODE: 'sim', TICK_HZ: '1000' }, { seed: 42, dbPath: ':memory:', workspaceRoot }), ...overrides };
}

export interface HeadlessStation {
  station: Station;
  bus: StationBus;
  db: StationDb;
  cleanup: () => void;
}

export function headlessStation(overrides: Partial<ServerConfig> = {}): HeadlessStation {
  const dir = tempDir();
  const config = testConfig(dir.path, overrides);
  const bus = new StationBus();
  const db = new StationDb(':memory:');
  const registry = createAdapterRegistry({}, { mode: 'sim' });
  let clock = 0;
  const station = Station.create({ config, db, bus, brain: new ScriptedBrain(), registry, now: () => new Date(1_900_000_000_000 + clock++ * 1000).toISOString() });
  return {
    station,
    bus,
    db,
    cleanup: () => {
      station.stop();
      db.close();
      dir.cleanup();
    },
  };
}

export function fakeVenture(kind: Venture['kind'] = 'pod-store'): Venture {
  return {
    id: 'ven_test0001',
    kind,
    name: 'Test Prints',
    thesis: 'vintage botanical cat tees',
    roomId: 'print-foundry',
    status: 'active',
    createdAtTick: 0,
    budgetShare: 1,
    crew: [],
    storefronts: [{ id: 'shop_test0001', ventureId: 'ven_test0001', platform: 'etsy', name: 'Test on etsy', connected: true }],
    metrics: emptyMetrics(),
  };
}

export function fakeAgent(role: CrewAgent['role'] = 'designer'): CrewAgent {
  return {
    id: 'agent_test0001',
    name: 'Vex-7',
    role,
    roomId: 'print-foundry',
    status: 'working',
    position: { x: 20, y: 5 },
    brain: 'scripted',
    stats: { tasksCompleted: 0, tasksFailed: 0, tokensIn: 0, tokensOut: 0, costCents: 0, revenueAttributedCents: 0 },
    hiredAtTick: 0,
  };
}

export interface FakeContextResult {
  ctx: BrainContext;
  speech: string[];
  usage: BrainUsage[];
  cleanup: () => void;
}

export function fakeContext(rng: Rng, venture: Venture, agent: CrewAgent, deps: BrainContext['deps'] = {}): FakeContextResult {
  const dir = tempDir('brain-');
  const workspace = createWorkspace(dir.path, venture.id);
  const speech: string[] = [];
  const usage: BrainUsage[] = [];
  const ctx: BrainContext = {
    mode: 'sim',
    venture,
    agent,
    workspace,
    tick: 10,
    rng,
    deps,
    log: () => undefined,
    requestApproval: () => Promise.reject(new Error('not used in tests')),
    speak: (text) => speech.push(text),
    waitTicks: () => Promise.resolve(),
    reportUsage: (u) => usage.push(u),
  };
  return { ctx, speech, usage, cleanup: dir.cleanup };
}
