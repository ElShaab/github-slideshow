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
  boundsFor,
  convertMeasurementsDraft,
  MEASUREMENT_KEYS,
  draftFromMeasurements,
  isMeasured,
  toMeasurements,
} from '../src/utils/measurements';

describe('toMeasurements', () => {
  test('an untouched form sends nothing at all', () => {
    assert.deepEqual(toMeasurements(EMPTY_MEASUREMENTS, 'metric'), {});
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

    assert.deepEqual(toMeasurements(draft, 'metric'), {
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
      assert.deepEqual(toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm }, 'metric'), {}, waistCm);
    }
  });

  test('drops half-typed and non-numeric input without throwing', () => {
    for (const waistCm of ['', '.', '-', 'abc', '8 5']) {
      assert.deepEqual(toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm }, 'metric'), {}, `"${waistCm}"`);
    }
  });

  test('one bad field does not discard the good ones', () => {
    const result = toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '900' }, 'metric');
    assert.deepEqual(result, { waistCm: 85 });
  });
});

describe('draftFromMeasurements', () => {
  test('round-trips a stored assessment back into the form', () => {
    const stored = { waistCm: 85.5, neckCm: 38, leftArmCm: 36 };
    const draft = draftFromMeasurements(stored, 'metric');

    assert.equal(draft.waistCm, '85.5');
    assert.equal(draft.neckCm, '38');
    assert.equal(draft.leftArmCm, '36');
    assert.equal(draft.hipCm, '', 'an unmeasured field must come back blank');
    assert.deepEqual(toMeasurements(draft, 'metric'), stored, 'the round trip changed the numbers');
  });

  test('no previous assessment gives an empty form', () => {
    assert.deepEqual(draftFromMeasurements(null, 'metric'), EMPTY_MEASUREMENTS);
    assert.deepEqual(draftFromMeasurements(undefined, 'metric'), EMPTY_MEASUREMENTS);
    assert.equal(Object.keys(EMPTY_MEASUREMENTS).length, MEASUREMENT_KEYS.length);
  });
});

describe('isMeasured', () => {
  test('men need a waist and a neck', () => {
    assert.equal(isMeasured({ ...EMPTY_MEASUREMENTS, waistCm: '85' }, 'male', 'metric'), false);
    assert.equal(isMeasured({ ...EMPTY_MEASUREMENTS, neckCm: '38' }, 'male', 'metric'), false);
    assert.equal(
      isMeasured({ ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '38' }, 'male', 'metric'),
      true,
    );
  });

  test('women need hips as well, because the formula does', () => {
    const partial = { ...EMPTY_MEASUREMENTS, waistCm: '75', neckCm: '36' };
    assert.equal(isMeasured(partial, 'female', 'metric'), false);
    assert.equal(isMeasured({ ...partial, hipCm: '95' }, 'female', 'metric'), true);
  });

  test('a neck below the adult floor does not count as measured', () => {
    // 20 cm is a child's neck, and the formula is a log ratio of waist to neck
    // — a neck that small does not give a wrong answer, it gives a nonsense one.
    const draft = { ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '20' };
    assert.equal(isMeasured(draft, 'male', 'metric'), false);
    assert.deepEqual(toMeasurements(draft, 'metric'), { waistCm: 85 });
  });

  test('an implausible reading does not count as measured', () => {
    assert.equal(
      isMeasured({ ...EMPTY_MEASUREMENTS, waistCm: '8.5', neckCm: '38' }, 'male', 'metric'),
      false,
    );
  });
});

describe('reading the same form in imperial', () => {
  test('inches become the centimetres the formula needs', () => {
    const draft = { ...EMPTY_MEASUREMENTS, waistCm: '33.5', neckCm: '15' };
    const result = toMeasurements(draft, 'imperial');

    assert.ok(Math.abs((result.waistCm ?? 0) - 85.09) < 1e-9);
    assert.ok(Math.abs((result.neckCm ?? 0) - 38.1) < 1e-9);
  });

  test('the same body passes in either system', () => {
    const metric = { ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '38' };
    const imperial = convertMeasurementsDraft(metric, 'metric', 'imperial');

    assert.equal(isMeasured(metric, 'male', 'metric'), true);
    assert.equal(isMeasured(imperial, 'male', 'imperial'), true);
  });

  test('a reading is judged on the body, not the number typed', () => {
    // 33 is a plausible waist in inches and an impossible one in centimetres.
    assert.deepEqual(toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm: '33' }, 'metric'), {});
    assert.ok(toMeasurements({ ...EMPTY_MEASUREMENTS, waistCm: '33' }, 'imperial').waistCm);
  });

  test('a form filled in inches round-trips through storage', () => {
    const typed = { ...EMPTY_MEASUREMENTS, waistCm: '33.5', neckCm: '15.25' };
    const stored = toMeasurements(typed, 'imperial');
    const reopened = draftFromMeasurements(stored, 'imperial');

    assert.equal(reopened.waistCm, '33.5');
    assert.equal(reopened.neckCm, '15.25');
  });
});

