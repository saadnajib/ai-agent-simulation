/**
 * Simulated time. One tick is one simulated hour; a simulated day is 24 ticks.
 * Tick 0 is the start of the station's epoch.
 */

export const TICKS_PER_DAY = 24;
export const TICKS_PER_WEEK = TICKS_PER_DAY * 7;

/** Default calendar origin for the simulation clock. */
export const DEFAULT_EPOCH_START_ISO = '2030-01-01T00:00:00.000Z';

const MS_PER_TICK = 60 * 60 * 1000;

/** ISO timestamp for a tick, given the epoch start (defaults to DEFAULT_EPOCH_START_ISO). */
export function tickToSimTime(tick: number, epochStartIso: string = DEFAULT_EPOCH_START_ISO): string {
  if (!Number.isFinite(tick)) throw new RangeError('tickToSimTime: tick must be finite');
  const start = Date.parse(epochStartIso);
  if (Number.isNaN(start)) throw new RangeError(`tickToSimTime: invalid epoch start "${epochStartIso}"`);
  return new Date(start + Math.floor(tick) * MS_PER_TICK).toISOString();
}

/** Zero-based simulated day index containing the tick. */
export function simDay(tick: number): number {
  return Math.floor(tick / TICKS_PER_DAY);
}

/** First tick of the simulated day containing `tick`. */
export function dayStartTick(tick: number): number {
  return simDay(tick) * TICKS_PER_DAY;
}

/** Human-readable duration such as "3d 4h" or "2h", used by the HUD for ETAs. */
export function formatTicks(ticks: number): string {
  if (!Number.isFinite(ticks)) return 'never';
  const whole = Math.max(0, Math.round(ticks));
  const years = Math.floor(whole / (TICKS_PER_DAY * 365));
  const days = Math.floor((whole % (TICKS_PER_DAY * 365)) / TICKS_PER_DAY);
  const hours = whole % TICKS_PER_DAY;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || parts.length === 0) parts.push(`${hours}h`);
  return parts.slice(0, 2).join(' ');
}
