/**
 * Number, money and time formatting for the HUD. Money formatting is reused
 * from core so the client and server agree on how cents are shown.
 */
import { formatCents, TICKS_PER_DAY } from '@eternity/core';

export { formatCents };

const HOURS_PER_YEAR = TICKS_PER_DAY * 365.25;

function withThousands(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function oneDecimal(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * Honest ETA text. `null` means profit is not positive, so the target is
 * never reached at the current velocity.
 */
export function formatEta(ticks: number | null): string {
  if (ticks === null || !Number.isFinite(ticks) || ticks < 0) return 'never at current velocity';
  if (ticks < TICKS_PER_DAY) return `${Math.max(1, Math.round(ticks))} hours`;
  const days = ticks / TICKS_PER_DAY;
  if (days < 90) return `${oneDecimal(days)} days`;
  const years = ticks / HOURS_PER_YEAR;
  if (years < 1000) return `${oneDecimal(years)} years`;
  if (years < 1e6) return `${withThousands(years)} years`;
  if (years < 1e9) return `${oneDecimal(years / 1e6)} million years`;
  if (years < 1e12) return `${oneDecimal(years / 1e9)} billion years`;
  return `${oneDecimal(years / 1e12)} trillion years`;
}

/** Ticks as a compact age or duration, e.g. "3h", "2d 4h", "1y 12d". */
export function formatDuration(ticks: number): string {
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

/** ROI as a signed percentage: 0.42 -> "+42%", -0.5 -> "-50%". */
export function formatRoi(roi: number): string {
  if (!Number.isFinite(roi)) return '--';
  const pct = roi * 100;
  const sign = pct > 0 ? '+' : '';
  const digits = Math.abs(pct) >= 100 ? 0 : 1;
  return `${sign}${pct.toFixed(digits)}%`;
}

export function formatPct(fraction: number, digits = 0): string {
  if (!Number.isFinite(fraction)) return '--';
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatInt(n: number): string {
  return Number.isFinite(n) ? withThousands(n) : '--';
}

/** "Day 12 · 06:00" from a tick and its ISO sim time. */
export function formatSimClock(tick: number, simTime: string): { day: string; time: string; date: string } {
  const day = `Day ${Math.floor(tick / TICKS_PER_DAY) + 1}`;
  const parsed = Date.parse(simTime);
  if (Number.isNaN(parsed)) {
    return { day, time: `${String(tick % TICKS_PER_DAY).padStart(2, '0')}:00`, date: '' };
  }
  const d = new Date(parsed);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return { day, time: `${hh}:${mm}`, date: d.toISOString().slice(0, 10) };
}

/** Sign-aware money with an explicit plus for positives, used for P&L cells. */
export function formatSignedCents(cents: number): string {
  const text = formatCents(cents);
  return cents > 0 ? `+${text}` : text;
}

/** Log-scale position of a cents value on [0, 1] toward a target. */
export function logProgress(cents: number, targetCents: number): number {
  if (!(targetCents > 0) || !(cents > 0)) return 0;
  const p = Math.log10(1 + cents) / Math.log10(1 + targetCents);
  return Math.min(1, Math.max(0, p));
}

/** Short relative label for a tick in the past, e.g. "12h ago". */
export function formatAgo(tick: number, now: number): string {
  const delta = Math.max(0, now - tick);
  if (delta === 0) return 'now';
  return `${formatDuration(delta)} ago`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
