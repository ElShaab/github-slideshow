/**
 * Metric and imperial.
 *
 * Everything GetFit stores is metric — centimetres, kilograms — and nothing
 * here changes that. A unit system is a presentation choice: it decides what a
 * field shows and what the number typed into it means, and it is applied at the
 * edges. Storing what the user happened to be looking at would make a history
 * incomparable with itself the first time somebody changed the setting.
 *
 * The conversions are exact by definition: an inch is 25.4 mm and a pound is
 * 0.45359237 kg, both by international agreement rather than approximation.
 */

export type UnitSystem = 'metric' | 'imperial';

export const CM_PER_INCH = 2.54;
export const KG_PER_POUND = 0.45359237;
export const INCHES_PER_FOOT = 12;

export const cmToInches = (cm: number): number => cm / CM_PER_INCH;
export const inchesToCm = (inches: number): number => inches * CM_PER_INCH;
export const kgToPounds = (kg: number): number => kg / KG_PER_POUND;
export const poundsToKg = (pounds: number): number => pounds * KG_PER_POUND;

/** Rounds to `digits` decimals without the floating-point fuzz of toFixed. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A number with at most `digits` decimals, and no trailing `.0`. */
export function trim(value: number, digits = 1): string {
  const rounded = round(value, digits);
  if (Number.isInteger(rounded)) return String(rounded);
  // Only zeros after the point go: stripping them from the integer part would
  // turn 150 into 15.
  return rounded
    .toFixed(digits)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

/* ------------------------------ lengths ------------------------------ */

/**
 * A height split for a feet-and-inches control.
 *
 * The inches are rounded first and then carried, because 5 ft 11.6 in rounds to
 * 5 ft 12 in — a height nobody writes, and one that reads as shorter than the
 * 6 ft it actually is.
 */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const total = Math.round(cmToInches(cm));
  return { feet: Math.floor(total / INCHES_PER_FOOT), inches: total % INCHES_PER_FOOT };
}

export function feetInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * INCHES_PER_FOOT + inches);
}

/** A height, as the wearer would say it. */
export function formatHeight(cm: number | null | undefined, units: UnitSystem): string {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return '—';
  if (units === 'metric') return `${Math.round(cm)} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet}′ ${inches}″`;
}

/** A tape measurement — a waist, a bicep — where a half unit matters. */
export function formatLength(cm: number | null | undefined, units: UnitSystem): string {
  if (cm === null || cm === undefined || !Number.isFinite(cm)) return '—';
  return units === 'metric' ? `${trim(cm)} cm` : `${trim(cmToInches(cm))} in`;
}

/* ------------------------------ weights ------------------------------ */

/**
 * A body weight or a lifted load.
 *
 * One decimal in both systems: a pound is finer than a kilogram, so this is if
 * anything more precise than the scale the number came from.
 */
export function formatMass(kg: number | null | undefined, units: UnitSystem): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  return units === 'metric' ? `${trim(kg)} kg` : `${trim(kgToPounds(kg))} lb`;
}

/** Session volume, which is large enough that decimals are noise. */
export function formatVolume(kg: number | null | undefined, units: UnitSystem): string {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '—';
  const value = units === 'metric' ? kg : kgToPounds(kg);
  return `${Math.round(value).toLocaleString()} ${massUnit(units)}`;
}

/** The bare unit, for a label or an axis. */
export const massUnit = (units: UnitSystem): string => (units === 'metric' ? 'kg' : 'lb');
export const lengthUnit = (units: UnitSystem): string => (units === 'metric' ? 'cm' : 'in');

/* ------------------------------- gyms -------------------------------- */

/**
 * The smallest jump a gym can actually make, in kilograms.
 *
 * A metric gym's smallest pair of plates is 1.25 kg, so loads move in 2.5 kg.
 * An imperial gym's is 2.5 lb, so they move in 5 lb — 2.268 kg, which is why
 * prescribing in kilograms and converting produces weights no imperial rack can
 * be loaded to.
 */
export const POUND_INCREMENT_KG = 5 * KG_PER_POUND;
export const KILO_INCREMENT_KG = 2.5;

export const gymIncrementKg = (units: UnitSystem): number =>
  units === 'metric' ? KILO_INCREMENT_KG : POUND_INCREMENT_KG;

/**
 * Snaps a load to something the user can actually load onto a bar.
 *
 * In imperial that means a whole number of pounds on a 5 lb grid, converted
 * back to the kilograms everything else is stored in.
 */
export function snapLoadKg(kg: number, units: UnitSystem): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  if (units === 'metric') return round(Math.round(kg / KILO_INCREMENT_KG) * KILO_INCREMENT_KG, 2);
  // Returned unrounded: the pound figure is the one the user loads and reads,
  // and rounding the kilogram it converts to would knock it off the 5 lb grid.
  const pounds = Math.round(kgToPounds(kg) / 5) * 5;
  return poundsToKg(pounds);
}

/* ------------------------------- entry ------------------------------- */

/** Converts a stored centimetre reading into what the field should show. */
export const toDisplayLength = (cm: number, units: UnitSystem): number =>
  units === 'metric' ? cm : cmToInches(cm);

/** Converts what was typed into a length field back into centimetres. */
export const fromDisplayLength = (value: number, units: UnitSystem): number =>
  units === 'metric' ? value : inchesToCm(value);

export const toDisplayMass = (kg: number, units: UnitSystem): number =>
  units === 'metric' ? kg : kgToPounds(kg);

export const fromDisplayMass = (value: number, units: UnitSystem): number =>
  units === 'metric' ? value : poundsToKg(value);

/**
 * A metric bound expressed in the display unit.
 *
 * Widened outward on both ends, so rounding can never put a legitimate reading
 * outside the range that accepts it — a 40 cm minimum is 15.75 in, and a user
 * typing 15 in should not be told 15 is too small when 15.75 in is what the
 * server actually rejects below.
 */
export function displayBounds(
  bounds: { min: number; max: number },
  units: UnitSystem,
  kind: 'length' | 'mass',
): { min: number; max: number } {
  const convert = kind === 'length' ? toDisplayLength : toDisplayMass;
  return {
    min: Math.floor(convert(bounds.min, units)),
    max: Math.ceil(convert(bounds.max, units)),
  };
}

/** The step the +/- buttons take, in the display unit. */
export function displayStep(kind: 'length' | 'mass' | 'height', units: UnitSystem): number {
  if (units === 'metric') return kind === 'height' ? 1 : 0.5;
  return kind === 'height' ? 1 : 0.25;
}
