/**
 * Short, prefixed identifiers such as "ven_8f3k2a7q".
 *
 * When an `Rng` is supplied the id is reproducible from the seed, which keeps
 * simulated runs replayable. Without one, `Math.random` is used; that is fine
 * for live mode where nothing needs to be replayed.
 */
import type { Rng } from './rng.js';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_LENGTH = 8;

const PREFIX_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;

export function makeId(prefix: string, rng?: Rng): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(`makeId: invalid prefix "${prefix}" (lowercase, digits, hyphen; max 16 chars)`);
  }
  const draw = rng ? () => rng.next() : () => Math.random();
  let body = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    body += ALPHABET[Math.floor(draw() * ALPHABET.length)];
  }
  return `${prefix}_${body}`;
}

/** Returns the prefix part of an id made with makeId, or null if it does not look like one. */
export function idPrefix(id: string): string | null {
  const underscore = id.indexOf('_');
  if (underscore <= 0) return null;
  const prefix = id.slice(0, underscore);
  return PREFIX_PATTERN.test(prefix) ? prefix : null;
}
