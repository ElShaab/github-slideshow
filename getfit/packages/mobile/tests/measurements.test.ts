/**
 * The text-to-number boundary for tape measurements.
 *
 * This is the one place a typed reading becomes a number the analysis runs on,
 * so a bad value dropped here is a bad body-fat figure avoided, and a good
 * value dropped here is a measurement silently downgraded to a BMI estimate.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  EMPTY_MEASUREMENTS,
  MEASUREMENT_KEYS,
  draftFromMeasurements,
  isMeasured,
  toMeasurements,
} from '../src/utils/measurements';

describe('toMeasurements', () => {
  test('an untouched form sends nothing at all', () => {
    assert.deepEqual(toMeasurements(EMPTY_MEASUREMENTS), {});
  });

  test('reads every field, decimals included', () => {
    const draft = {
      ...EMPTY_MEASUREMENTS,
      waistCm: '85.5',
      neckCm: '38',
      hipCm: '95',
      shoulderCm: '120',
      leftArmCm: '36',
      rightArmCm: '36.5',
      leftThighCm: '58',
      rightThighCm: '58',
    };

    assert.deepEqual(toMeasurements(draft), {
      waistCm: 85.5,
      neckCm: 38,
      hipCm: 95,
      shoulderCm: 120,
      leftArmCm: 36,
      rightArmCm: 36.5,
      leftThighCm: 58,
      rightThighCm: 58,
    });
  });

  test('drops implausible readings rather than sending them', () => {
    // A slipped decimal point: 8.5 cm and 850 cm are both out of range, and a
    // waist of either would drive the formula somewhere absurd.
    for (const waistCm of ['8.5', '850', '0', '-85']) {
      assert.deepEqual(toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm }), {}, waistCm);
    }
  });

  test('drops half-typed and non-numeric input without throwing', () => {
    for (const waistCm of ['', '.', '-', 'abc', '8 5']) {
      assert.deepEqual(toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm }), {}, `"${waistCm}"`);
    }
  });

  test('one bad field does not discard the good ones', () => {
    const result = toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '900' });
    assert.deepEqual(result, { waistCm: 85 });
  });
});

describe('draftFromMeasurements', () => {
  test('round-trips a stored assessment back into the form', () => {
    const stored = { waistCm: 85.5, neckCm: 38, leftArmCm: 36 };
    const draft = draftFromMeasurements(stored);

    assert.equal(draft.waistCm, '85.5');
    assert.equal(draft.neckCm, '38');
    assert.equal(draft.leftArmCm, '36');
    assert.equal(draft.hipCm, '', 'an unmeasured field must come back blank');
    assert.deepEqual(toMeasurements(draft), stored, 'the round trip changed the numbers');
  });

  test('no previous assessment gives an empty form', () => {
    assert.deepEqual(draftFromMeasurements(null), EMPTY_MEASUREMENTS);
    assert.deepEqual(draftFromMeasurements(undefined), EMPTY_MEASUREMENTS);
    assert.equal(Object.keys(EMPTY_MEASUREMENTS).length, MEASUREMENT_KEYS.length);
  });
});

describe('isMeasured', () => {
  test('men need a waist and a neck', () => {
    assert.equal(isMeasured({ ...EMPTY_MEASUREMENTS, waistCm: '85' }, 'male'), false);
    assert.equal(isMeasured({ ...EMPTY_MEASUREMENTS, neckCm: '38' }, 'male'), false);
    assert.equal(
      isMeasured({ ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '38' }, 'male'),
      true,
    );
  });

  test('women need hips as well, because the formula does', () => {
    const partial = { ...EMPTY_MEASUREMENTS, waistCm: '75', neckCm: '32' };
    assert.equal(isMeasured(partial, 'female'), false);
    assert.equal(isMeasured({ ...partial, hipCm: '95' }, 'female'), true);
  });

  test('an implausible reading does not count as measured', () => {
    assert.equal(
      isMeasured({ ...EMPTY_MEASUREMENTS, waistCm: '8.5', neckCm: '38' }, 'male'),
      false,
    );
  });
});
