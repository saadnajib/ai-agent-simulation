import { describe, expect, it } from 'vitest';
import { formatDuration, formatEta, formatRoi, formatSignedCents, formatSimClock, logProgress } from './format.js';

describe('formatEta', () => {
  it('is honest when profit is not positive', () => {
    expect(formatEta(null)).toBe('never at current velocity');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('never at current velocity');
  });

  it('scales units sensibly', () => {
    expect(formatEta(5)).toBe('5 hours');
    expect(formatEta(24 * 12.5)).toBe('12.5 days');
    expect(formatEta(24 * 365.25 * 3.2)).toBe('3.2 years');
    expect(formatEta(24 * 365.25 * 41_000)).toBe('41,000 years');
    expect(formatEta(24 * 365.25 * 456e6)).toBe('456 million years');
    expect(formatEta(24 * 365.25 * 2.5e9)).toBe('2.5 billion years');
  });
});

describe('other formatters', () => {
  it('formats durations, roi and signed money', () => {
    expect(formatDuration(3)).toBe('3h');
    expect(formatDuration(24 * 2 + 4)).toBe('2d 4h');
    expect(formatRoi(0.42)).toBe('+42.0%');
    expect(formatRoi(-0.5)).toBe('-50.0%');
    expect(formatRoi(2.345)).toBe('+235%');
    expect(formatSignedCents(150)).toBe('+$1.50');
    expect(formatSignedCents(-42)).toBe('-$0.42');
  });

  it('formats the sim clock from tick and ISO time', () => {
    const c = formatSimClock(30, '2030-01-02T06:00:00.000Z');
    expect(c).toEqual({ day: 'Day 2', time: '06:00', date: '2030-01-02' });
    expect(formatSimClock(5, 'garbage').time).toBe('05:00');
  });

  it('maps progress on a log scale', () => {
    expect(logProgress(0, 1e14)).toBe(0);
    expect(logProgress(1e14, 1e14)).toBe(1);
    const mid = logProgress(1e7, 1e14);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
  });
});
