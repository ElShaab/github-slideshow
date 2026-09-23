import {
  cmToInches,
  inchesToCm,
  kgToPounds,
  poundsToKg,
  trim,
  type UnitSystem,
} from '@getfit/shared';

/**
 * Unit conversion at the level the forms work in: text.
 *
 * Fields hold raw text so a half-typed number is never clamped mid-entry, and
 * that text is read in whatever units the user is currently in. These are the
 * two places that matters — submitting, where text becomes the centimetres and
 * kilograms everything is stored in, and switching the toggle, where the text
 * already on screen has to be re-expressed without changing what it means.
 */

/** Decimals worth keeping: a centimetre is coarser than an inch. */
const LENGTH_DIGITS: Record<UnitSystem, number> = { metric: 1, imperial: 2 };
const MASS_DIGITS: Record<UnitSystem, number> = { metric: 1, imperial: 1 };

/** Parses field text, returning null for anything that is not a number. */
export function parseField(text: string): number | null {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

/* ------------------------------ lengths ------------------------------ */

/** Field text, read as the user's units, in centimetres. */
export function lengthToCm(text: string, units: UnitSystem): number | null {
  const value = parseField(text);
  if (value === null) return null;
  return units === 'metric' ? value : inchesToCm(value);
}

/** A stored centimetre reading, as the text a field should show. */
export function cmToLengthText(cm: number | null | undefined, units: UnitSystem): string {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return '';
  return units === 'metric' ? trim(cm, 1) : trim(cmToInches(cm), LENGTH_DIGITS.imperial);
}

/* ------------------------------ masses ------------------------------- */

export function massToKg(text: string, units: UnitSystem): number | null {
  const value = parseField(text);
  if (value === null) return null;
  return units === 'metric' ? value : poundsToKg(value);
}

export function kgToMassText(kg: number | null | undefined, units: UnitSystem): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '';
  return units === 'metric' ? trim(kg, MASS_DIGITS.metric) : trim(kgToPounds(kg), MASS_DIGITS.imperial);
}

/* ----------------------------- switching ----------------------------- */

/**
 * Re-expresses text already typed into a field, when the toggle is flipped.
 *
 * Blank stays blank, and text that is not a number is left exactly as typed —
 * converting "8" out of a half-finished "85" would rewrite what somebody is in
 * the middle of entering.
 */
export function convertLengthText(text: string, from: UnitSystem, to: UnitSystem): string {
  if (from === to || text.trim() === '') return text;
  const cm = lengthToCm(text, from);
  return cm === null ? text : cmToLengthText(cm, to);
}

export function convertMassText(text: string, from: UnitSystem, to: UnitSystem): string {
  if (from === to || text.trim() === '') return text;
  const kg = massToKg(text, from);
  return kg === null ? text : kgToMassText(kg, to);
}

/* ------------------------------ heights ------------------------------ */

/**
 * Height is held as one number in the user's units — centimetres, or whole
 * inches — so the draft stays a single field. Feet and inches are a presentation
 * of that total, split and rejoined by the control that shows them.
 */
export function splitInches(total: number): { feet: number; inches: number } {
  const whole = Math.max(0, Math.round(total));
  return { feet: Math.floor(whole / 12), inches: whole % 12 };
}

export function joinInches(feet: number, inches: number): number {
  return feet * 12 + inches;
}

/**
 * Re-expresses a typed height when the toggle is flipped.
 *
 * Whole units on both sides: nobody enters their height to a tenth of an inch,
 * and a decimal here would be split into feet and inches and lost anyway.
 */
export function convertHeightText(text: string, from: UnitSystem, to: UnitSystem): string {
  if (from === to || text.trim() === '') return text;
  const value = parseField(text);
  if (value === null) return text;
  return String(Math.round(from === 'metric' ? cmToInches(value) : inchesToCm(value)));
}

/** Typed height, in centimetres. */
export function heightToCm(text: string, units: UnitSystem): number | null {
  const value = parseField(text);
  if (value === null) return null;
  return units === 'metric' ? value : inchesToCm(value);
}

/** A stored height, as the text the control should show. */
export function cmToHeightText(cm: number | null | undefined, units: UnitSystem): string {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return '';
  return String(Math.round(units === 'metric' ? cm : cmToInches(cm)));
}
