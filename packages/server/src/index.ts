/**
 * Boot: parse flags, load config, open SQLite, build adapters and brains,
 * create the station, start the API and the clock, print the banner.
 */
import './warnings.js';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { createAdapterRegistry } from '@eternity/adapters';
import { createApi } from './api.js';
import { ClaudeBrain } from './brains/claude.js';
import { ScriptedBrain } from './brains/scripted.js';
import type { Brain } from './brains/types.js';
import { StationBus } from './bus.js';
import { ConfigError, loadConfig, parseCliArgs, type ServerConfig } from './config.js';
import { StationDb } from './db.js';
import { findRepoRoot, resolveDataPath, withDotEnv } from './env.js';
import { ClaudeOverseer } from './overseer/claude.js';
import { Station } from './station.js';

function resetData(config: ServerConfig): void {
  const guard = (path: string) => {
    const abs = resolve(path);
    if (abs === '/' || abs === resolve(process.env['HOME'] ?? '/root')) throw new ConfigError(`Refusing to delete ${abs}`);
    return abs;
  };
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const file = guard(config.dbPath) + suffix;
    if (existsSync(file)) rmSync(file, { force: true });
  }
  const workspaces = guard(config.workspaceRoot);
  if (existsSync(workspaces)) rmSync(workspaces, { recursive: true, force: true });
  console.log(`[eternity] reset: removed ${config.dbPath} and ${config.workspaceRoot}`);
}

function buildBrains(config: ServerConfig): { brain: Brain; overseer: ClaudeOverseer | null } {
  if (config.mode === 'sim') return { brain: new ScriptedBrain(), overseer: null };
  const client = config.apiKey ? new Anthropic({ apiKey: config.apiKey }) : new Anthropic();
  return {
    brain: new ClaudeBrain(client, { model: config.workerModel, allowWebSearch: config.allowWebSearch }),
    overseer: new ClaudeOverseer(client, { model: config.overseerModel }),
  };
}

function attachConsoleLog(bus: StationBus): void {
  bus.on('log', (event) => {
    if (event.level === 'debug') return;
    const tag = event.level.toUpperCase().padEnd(5);
    console.log(`[t${String(event.tick).padStart(6)}] ${tag} ${event.message}`);
  });
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const root = findRepoRoot(import.meta.dirname);
  const env = withDotEnv(process.env, root);
  const loaded = loadConfig(env, { ...(args.seed !== undefined ? { seed: args.seed } : {}), ...(args.port !== undefined ? { port: args.port } : {}) });
  const config: ServerConfig = { ...loaded, dbPath: resolveDataPath(loaded.dbPath, root), workspaceRoot: resolveDataPath(loaded.workspaceRoot, root) };
  if (args.reset) resetData(config);

  const bus = new StationBus();
  attachConsoleLog(bus);
  const db = new StationDb(config.dbPath);
  const registry = createAdapterRegistry(env, { mode: config.mode });
  const { brain, overseer } = buildBrains(config);
  const station = Station.create({ config, db, bus, brain, registry, overseer });

  const staticDir = config.staticDir ?? (config.production ? resolve(root, 'apps/station/dist') : undefined);
  const api = createApi(station, staticDir ? { staticDir } : {});
  const port = await api.listen(config.port, config.host);
  const demand = config.mode === 'sim' ? ` demand=x${config.simDemandMultiplier}(sim)` : '';
  console.log(`[eternity] mode=${config.mode} seed=${station.world.seed} tick=${station.tick} tickHz=${config.tickHz}${demand} url=http://localhost:${port} ws=/ws`);
  station.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[eternity] ${signal}: shutting down`);
    station.stop();
    await api.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(`[eternity] ${error.message}`);
  else console.error('[eternity] failed to start:', error);
  process.exit(1);
});
