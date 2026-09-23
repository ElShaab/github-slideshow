import type { BodyMeasurements, Sex, UnitSystem } from '@getfit/shared';
import { displayBounds } from '@getfit/shared';
import { cmToLengthText, convertLengthText, lengthToCm } from './units';

/**
 * Tape measurements while they are being typed.
 *
 * The form holds raw text so a half-typed number is never clamped mid-entry,
 * and that text is read in whatever units the user is currently in;
 * `toMeasurements` is the single point where it becomes the centimetres the
 * API takes, and it is deliberately strict — a reading outside the plausible
 * range is dropped rather than sent and rejected by the server.
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

/**
 * The plausible range for each reading, in centimetres.
 *
 * Kept metric whatever the user is reading, because this is the range the
 * server validates against; `boundsFor` expresses it in their units.
 *
 * Must stay in step with `bodyMeasurementsSchema` on the server.
 */
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

/**
 * Height and weight, in centimetres and kilograms.
 *
 * Height must stay in step with the profile schema and weight with
 * `assessmentWeightSchema`, both on the server.
 */
export const HEIGHT_BOUNDS_CM = { min: 120, max: 250 };
export const WEIGHT_BOUNDS_KG = { min: 30, max: 300 };

/** One reading's range, expressed in the units the field is showing. */
export function boundsFor(key: MeasurementKey, units: UnitSystem): { min: number; max: number } {
  return displayBounds(MEASUREMENT_BOUNDS[key], units, 'length');
}

/**
 * Converts the text draft into the centimetres the API takes, dropping blanks.
 *
 * The bounds are checked after conversion, so the same reading is accepted or
 * rejected identically whichever units it was typed in.
 */
export function toMeasurements(draft: MeasurementsDraft, units: UnitSystem): BodyMeasurements {
  const result: BodyMeasurements = {};
  for (const key of MEASUREMENT_KEYS) {
    const cm = lengthToCm(draft[key], units);
    const { min, max } = MEASUREMENT_BOUNDS[key];
    if (cm !== null && cm >= min && cm <= max) result[key] = cm;
  }
  return result;
}

/** Pre-fills the form from the readings taken at the last assessment. */
export function draftFromMeasurements(
  measurements: BodyMeasurements | null | undefined,
  units: UnitSystem,
): MeasurementsDraft {
  const draft = { ...EMPTY_MEASUREMENTS };
  if (!measurements) return draft;
  for (const key of MEASUREMENT_KEYS) {
    const value = measurements[key];
    if (typeof value === 'number') draft[key] = cmToLengthText(value, units);
  }
  return draft;
}

/**
 * Re-expresses a draft when the units toggle is flipped.
 *
 * What is on screen has to keep meaning the same thing: a waist typed as 85 cm
 * becomes 33.46 in, not 85 in.
 */
export function convertMeasurementsDraft(
  draft: MeasurementsDraft,
  from: UnitSystem,
  to: UnitSystem,
): MeasurementsDraft {
  if (from === to) return draft;
  return Object.fromEntries(
    MEASUREMENT_KEYS.map((key) => [key, convertLengthText(draft[key], from, to)]),
  ) as MeasurementsDraft;
}

/**
 * Whether the circumference formula can run on this draft. Women need a hip
 * reading as well; the formula is defined that way.
 */
export function isMeasured(
  draft: MeasurementsDraft,
  sex: Sex | null,
  units: UnitSystem,
): boolean {
  const values = toMeasurements(draft, units);
  if (!values.waistCm || !values.neckCm) return false;
  if (sex === 'female' && !values.hipCm) return false;
  return true;
}
