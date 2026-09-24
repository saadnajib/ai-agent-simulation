/**
 * Environment configuration, validated with zod. Nothing else in the server
 * reads process.env: index.ts calls loadConfig once and passes the result down.
 */
import { z } from 'zod';
import type { RunMode, AllocationPolicy } from '@eternity/core';

const bool = (fallback: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(text)) return true;
    if (['0', 'false', 'no', 'off'].includes(text)) return false;
    return value;
  }, z.boolean());

const positiveInt = z.number().int().positive();
const PolicyOverridesSchema = z
  .object({
    epochTicks: positiveInt,
    windowTicks: positiveInt,
    explorationFloor: z.number().min(0).max(0.5),
    graceTicks: z.number().int().nonnegative(),
    killRoiThreshold: z.number(),
    killNoSaleTicks: positiveInt,
    scaleRoiThreshold: z.number(),
    maxVentures: positiveInt,
    maxVenturesPerKind: positiveInt,
    maxCrewPerVenture: positiveInt,
  })
  .partial()
  .strict();

const optionalNumber = z.preprocess((value) => (value === '' ? undefined : value), z.coerce.number().optional());

export const EnvSchema = z.object({
  MODE: z.enum(['sim', 'live']).default('sim'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().min(1).default('./data/station.sqlite'),
  WORKSPACE_ROOT: z.string().min(1).default('./data/workspaces'),
  TICK_HZ: z.coerce.number().positive().max(1000).default(2),
  OVERSEER_MODEL: z.string().min(1).default('claude-opus-5'),
  WORKER_MODEL: z.string().min(1).default('claude-sonnet-5'),
  DAILY_TOKEN_BUDGET_CENTS: z.coerce.number().int().nonnegative().default(2000),
  AUTO_APPROVE: bool(true),
  ALLOW_WEB_SEARCH: bool(false),
  TARGET_CENTS: z.coerce.number().int().positive().default(1e14),
  SEED: z.coerce.number().int().default(42),
  /** Sim-only demand multiplier so a fresh station shows sales in days, not months. Labelled in the HUD. */
  SIM_DEMAND_MULTIPLIER: z.coerce.number().positive().default(25),
  BRAIN_CONCURRENCY: optionalNumber.pipe(z.number().int().positive().optional()),
  MAX_CREW: z.coerce.number().int().positive().default(40),
  /** JSON object merged over DEFAULT_POLICY, e.g. {"graceTicks":720}. */
  POLICY_OVERRIDES: z.preprocess((value) => {
    if (value === undefined || value === '') return {};
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }, PolicyOverridesSchema).default({}),
  NODE_ENV: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  STATIC_DIR: z.string().optional(),
});

export interface ServerConfig {
  mode: RunMode;
  /** Fields that override DEFAULT_POLICY (and any policy stored in the database). */
  policyOverrides: Partial<AllocationPolicy>;
  port: number;
  host: string;
  dbPath: string;
  workspaceRoot: string;
  tickHz: number;
  overseerModel: string;
  workerModel: string;
  dailyTokenBudgetCents: number;
  autoApprove: boolean;
  allowWebSearch: boolean;
  targetCents: number;
  seed: number;
  simDemandMultiplier: number;
  brainConcurrency: number;
  maxCrew: number;
  production: boolean;
  apiKey?: string;
  staticDir?: string;
}

export interface ConfigOverrides {
  seed?: number;
  port?: number;
  dbPath?: string;
  workspaceRoot?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>, overrides: ConfigOverrides = {}): ServerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  const mode: RunMode = e.MODE;
  const config: ServerConfig = {
    mode,
    port: overrides.port ?? e.PORT,
    host: e.HOST,
    dbPath: overrides.dbPath ?? e.DB_PATH,
    workspaceRoot: overrides.workspaceRoot ?? e.WORKSPACE_ROOT,
    tickHz: e.TICK_HZ,
    overseerModel: e.OVERSEER_MODEL,
    workerModel: e.WORKER_MODEL,
    dailyTokenBudgetCents: e.DAILY_TOKEN_BUDGET_CENTS,
    autoApprove: e.AUTO_APPROVE,
    allowWebSearch: e.ALLOW_WEB_SEARCH,
    targetCents: e.TARGET_CENTS,
    seed: overrides.seed ?? e.SEED,
    simDemandMultiplier: e.SIM_DEMAND_MULTIPLIER,
    // Scripted brains cost nothing to run concurrently; Claude calls are bounded.
    brainConcurrency: e.BRAIN_CONCURRENCY ?? (mode === 'sim' ? 32 : 4),
    maxCrew: e.MAX_CREW,
    policyOverrides: e.POLICY_OVERRIDES,
    production: e.NODE_ENV === 'production',
  };
  if (e.ANTHROPIC_API_KEY) config.apiKey = e.ANTHROPIC_API_KEY;
  if (e.STATIC_DIR) config.staticDir = e.STATIC_DIR;
  return config;
}

export interface CliArgs {
  reset: boolean;
  seed?: number;
  port?: number;
}

/** Parses `--reset`, `--seed <n>` and `--port <n>`. Unknown flags are reported, not ignored. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { reset: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg === '--reset') {
      args.reset = true;
    } else if (arg === '--seed' || arg === '--port') {
      const raw = argv[i + 1];
      const value = raw === undefined ? Number.NaN : Number(raw);
      if (!Number.isInteger(value)) throw new ConfigError(`${arg} expects an integer, got "${raw ?? ''}"`);
      if (arg === '--seed') args.seed = value;
      else args.port = value;
      i++;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new ConfigError(`Unknown flag ${arg}`);
    }
  }
  return args;
}
