/**
 * The anthropometric formulas the whole analysis rests on.
 *
 * These replaced an estimate that added `(hash(photo) - 0.5) * 7` to a BMI
 * figure — up to 3.5 percentage points of movement driven by nothing but file
 * bytes. Every number here is checked against the published formula, so a
 * regression in the arithmetic cannot reach a user's body-fat reading.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  bodyFatFromBmi,
  bodyFatFromCircumference,
  estimateBodyFat,
  estimateSkeletalMuscleKg,
  estimateSymmetry,
  leanMassKg,
  limbBalance,
  shoulderToWaistRatio,
  waistToHeightRatio,
} from '../src/bodyComposition';

const male = { sex: 'male' as const, heightCm: 180 };
const female = { sex: 'female' as const, heightCm: 165 };

/** Reference values computed independently from the published constants. */
describe('bodyFatFromCircumference (US Navy)', () => {
  const cases: Array<[string, Parameters<typeof bodyFatFromCircumference>[0], typeof male, number]> = [
    ['average male', { waistCm: 85, neckCm: 38 }, male, 16.2],
    ['lean male', { waistCm: 78, neckCm: 39 }, { sex: 'male', heightCm: 178 }, 9.5],
    ['heavier male', { waistCm: 105, neckCm: 42 }, { sex: 'male', heightCm: 175 }, 28.0],
    ['average female', { waistCm: 75, neckCm: 32, hipCm: 95 }, female, 27.7],
  ];

  for (const [name, measurements, profile, expected] of cases) {
    test(`${name} reads ${expected}%`, () => {
      const value = bodyFatFromCircumference(measurements, profile);
      assert.ok(value !== null, 'expected a reading');
      assert.ok(
        Math.abs(value - expected) < 0.2,
        `expected ~${expected}%, got ${value.toFixed(2)}%`,
      );
    });
  }

  test('returns null rather than guessing at a missing reading', () => {
    assert.equal(bodyFatFromCircumference({}, male), null);
    assert.equal(bodyFatFromCircumference({ waistCm: 85 }, male), null);
    assert.equal(bodyFatFromCircumference({ neckCm: 38 }, male), null);
    // The female formula needs hips; without them there is nothing to compute.
    assert.equal(bodyFatFromCircumference({ waistCm: 75, neckCm: 32 }, female), null);
  });

  test('returns null for measurements with no logarithm to take', () => {
    // A neck wider than the waist makes log10(waist - neck) undefined.
    assert.equal(bodyFatFromCircumference({ waistCm: 36, neckCm: 40 }, male), null);
    assert.equal(bodyFatFromCircumference({ waistCm: 40, neckCm: 40 }, male), null);
    assert.equal(
      bodyFatFromCircumference({ waistCm: 40, neckCm: 200, hipCm: 50 }, female),
      null,
    );
  });

  test('a mistyped reading is clamped into the plausible human range', () => {
    const tiny = bodyFatFromCircumference({ waistCm: 41, neckCm: 40 }, male);
    assert.ok(tiny !== null && tiny >= 3, 'a near-zero girth should clamp, not go negative');

    const huge = bodyFatFromCircumference({ waistCm: 200, neckCm: 20 }, male);
    assert.ok(huge !== null && huge <= 60, 'an extreme girth should clamp to the range top');
  });

  test('a wider waist always reads higher, at every size', () => {
    let previous = -Infinity;
    for (let waistCm = 70; waistCm <= 130; waistCm += 5) {
      const value = bodyFatFromCircumference({ waistCm, neckCm: 38 }, male);
      assert.ok(value !== null);
      assert.ok(value > previous, `${waistCm} cm did not read higher than the size below`);
      previous = value;
    }
  });
});

describe('bodyFatFromBmi (Deurenberg)', () => {
  test('matches the published formula', () => {
    // BMI 25.31 at 30 years: 1.2*25.31 + 0.23*30 - 10.8 - 5.4 = 21.07
    const value = bodyFatFromBmi({ sex: 'male', age: 30, heightCm: 180, weightKg: 82 });
    assert.ok(Math.abs(value - 21.07) < 0.05, `got ${value}`);
  });

  test('reads higher for women at the same BMI, as the formula requires', () => {
    const profile = { age: 30, heightCm: 180, weightKg: 82 };
    const asMale = bodyFatFromBmi({ ...profile, sex: 'male' });
    const asFemale = bodyFatFromBmi({ ...profile, sex: 'female' });
    assert.ok(Math.abs(asFemale - asMale - 10.8) < 0.01, 'the sex term is wrong');
  });

  test('stays in the plausible range even for extreme inputs', () => {
    const skeletal = bodyFatFromBmi({ sex: 'male', age: 18, heightCm: 200, weightKg: 40 });
    assert.ok(skeletal >= 3 && skeletal <= 60);
    const extreme = bodyFatFromBmi({ sex: 'female', age: 80, heightCm: 150, weightKg: 200 });
    assert.ok(extreme >= 8 && extreme <= 65);
  });
});

