/**
 * Numeric helpers for the workout inputs.
 *
 * Kept free of React and React Native so the arithmetic can be tested directly
 * — both of these encode rules that were previously wrong in ways a type
 * checker cannot catch.
 */

/**
 * Pushes a running rest period out by `extraSeconds`.
 *
 * The point is that this extends rather than restarts: recomputing the end from
 * the full prescribed duration turned five seconds left into a fresh two
 * minutes. When the clock has already run out, the extension starts from now
 * rather than from a moment in the past.
 */
export function extendRestEnd(currentEndsAt: number, now: number, extraSeconds: number): number {
  return Math.max(currentEndsAt, now) + extraSeconds * 1000;
}

/**
 * Brings a typed value back inside its allowed range.
 *
 * Applied when a field is left rather than on each keystroke: typing "15" into
 * a field with a minimum of 10 would otherwise be rewritten to 10 as soon as
 * "1" was entered. An unclamped value fails validation for the whole request,
 * and an over-long cardio entry would reject a finished workout and lose every
 * set logged with it.
 */
export function clampNumericInput(
  value: string,
  min: number,
  max: number,
  decimal: boolean,
): string {
  const parsed = Number.parseFloat(value);
  const target = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
  return decimal ? String(Math.round(target * 10) / 10) : String(Math.round(target));
}
