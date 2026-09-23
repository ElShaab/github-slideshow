/**
 * Formatting helpers shared by the API responses and the mobile UI.
 *
 * Anything carrying a unit lives in `units.ts` instead, because how a weight or
 * a length reads depends on the system the user chose.
 */

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(2);
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatMinutes(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatRepRange(min: number, max: number): string {
  return min === max ? `${min}` : `${min}–${max}`;
}

/** Weights are prescribed on the increments a real gym actually has. */
export function roundToIncrement(weightKg: number, increment = 2.5): number {
  if (weightKg <= 0) return 0;
  const rounded = Math.round(weightKg / increment) * increment;
  return Math.round(rounded * 100) / 100;
}

/** Epley formula, clamped so absurd rep counts cannot inflate the estimate. */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  const cappedReps = Math.min(reps, 12);
  return Math.round(weightKg * (1 + cappedReps / 30) * 10) / 10;
}

export function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