describe('estimateBodyFat', () => {
  const profile = { sex: 'male' as const, age: 30, heightCm: 180, weightKg: 82 };

  test('prefers the tape and reports it as measured', () => {
    const result = estimateBodyFat({ waistCm: 85, neckCm: 38 }, profile);
    assert.equal(result.method, 'navy');
    assert.ok(Math.abs(result.bodyFatPercent - 16.2) < 0.2);
    assert.ok(result.confidence > 0.8);
  });

  test('falls back to BMI, says so, and claims less confidence', () => {
    const measured = estimateBodyFat({ waistCm: 85, neckCm: 38 }, profile);
    const fallback = estimateBodyFat({}, profile);

    assert.equal(fallback.method, 'bmi');
    assert.ok(Math.abs(fallback.bodyFatPercent - 21.1) < 0.1);
    assert.ok(fallback.confidence < measured.confidence);
  });

  test('an impossible tape reading falls back rather than failing', () => {
    const result = estimateBodyFat({ waistCm: 36, neckCm: 40 }, profile);
    assert.equal(result.method, 'bmi');
    assert.ok(Number.isFinite(result.bodyFatPercent));
  });
});

describe('mass', () => {
  test('lean mass is exact given body fat', () => {
    assert.equal(leanMassKg(82, 16), 68.9);
    assert.equal(leanMassKg(100, 0), 100);
  });

  test('skeletal muscle is a portion of lean mass, never more', () => {
    for (const bodyFat of [5, 16, 30, 45]) {
      const lean = leanMassKg(82, bodyFat);
      const muscle = estimateSkeletalMuscleKg(82, bodyFat);
      assert.ok(muscle < lean, `${bodyFat}% body fat put muscle above lean mass`);
      assert.ok(muscle > 0);
    }
  });

  test('more fat at the same weight means less muscle', () => {
    assert.ok(estimateSkeletalMuscleKg(82, 12) > estimateSkeletalMuscleKg(82, 30));
  });
});

describe('waistToHeightRatio', () => {
  test('is the measured ratio, to three places', () => {
    assert.equal(waistToHeightRatio(85, 180), 0.472);
    assert.equal(waistToHeightRatio(90, 180), 0.5);
  });
});

describe('estimateSymmetry', () => {
  test('is null when neither pair was measured', () => {
    assert.equal(estimateSymmetry({}), null);
    assert.equal(estimateSymmetry({ waistCm: 85, neckCm: 38 }), null);
    // One side alone says nothing about balance.
    assert.equal(estimateSymmetry({ leftArmCm: 36 }), null);
  });

  test('even sides read as 100', () => {
    assert.equal(estimateSymmetry({ leftArmCm: 36, rightArmCm: 36 }), 100);
  });

  test('a 1% difference is still normal, and larger gaps cost points', () => {
    const small = estimateSymmetry({ leftArmCm: 36, rightArmCm: 36.36 });
    assert.ok(small !== null && small > 99, `a 1% gap should barely register, got ${small}`);

    const noticeable = estimateSymmetry({ leftArmCm: 34, rightArmCm: 38 });
    assert.ok(noticeable !== null && noticeable < 90, `an 11% gap should score low, got ${noticeable}`);

    assert.ok((noticeable ?? 0) < (small ?? 0));
  });

  test('averages across both pairs when both are measured', () => {
    const armsOnly = estimateSymmetry({ leftArmCm: 34, rightArmCm: 38 });
    const both = estimateSymmetry({
      leftArmCm: 34,
      rightArmCm: 38,
      leftThighCm: 58,
      rightThighCm: 58,
    });
    assert.ok(both !== null && armsOnly !== null && both > armsOnly, 'even legs should pull it up');
  });

  test('never falls below the floor, whichever side is larger', () => {
    const left = estimateSymmetry({ leftArmCm: 60, rightArmCm: 20 });
    const right = estimateSymmetry({ leftArmCm: 20, rightArmCm: 60 });
    assert.equal(left, right, 'which side is larger must not change the score');
    assert.ok(left !== null && left >= 50);
  });
});

describe('limbBalance', () => {
  test('is zero for an unmeasured pair', () => {
    assert.equal(limbBalance(undefined, undefined), 0);
    assert.equal(limbBalance(36, undefined), 0);
    assert.equal(limbBalance(0, 36), 0);
  });

  test('is signed, with positive meaning the right side is larger', () => {
    assert.ok(limbBalance(34, 38) > 0);
    assert.ok(limbBalance(38, 34) < 0);
    assert.equal(limbBalance(36, 36), 0);
    assert.equal(limbBalance(34, 38), -limbBalance(38, 34));
  });
});

describe('shoulderToWaistRatio', () => {
  test('is null without both readings', () => {
    assert.equal(shoulderToWaistRatio({}), null);
    assert.equal(shoulderToWaistRatio({ shoulderCm: 120 }), null);
    assert.equal(shoulderToWaistRatio({ waistCm: 80 }), null);
  });

  test('is the measured ratio when both are given', () => {
    assert.equal(shoulderToWaistRatio({ shoulderCm: 120, waistCm: 80 }), 1.5);
  });
});
