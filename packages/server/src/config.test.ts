import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseCliArgs } from './config.js';

describe('loadConfig', () => {
  it('applies documented defaults with an empty environment', () => {
    const config = loadConfig({});
    expect(config.mode).toBe('sim');
    expect(config.port).toBe(8787);
    expect(config.tickHz).toBe(2);
    expect(config.dailyTokenBudgetCents).toBe(2000);
    expect(config.autoApprove).toBe(true);
    expect(config.allowWebSearch).toBe(false);
    expect(config.targetCents).toBe(1e14);
    expect(config.seed).toBe(42);
    expect(config.brainConcurrency).toBeGreaterThan(0);
    expect(config.production).toBe(false);
  });

  it('parses strings from the environment', () => {
    const config = loadConfig({
      MODE: 'live',
      PORT: '9000',
      AUTO_APPROVE: 'false',
      ALLOW_WEB_SEARCH: 'yes',
      DAILY_TOKEN_BUDGET_CENTS: '500',
      WORKER_MODEL: 'claude-haiku-4-5',
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'sk-test',
      BRAIN_CONCURRENCY: '2',
    });
    expect(config.mode).toBe('live');
    expect(config.port).toBe(9000);
    expect(config.autoApprove).toBe(false);
    expect(config.allowWebSearch).toBe(true);
    expect(config.dailyTokenBudgetCents).toBe(500);
    expect(config.workerModel).toBe('claude-haiku-4-5');
    expect(config.production).toBe(true);
    expect(config.apiKey).toBe('sk-test');
    expect(config.brainConcurrency).toBe(2);
  });

  it('rejects invalid values with a readable error', () => {
    expect(() => loadConfig({ MODE: 'dream' })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ AUTO_APPROVE: 'maybe' })).toThrow(/AUTO_APPROVE/);
  });

  it('lets overrides win over the environment', () => {
    const config = loadConfig({ SEED: '7' }, { seed: 99, port: 1234 });
    expect(config.seed).toBe(99);
    expect(config.port).toBe(1234);
  });
});

describe('parseCliArgs', () => {
  it('reads --reset and --seed', () => {
    expect(parseCliArgs(['--reset', '--seed', '7'])).toEqual({ reset: true, seed: 7 });
    expect(parseCliArgs(['--', '--seed', '3'])).toEqual({ reset: false, seed: 3 });
    expect(parseCliArgs([])).toEqual({ reset: false });
  });

  it('rejects non-integer seeds and unknown flags', () => {
    expect(() => parseCliArgs(['--seed', 'x'])).toThrow(ConfigError);
    expect(() => parseCliArgs(['--bogus'])).toThrow(ConfigError);
  });
});

describe('POLICY_OVERRIDES', () => {
  it('merges a JSON object over the default policy and rejects unknown keys', () => {
    const config = loadConfig({ POLICY_OVERRIDES: '{"graceTicks":720,"killNoSaleTicks":1440}' });
    expect(config.policyOverrides).toEqual({ graceTicks: 720, killNoSaleTicks: 1440 });
    expect(loadConfig({}).policyOverrides).toEqual({});
    expect(() => loadConfig({ POLICY_OVERRIDES: '{"bogus":1}' })).toThrow(ConfigError);
    expect(() => loadConfig({ POLICY_OVERRIDES: 'not json' })).toThrow(ConfigError);
  });
});
