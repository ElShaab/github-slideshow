/**
 * The ranges a measurement is accepted in.
 *
 * These have a twin: `MEASUREMENT_BOUNDS` in the mobile app, which decides what
 * a field will let you type. The two are written out separately and have to
 * agree — a floor raised here but not there is a reading the app accepts and
 * the server silently drops, which reads to the user as a measurement that did
 * not save. This file pins the numbers so the drift is a failing test rather
 * than a support ticket.
 *
 * Needs no database.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { bodyMeasurementsSchema } from '../src/routes/schemas';

/** The same table the mobile app holds, in the same units. */
const EXPECTED: Record<string, { min: number; max: number }> = {
  waistCm: { min: 40, max: 200 },
  neckCm: { min: 35, max: 70 },
  hipCm: { min: 50, max: 200 },
  shoulderCm: { min: 60, max: 200 },
  leftArmCm: { min: 15, max: 70 },
  rightArmCm: { min: 15, max: 70 },
  leftThighCm: { min: 25, max: 110 },
  rightThighCm: { min: 25, max: 110 },
};

const accepts = (field: string, value: number): boolean =>
  bodyMeasurementsSchema.safeParse({ [field]: value }).success;

describe('every measurement is bounded where the app says it is', () => {
  for (const [field, { min, max }] of Object.entries(EXPECTED)) {
    test(`${field} accepts ${min}–${max} and nothing outside it`, () => {
      assert.ok(accepts(field, min), `${field} rejected its own minimum`);
      assert.ok(accepts(field, max), `${field} rejected its own maximum`);
      assert.ok(!accepts(field, min - 0.1), `${field} accepted a value below ${min}`);
      assert.ok(!accepts(field, max + 0.1), `${field} accepted a value above ${max}`);
    });
  }

  test('the app and the server agree on which fields exist', () => {
    const shape = Object.keys(bodyMeasurementsSchema.shape).sort();
    assert.deepEqual(shape, Object.keys(EXPECTED).sort());
  });
});

describe('the neck floor', () => {
  test('a neck below 35 cm is refused', () => {
    // The circumference formula is a log ratio of waist to neck. A neck small
    // enough to be a mistyped reading does not give a slightly wrong body-fat
    // figure — it gives a nonsense one, presented with the same confidence.
    assert.ok(!accepts('neckCm', 20));
    assert.ok(!accepts('neckCm', 34.9));
    assert.ok(accepts('neckCm', 35));
  });

  test('every measurement stays optional, so a blank form is still valid', () => {
    assert.ok(bodyMeasurementsSchema.safeParse({}).success);
  });
});
