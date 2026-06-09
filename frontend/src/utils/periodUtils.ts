import type { Period } from '../types';

/**
 * Returns the nearest open period whose year/month >= the current year/month.
 * Falls back to the most recent open period when all open periods are in the past.
 * Returns null when no open periods exist at all.
 *
 * Use this everywhere the app must pick a "current" period as a default so that
 * historical open periods (inserted for import purposes) do not hijack the
 * default selection.
 */
export function getNearestCurrentOrFutureOpenPeriod(periods: Period[]): Period | null {
  const now = new Date();
  // 1-indexed month arithmetic: Jan 2026 → 2026*12 + 1 = 24313
  const currentYM = now.getFullYear() * 12 + now.getMonth() + 1;

  const openPeriods = [...periods]
    .filter(p => p.status === 'open')
    .sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  if (openPeriods.length === 0) return null;

  // Prefer the earliest open period that is current or in the future.
  const currentOrFuture = openPeriods.find(p => p.year * 12 + p.month >= currentYM);
  if (currentOrFuture) return currentOrFuture;

  // Every open period is historical — return the most recent one as a graceful fallback.
  return openPeriods[openPeriods.length - 1];
}
