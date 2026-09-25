/**
 * The hologram's body-fat banding.
 *
 * The figure is drawn at a 5-point band rather than at the raw reading. That
 * matters more than it sounds: a tape measure moves a point or two between
 * weeks for reasons that have nothing to do with the body, and a figure that
 * redraws itself on that noise invites someone to read a change into it. These
 * tests hold the band boundaries, and hold the rule that everything the figure
 * is built from comes from the band and not the reading.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BODY_FAT_BAND_MAX,
  BODY_FAT_BAND_MIN,
  BODY_FAT_BAND_STEP,
  bodyFatBand,
  buildHologramData,
  type HologramInput,
} from '../src/hologram';
import type { Sex } from '../src/types';

function input(overrides: Partial<HologramInput> = {}): HologramInput {
  return {
    bodyFatPercent: 20,
    muscleMassKg: 32,
    waistBodyRatio: 0.46,
    heightCm: 178,
    sex: 'male',
    measurements: { waistCm: 82, neckCm: 38 },
    ...overrides,
  };
}

describe('bodyFatBand', () => {
  test('rounds to the nearest 5 points', () => {
    assert.equal(bodyFatBand(20), 20);
    assert.equal(bodyFatBand(21.2), 20);
    assert.equal(bodyFatBand(22.4), 20);
    assert.equal(bodyFatBand(22.5), 25);
    assert.equal(bodyFatBand(27.49), 25);
    assert.equal(bodyFatBand(38.9), 40);
  });

  test('every band is a multiple of the step', () => {
    for (let percent = 0; percent <= 70; percent += 0.1) {
      const band = bodyFatBand(percent);
      assert.equal(band % BODY_FAT_BAND_STEP, 0, `${percent} banded to ${band}`);
    }
  });

  test('never leaves the drawable range', () => {
    assert.equal(bodyFatBand(0), BODY_FAT_BAND_MIN);
    assert.equal(bodyFatBand(-12), BODY_FAT_BAND_MIN);
    assert.equal(bodyFatBand(95), BODY_FAT_BAND_MAX);
    assert.equal(bodyFatBand(Number.NaN), BODY_FAT_BAND_MIN);
  });

  test('never moves backwards as body fat rises', () => {
    let previous = 0;
    for (let percent = 0; percent <= 70; percent += 0.25) {
      const band = bodyFatBand(percent);
      assert.ok(band >= previous, `${percent}% banded to ${band}, below the previous ${previous}`);
      previous = band;
    }
  });
});

describe('the figure follows the band, not the reading', () => {
  test('two readings inside one band draw exactly the same figure', () => {
    // 21.2% and 22.4% are a real difference on paper and no difference at all
    // to a tape measure. The user still reads their own number.
    const a = buildHologramData(input({ bodyFatPercent: 21.2 }));
    const b = buildHologramData(input({ bodyFatPercent: 22.4 }));

    assert.equal(a.bodyFatBand, 20);
    assert.equal(b.bodyFatBand, 20);
    assert.deepEqual(a.segments, b.segments);
    assert.equal(a.adiposity, b.adiposity);
    assert.equal(a.definition, b.definition);
    assert.equal(a.bodyFatNormalized, b.bodyFatNormalized);
  });

  test('crossing a band boundary does change the figure', () => {
    const lean = buildHologramData(input({ bodyFatPercent: 22.4 }));
    const less = buildHologramData(input({ bodyFatPercent: 22.5 }));

    assert.equal(lean.bodyFatBand, 20);
    assert.equal(less.bodyFatBand, 25);
    assert.notEqual(lean.adiposity, less.adiposity);
    assert.notEqual(lean.definition, less.definition);
  });

  test('each 5-point step is visible, across the whole range', () => {
    // A band that draws the same as its neighbour is a band that does nothing.
    let previous: { adiposity: number; definition: number } | null = null;
    for (let band = BODY_FAT_BAND_MIN; band <= BODY_FAT_BAND_MAX; band += BODY_FAT_BAND_STEP) {
      const data = buildHologramData(input({ bodyFatPercent: band }));
      if (previous) {
        const moved =
          data.adiposity !== previous.adiposity || data.definition !== previous.definition;
        assert.ok(moved, `band ${band} draws identically to band ${band - BODY_FAT_BAND_STEP}`);
      }
      previous = { adiposity: data.adiposity ?? 0, definition: data.definition ?? 0 };
    }
  });
});

describe('the layer and what shows through it', () => {
  test('the layer thickens as body fat rises, and detail disappears', () => {
    const lean = buildHologramData(input({ bodyFatPercent: 12 }));
    const mid = buildHologramData(input({ bodyFatPercent: 25 }));
    const heavy = buildHologramData(input({ bodyFatPercent: 40 }));

    assert.ok((lean.adiposity ?? 0) < (mid.adiposity ?? 0));
    assert.ok((mid.adiposity ?? 0) < (heavy.adiposity ?? 0));

    assert.ok((lean.definition ?? 0) > (mid.definition ?? 0));
    assert.ok((mid.definition ?? 0) > (heavy.definition ?? 0));
  });

  test('matches the two references it was drawn from', () => {
    // The 20% render is fully striated; by 40% the fibre is soft. Both are the
    // same body seen through a different amount of fat, so neither is bare —
    // these are the anchors the whole ramp is fitted to.
    const twenty = buildHologramData(input({ bodyFatPercent: 20 }));
    const forty = buildHologramData(input({ bodyFatPercent: 40 }));

    assert.ok((twenty.definition ?? 0) > 0.6, `20% should read as defined, got ${twenty.definition}`);
    assert.ok(
      (forty.definition ?? 0) < (twenty.definition ?? 0) * 0.45,
      `40% should read much softer than 20%, got ${forty.definition}`,
    );
    // The layer at 40% is roughly twice the one at 20%, which is about the
    // ratio between the fringes in the two renders.
    const ratio = (forty.adiposity ?? 0) / (twenty.adiposity ?? 1);
    assert.ok(ratio > 1.8 && ratio < 2.6, `40% should be about twice as covered as 20%, got ${ratio}`);
  });

  test('women carry the same figure about 8 points higher', () => {
    // Essential fat, not a difference in condition: a woman at 28% and a man at
    // 20% should draw with a comparable amount of detail showing.
    const man = buildHologramData(input({ bodyFatPercent: 20, sex: 'male' }));
    const woman = buildHologramData(
      input({ bodyFatPercent: 28, sex: 'female', measurements: { waistCm: 74, neckCm: 32, hipCm: 96 } }),
    );
    assert.ok(Math.abs((man.definition ?? 0) - (woman.definition ?? 0)) < 0.2);
  });

  test('muscle never disappears, however much fat is over it', () => {
    // Fat is translucent in both references, and muscle someone has built does
    // not stop existing at 40% body fat. A figure that erased it would be
    // telling them it had.
    for (const sex of ['male', 'female'] as Sex[]) {
      for (let percent = 0; percent <= 70; percent += 1) {
        const data = buildHologramData(input({ bodyFatPercent: percent, sex }));
        assert.ok(
          (data.definition ?? 0) > 0,
          `${sex} at ${percent}% lost its muscle definition entirely`,
        );
      }
    }
  });

  test('there is less muscle detail to show on someone who has not trained', () => {
    const lean = buildHologramData(input({ bodyFatPercent: 12, muscleMassKg: 32 }));
    const leanAndUntrained = buildHologramData(input({ bodyFatPercent: 12, muscleMassKg: 21 }));
    assert.ok((leanAndUntrained.definition ?? 0) < (lean.definition ?? 0));
  });

  test('both stay inside 0..1 at every band and either sex', () => {
    for (const sex of ['male', 'female'] as Sex[]) {
      for (let percent = 0; percent <= 70; percent += 1) {
        const data = buildHologramData(input({ bodyFatPercent: percent, sex }));
        for (const [name, value] of [
          ['adiposity', data.adiposity ?? 0],
          ['definition', data.definition ?? 0],
        ] as const) {
          assert.ok(
            value >= 0 && value <= 1,
            `${sex} at ${percent}% produced ${name} of ${value}`,
          );
        }
      }
    }
  });
});

describe('the payload', () => {
  test('carries the fat layer colour the renderer needs', () => {
    const data = buildHologramData(input());
    assert.equal(data.version, 2);
    assert.equal(data.accentPalette.length, 4, 'body, deep, bright, fat layer');
    for (const colour of data.accentPalette) {
      assert.match(colour, /^#[0-9A-F]{6}$/i, `${colour} is not a hex colour`);
    }
  });

  test('is deterministic — the same assessment always draws the same figure', () => {
    assert.deepEqual(buildHologramData(input()), buildHologramData(input()));
  });

  test('the seed still separates two assessments inside one band', () => {
    // The figure is the same, but the assessments are not the same assessment.
    const a = buildHologramData(input({ bodyFatPercent: 21.2 }));
    const b = buildHologramData(input({ bodyFatPercent: 22.4 }));
    assert.notEqual(a.seed, b.seed);
  });
});
