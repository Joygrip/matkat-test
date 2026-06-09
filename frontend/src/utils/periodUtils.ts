import type { Period } from '../types';

/**
 * Returns the earliest OPEN period by year/month, or null when no open periods exist.
 *
 * In MatKat, OPEN status defines the active planning window.  The earliest open
 * period is always the default active period — the product does not use today's
 * calendar date to pick a default.  Historical years are expected to be LOCKED,
 * so they are automatically excluded from this result.
 */
export function getEarliestOpenPeriod(periods: Period[]): Period | null {
  const sorted = [...periods]
    .filter(p => p.status === 'open')
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  return sorted[0] ?? null;
}