describe('switching units mid-form', () => {
  test('the readings keep meaning the same thing', () => {
    const metric = { ...EMPTY_MEASUREMENTS, waistCm: '85', neckCm: '38' };
    const imperial = convertMeasurementsDraft(metric, 'metric', 'imperial');

    assert.equal(imperial.waistCm, '33.46');
    assert.equal(imperial.neckCm, '14.96');
  });

  test('and survive being switched back', () => {
    const metric = { ...EMPTY_MEASUREMENTS, waistCm: '85.5', neckCm: '38' };
    const there = convertMeasurementsDraft(metric, 'metric', 'imperial');
    const back = convertMeasurementsDraft(there, 'imperial', 'metric');

    assert.equal(back.waistCm, '85.5');
    assert.equal(back.neckCm, '38');
  });

  test('blank fields stay blank rather than becoming zero', () => {
    const converted = convertMeasurementsDraft(EMPTY_MEASUREMENTS, 'metric', 'imperial');
    assert.deepEqual(converted, EMPTY_MEASUREMENTS);
  });

  test('half-typed text is left exactly as typed', () => {
    // Rewriting "8" into "3.15" mid-entry would fight the person typing "85".
    const partial = { ...EMPTY_MEASUREMENTS, waistCm: '.', neckCm: 'abc' };
    const converted = convertMeasurementsDraft(partial, 'metric', 'imperial');
    assert.equal(converted.waistCm, '.');
    assert.equal(converted.neckCm, 'abc');
  });

  test('switching to the same system changes nothing', () => {
    const draft = { ...EMPTY_MEASUREMENTS, waistCm: '85' };
    assert.equal(convertMeasurementsDraft(draft, 'metric', 'metric'), draft);
  });
});

describe('the range a field accepts', () => {
  test('is the stored range, expressed in what the field shows', () => {
    assert.deepEqual(boundsFor('waistCm', 'metric'), { min: 40, max: 200 });

    const imperial = boundsFor('waistCm', 'imperial');
    assert.ok(imperial.min < 16 && imperial.max > 78, 'the inch range is wrong');
  });

  test('never refuses a reading the server would accept', () => {
    for (const key of MEASUREMENT_KEYS) {
      const bounds = boundsFor(key, 'imperial');
      const lowest = { ...EMPTY_MEASUREMENTS, [key]: String(bounds.min) };
      const highest = { ...EMPTY_MEASUREMENTS, [key]: String(bounds.max) };
      // The field's own ends sit outside the stored range, never inside it —
      // clamping to them must never land on a value that is then dropped.
      assert.deepEqual(toMeasurements(lowest, 'imperial'), {}, `${key} min`);
      assert.deepEqual(toMeasurements(highest, 'imperial'), {}, `${key} max`);
    }
  });
});

describe('the neck floor', () => {
  test('accepts the necks adult women actually have', () => {
    // The floor was 35 cm, above the average adult female neck of 30-34 cm.
    // The neck is required to finish the assessment, so that locked a large
    // share of women out of the thing they had just paid for.
    for (const cm of ['28', '30', '32', '34']) {
      assert.equal(
        toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: cm }, 'metric').neckCm,
        Number(cm),
        `${cm} cm should be accepted`,
      );
    }
  });

  test('26 cm is the smallest, and below that is dropped as a mistyped reading', () => {
    assert.equal(toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: '26' }, 'metric').neckCm, 26);
    assert.equal(toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: '25.9' }, 'metric').neckCm, undefined);
    assert.equal(toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: '3' }, 'metric').neckCm, undefined);
  });

  test('the field will not let you type below it either', () => {
    assert.equal(boundsFor('neckCm', 'metric').min, 26);
  });

  test('the same floor applies in inches', () => {
    // 10 in is 25.4 cm, under the floor; 11 in is 27.9 cm, over it. A 12.5 in
    // neck — common for an adult woman — must pass.
    assert.equal(toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: '10' }, 'imperial').neckCm, undefined);
    assert.ok(toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: '11' }, 'imperial').neckCm);
    assert.ok(toMeasurements({ ...EMPTY_MEASUREMENTS, neckCm: '12.5' }, 'imperial').neckCm);
  });
});
