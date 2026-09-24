/**
 * Crew names with a space-dungeon flavour: "Vex-7", "Brother Quill",
 * "Sorrel of the Ninth Deck". Deterministic under an Rng and never repeats a
 * name already in use.
 */
import type { AgentRole } from '@eternity/core';
import type { Rng } from '@eternity/core';

const CALLSIGNS = [
  'Vex', 'Kael', 'Orrin', 'Sable', 'Juno', 'Tarn', 'Ilex', 'Moss', 'Rook', 'Wren',
  'Cinder', 'Halcyon', 'Pike', 'Nyx', 'Quill', 'Ash', 'Bram', 'Lark', 'Sorrel', 'Thane',
  'Ferrin', 'Idris', 'Marrow', 'Oleander', 'Petra', 'Ravel', 'Selk', 'Tamsin', 'Ursa', 'Vantry',
] as const;

const TITLES = ['Brother', 'Sister', 'Warden', 'Acolyte', 'Novice', 'Keeper', 'Deacon', 'Cantor'] as const;

const PLACES = ['the Deep', 'the Hull', 'the Ninth Deck', 'the Long Dark', 'the Ring', 'the Cold Side', 'Bay Twelve'] as const;

export function generateCrewName(rng: Rng, taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const name = candidate(rng, attempt);
    if (!taken.has(name)) return name;
  }
  return `${rng.pick(CALLSIGNS)}-${rng.int(100, 9999)}`;
}

function candidate(rng: Rng, attempt: number): string {
  const style = (rng.int(0, 2) + attempt) % 3;
  const callsign = rng.pick(CALLSIGNS);
  if (style === 0) return `${callsign}-${rng.int(1, 99)}`;
  if (style === 1) return `${rng.pick(TITLES)} ${callsign}`;
  return `${callsign} of ${rng.pick(PLACES)}`;
}

/** Short human label for a role, used in log lines and speech. */
export const ROLE_LABELS: Record<AgentRole, string> = {
  overseer: 'Overseer',
  scout: 'scout',
  designer: 'designer',
  'pixel-artist': 'pixel artist',
  'thumbnail-artist': 'thumbnail artist',
  writer: 'writer',
  engineer: 'engineer',
  composer: 'composer',
  marketer: 'marketer',
  reviewer: 'reviewer',
};
