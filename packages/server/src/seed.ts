/**
 * Boot seed for a fresh database: HERMES in the core, two scouts in quarters,
 * one incubating print-on-demand venture with a starter cycle, empty ledger.
 */
import type { CrewAgent } from '@eternity/core';
import { playbookFor } from '@eternity/core';
import type { AdapterRegistry } from '@eternity/adapters';
import type { World } from './state.js';
import { hireAgent, spawnVenture } from './ventures.js';

export const HERMES_NAME = 'HERMES';

export function findHermes(world: World): CrewAgent | undefined {
  return [...world.agents.values()].find((a) => a.role === 'overseer');
}

export function seedStation(world: World, registry: AdapterRegistry): void {
  const core = world.map.rooms.core;
  const hermes: CrewAgent = {
    id: world.id('agent'),
    name: HERMES_NAME,
    role: 'overseer',
    roomId: 'core',
    status: 'working',
    position: core.workstations[0] ?? core.idleSpot,
    speech: 'Capital is attention. Spend it where it returns.',
    brain: world.mode === 'sim' ? 'scripted' : world.config.overseerModel,
    stats: { tasksCompleted: 0, tasksFailed: 0, tokensIn: 0, tokensOut: 0, costCents: 0, revenueAttributedCents: 0 },
    hiredAtTick: 0,
  };
  world.putAgent(hermes);
  world.log('info', 'HERMES online in the Overseer Core', hermes.id);

  hireAgent(world, 'scout', undefined, { force: true });
  hireAgent(world, 'scout', undefined, { force: true });

  const playbook = playbookFor('pod-store');
  const thesis = playbook.suggestThesis(world.stableRng('seed-thesis'));
  const venture = spawnVenture(world, registry, { kind: 'pod-store', thesis, status: 'incubating', reason: 'seed venture' });
  if (!venture) throw new Error('seed: could not create the starter venture');
  world.log('info', `Target: ${world.targetCents.toLocaleString('en-US')} cents. Starting balance: 0.`);
  world.markMeta();
}
