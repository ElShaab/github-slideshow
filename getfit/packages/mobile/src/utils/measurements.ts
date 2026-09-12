import type { BodyMeasurements, Sex } from '@getfit/shared';

/**
 * Tape measurements while they are being typed.
 *
 * The form holds raw text so a half-typed number is never clamped mid-entry;
 * `toMeasurements` is the single point where text becomes the numbers the API
 * takes, and it is deliberately strict — a reading outside the plausible range
 * is dropped rather than sent and rejected by the server.
 */
export type MeasurementsDraft = Record<MeasurementKey, string>;

export type MeasurementKey =
  | 'waistCm'
  | 'neckCm'
  | 'hipCm'
  | 'shoulderCm'
  | 'leftArmCm'
  | 'rightArmCm'
  | 'leftThighCm'
  | 'rightThighCm';

/** Must stay in step with `bodyMeasurementsSchema` on the server. */
export const MEASUREMENT_BOUNDS: Record<MeasurementKey, { min: number; max: number }> = {
  waistCm: { min: 40, max: 200 },
  neckCm: { min: 20, max: 70 },
  hipCm: { min: 50, max: 200 },
  shoulderCm: { min: 60, max: 200 },
  leftArmCm: { min: 15, max: 70 },
  rightArmCm: { min: 15, max: 70 },
  leftThighCm: { min: 25, max: 110 },
  rightThighCm: { min: 25, max: 110 },
};

export const MEASUREMENT_KEYS = Object.keys(MEASUREMENT_BOUNDS) as MeasurementKey[];

export const EMPTY_MEASUREMENTS: MeasurementsDraft = Object.fromEntries(
  MEASUREMENT_KEYS.map((key) => [key, '']),
) as MeasurementsDraft;

/** Converts the text draft into the numbers the API takes, dropping blanks. */
export function toMeasurements(draft: MeasurementsDraft): BodyMeasurements {
  const result: BodyMeasurements = {};
  for (const key of MEASUREMENT_KEYS) {
    const value = Number.parseFloat(draft[key]);
    const { min, max } = MEASUREMENT_BOUNDS[key];
    if (Number.isFinite(value) && value >= min && value <= max) result[key] = value;
  }
  return result;
}

/** Pre-fills the form from the readings taken at the last assessment. */
export function draftFromMeasurements(measurements?: BodyMeasurements | null): MeasurementsDraft {
  const draft = { ...EMPTY_MEASUREMENTS };
  if (!measurements) return draft;
  for (const key of MEASUREMENT_KEYS) {
    const value = measurements[key];
    if (typeof value === 'number') draft[key] = String(value);
  }
  return draft;
}

/**
 * Whether the circumference formula can run on this draft. Women need a hip
 * reading as well; the formula is defined that way.
 */
export function isMeasured(draft: MeasurementsDraft, sex: Sex | null): boolean {
  const values = toMeasurements(draft);
  if (!values.waistCm || !values.neckCm) return false;
  if (sex === 'female' && !values.hipCm) return false;
  return true;
}
