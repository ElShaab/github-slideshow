/**
 * The text layer between a form field and stored metric numbers.
 *
 * Fields hold raw text so a half-typed number is never clamped mid-entry, which
 * means every conversion here runs against strings people are still editing. Get
 * it wrong and the failure is not a crash — it is a field that eats the decimal
 * point, or a weight that shifts a little every time the screen is reopened.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cmToHeightText,
  cmToLengthText,
  convertHeightText,
  convertMassText,
  heightToCm,
  joinInches,
  kgToMassText,
  lengthToCm,
  massToKg,
  parseField,
  splitInches,
} from '../src/utils/units';

describe('parsing a field', () => {
  test('a number is a number', () => {
    assert.equal(parseField('85'), 85);
    assert.equal(parseField('85.5'), 85.5);
  });

  test('anything half-typed is nothing yet', () => {
    for (const text of ['', '.', '-', 'abc', ' ']) {
      assert.equal(parseField(text), null, `"${text}"`);
    }
  });
});

describe('lengths', () => {
  test('metric passes through untouched', () => {
    assert.equal(lengthToCm('85.5', 'metric'), 85.5);
    assert.equal(cmToLengthText(85.5, 'metric'), '85.5');
  });

  test('inches convert both ways', () => {
    assert.equal(lengthToCm('33.5', 'imperial'), 85.09);
    assert.equal(cmToLengthText(85.09, 'imperial'), '33.5');
  });

  test('nothing measured is blank, not zero', () => {
    assert.equal(cmToLengthText(null, 'metric'), '');
    assert.equal(cmToLengthText(undefined, 'imperial'), '');
    assert.equal(cmToLengthText(Number.NaN, 'metric'), '');
  });
});

describe('masses', () => {
  test('pounds convert both ways', () => {
    assert.ok(Math.abs((massToKg('190', 'imperial') ?? 0) - 86.18) < 0.01);
    assert.equal(kgToMassText(86, 'imperial'), '189.6');
  });

  test('a weight survives being reopened', () => {
    // Typed, stored, read back: the number on screen must not have moved.
    for (const typed of ['190', '185.5', '210']) {
      const kg = massToKg(typed, 'imperial');
      assert.ok(kg !== null);
      assert.equal(kgToMassText(kg, 'imperial'), typed.replace(/\.0$/, ''));
    }
  });
});

describe('height', () => {
  test('imperial height is held as whole inches', () => {
    assert.equal(cmToHeightText(182.88, 'imperial'), '72');
    assert.equal(cmToHeightText(183, 'metric'), '183');
  });

  test('inches split into the feet and inches people say', () => {
    assert.deepEqual(splitInches(72), { feet: 6, inches: 0 });
    assert.deepEqual(splitInches(71), { feet: 5, inches: 11 });
    assert.equal(joinInches(5, 11), 71);
  });

  test('a negative or nonsense total does not produce negative feet', () => {
    assert.deepEqual(splitInches(-5), { feet: 0, inches: 0 });
  });

  test('switching units keeps whole units on both sides', () => {
    assert.equal(convertHeightText('183', 'metric', 'imperial'), '72');
    assert.equal(convertHeightText('72', 'imperial', 'metric'), '183');
  });

  test('a height stays within an inch of itself across a switch', () => {
    for (let cm = 150; cm <= 210; cm += 1) {
      const inches = convertHeightText(String(cm), 'metric', 'imperial');
      const back = Number(convertHeightText(inches, 'imperial', 'metric'));
      assert.ok(Math.abs(back - cm) <= 2, `${cm} cm came back as ${back}`);
    }
  });

  test('typed height converts to the centimetres stored', () => {
    assert.equal(heightToCm('183', 'metric'), 183);
    assert.equal(heightToCm('72', 'imperial'), 182.88);
  });
});

describe('switching with a field mid-edit', () => {
  test('blank stays blank', () => {
    assert.equal(convertMassText('', 'metric', 'imperial'), '');
    assert.equal(convertHeightText('', 'metric', 'imperial'), '');
  });

  test('unparseable text is handed back untouched', () => {
    assert.equal(convertMassText('.', 'metric', 'imperial'), '.');
    assert.equal(convertHeightText('abc', 'imperial', 'metric'), 'abc');
  });

  test('no conversion happens when the system has not changed', () => {
    assert.equal(convertMassText('86', 'metric', 'metric'), '86');
  });
});
