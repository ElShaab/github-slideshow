/**
 * Metric and imperial.
 *
 * Every reading GetFit stores is metric, so these conversions sit between the
 * user and the database in both directions. A rounding error here does not show
 * up as a wrong pixel — it shows up as a waist that grew half an inch overnight
 * because somebody opened the settings screen.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  CM_PER_INCH,
  KG_PER_POUND,
  cmToFeetInches,
  cmToInches,
  displayBounds,
  displayStep,
  feetInchesToCm,
  formatHeight,
  formatLength,
  formatMass,
  formatVolume,
  fromDisplayLength,
  fromDisplayMass,
  gymIncrementKg,
  inchesToCm,
  kgToPounds,
  lengthUnit,
  massUnit,
  poundsToKg,
  snapLoadKg,
  toDisplayLength,
  toDisplayMass,
  trim,
  type UnitSystem,
} from '../src/units';

const SYSTEMS: UnitSystem[] = ['metric', 'imperial'];

describe('the conversions are the defined ones', () => {
  test('an inch is exactly 25.4 mm', () => {
    assert.equal(CM_PER_INCH, 2.54);
    assert.equal(inchesToCm(1), 2.54);
    assert.equal(cmToInches(2.54), 1);
  });

  test('a pound is exactly 0.45359237 kg', () => {
    assert.equal(KG_PER_POUND, 0.45359237);
    assert.equal(poundsToKg(1), 0.45359237);
    assert.ok(Math.abs(kgToPounds(1) - 2.2046226218) < 1e-9);
  });

  test('a round trip returns the number it started with', () => {
    for (const cm of [40, 85.5, 183, 199.9]) {
      assert.ok(Math.abs(inchesToCm(cmToInches(cm)) - cm) < 1e-9, `${cm} cm drifted`);
    }
    for (const kg of [30, 86.4, 120, 299.5]) {
      assert.ok(Math.abs(poundsToKg(kgToPounds(kg)) - kg) < 1e-9, `${kg} kg drifted`);
    }
  });
});

describe('feet and inches', () => {
  test('a familiar height reads the way people say it', () => {
    assert.deepEqual(cmToFeetInches(182.88), { feet: 6, inches: 0 });
    assert.deepEqual(cmToFeetInches(180.34), { feet: 5, inches: 11 });
    assert.deepEqual(cmToFeetInches(152.4), { feet: 5, inches: 0 });
  });

  test('twelve inches carries into a foot instead of being printed', () => {
    // 5 ft 11.6 in rounds to 12 inches, which nobody writes and which reads as
    // shorter than the 6 ft it is.
    const nearlySix = feetInchesToCm(5, 11.6);
    assert.deepEqual(cmToFeetInches(nearlySix), { feet: 6, inches: 0 });
  });

  test('inches never reach twelve, at any height', () => {
    for (let cm = 120; cm <= 250; cm += 0.1) {
      const { inches } = cmToFeetInches(cm);
      assert.ok(inches >= 0 && inches < 12, `${cm} cm produced ${inches} inches`);
    }
  });

  test('a height survives the round trip to the nearest inch', () => {
    for (let total = 48; total <= 96; total += 1) {
      const cm = feetInchesToCm(Math.floor(total / 12), total % 12);
      const back = cmToFeetInches(cm);
      assert.equal(back.feet * 12 + back.inches, total);
    }
  });
});

describe('formatting', () => {
  test('height', () => {
    assert.equal(formatHeight(183, 'metric'), '183 cm');
    assert.equal(formatHeight(182.88, 'imperial'), '6′ 0″');
  });

  test('a tape measurement', () => {
    assert.equal(formatLength(85, 'metric'), '85 cm');
    assert.equal(formatLength(85, 'imperial'), '33.5 in');
    assert.equal(formatLength(85.5, 'metric'), '85.5 cm');
  });

  test('a mass', () => {
    assert.equal(formatMass(86, 'metric'), '86 kg');
    assert.equal(formatMass(86, 'imperial'), '189.6 lb');
    assert.equal(formatMass(60.5, 'metric'), '60.5 kg');
  });

  test('volume drops the decimals it cannot justify', () => {
    assert.equal(formatVolume(4210.4, 'metric'), '4,210 kg');
    assert.equal(formatVolume(1000, 'imperial'), '2,205 lb');
  });

  test('nothing measured reads as a dash, not a zero', () => {
    for (const units of SYSTEMS) {
      assert.equal(formatHeight(null, units), '—');
      assert.equal(formatLength(undefined, units), '—');
      assert.equal(formatMass(null, units), '—');
      assert.equal(formatVolume(Number.NaN, units), '—');
    }
  });

  test('the bare units', () => {
    assert.equal(massUnit('metric'), 'kg');
    assert.equal(massUnit('imperial'), 'lb');
    assert.equal(lengthUnit('metric'), 'cm');
    assert.equal(lengthUnit('imperial'), 'in');
  });
});

describe('trimming a number for display', () => {
  test('a whole number keeps no decimal point', () => {
    assert.equal(trim(85), '85');
    assert.equal(trim(85.04), '85');
  });

  test('a fraction keeps one digit', () => {
    assert.equal(trim(85.5), '85.5');
    assert.equal(trim(33.46), '33.5');
  });

  test('zeros are stripped from the fraction, never from the integer', () => {
    assert.equal(trim(150), '150');
    assert.equal(trim(100), '100');
    assert.equal(trim(10.5, 2), '10.5');
  });
});

describe('what a gym can actually load', () => {
  test('metric moves in 2.5 kg', () => {
    assert.equal(gymIncrementKg('metric'), 2.5);
    assert.equal(snapLoadKg(61, 'metric'), 60);
    assert.equal(snapLoadKg(61.5, 'metric'), 62.5);
  });

  test('imperial lands on whole 5 lb steps', () => {
    // 2.5 kg converted is 5.51 lb — a weight no imperial rack can hold.
    for (const kg of [40, 61, 100.4, 142.9]) {
      const snapped = snapLoadKg(kg, 'imperial');
      const pounds = kgToPounds(snapped);
      assert.ok(
        Math.abs(pounds - Math.round(pounds)) < 1e-6 && Math.round(pounds) % 5 === 0,
        `${kg} kg snapped to ${pounds} lb, which is not on the 5 lb grid`,
      );
    }
  });

  test('snapping stays near the weight it was given', () => {
    for (const units of SYSTEMS) {
      for (const kg of [20, 47.3, 88, 150.9]) {
        assert.ok(
          Math.abs(snapLoadKg(kg, units) - kg) <= gymIncrementKg(units) / 2 + 1e-6,
          `${kg} kg moved too far in ${units}`,
        );
      }
    }
  });

  test('an empty bar is not given plates', () => {
    for (const units of SYSTEMS) {
      assert.equal(snapLoadKg(0, units), 0);
      assert.equal(snapLoadKg(-5, units), 0);
      assert.equal(snapLoadKg(Number.NaN, units), 0);
    }
  });
});

describe('entry', () => {
  test('what a field shows converts back to what is stored', () => {
    for (const units of SYSTEMS) {
      for (const cm of [40, 85.5, 183]) {
        assert.ok(Math.abs(fromDisplayLength(toDisplayLength(cm, units), units) - cm) < 1e-9);
      }
      for (const kg of [30, 86.4, 200]) {
        assert.ok(Math.abs(fromDisplayMass(toDisplayMass(kg, units), units) - kg) < 1e-9);
      }
    }
  });

  test('metric entry is the identity, so nothing is touched needlessly', () => {
    assert.equal(toDisplayLength(85.5, 'metric'), 85.5);
    assert.equal(fromDisplayMass(86, 'metric'), 86);
  });

  test('bounds widen outward, so a legitimate reading is never refused', () => {
    const waist = { min: 40, max: 200 };
    const metric = displayBounds(waist, 'metric', 'length');
    assert.deepEqual(metric, { min: 40, max: 200 });

    const imperial = displayBounds(waist, 'imperial', 'length');
    assert.ok(inchesToCm(imperial.min) <= waist.min, 'the minimum was rounded inward');
    assert.ok(inchesToCm(imperial.max) >= waist.max, 'the maximum was rounded inward');
    assert.deepEqual(imperial, { min: 15, max: 79 });
  });

  test('the step suits the unit on the tape', () => {
    assert.equal(displayStep('length', 'metric'), 0.5);
    assert.equal(displayStep('length', 'imperial'), 0.25);
    assert.equal(displayStep('height', 'metric'), 1);
    assert.equal(displayStep('height', 'imperial'), 1);
  });
});
