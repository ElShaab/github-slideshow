import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BodyMeasurements } from '@getfit/shared';
import { MeasurementBodyAnalysisProvider } from '../src/ai/measurementBodyAnalysisProvider';

const provider = new MeasurementBodyAnalysisProvider();

const maleProfile = { age: 30, sex: 'male' as const, heightCm: 180, weightKg: 82 };
const femaleProfile = { age: 30, sex: 'female' as const, heightCm: 165, weightKg: 64 };

/** A lean, plausible set of male tape readings. */
const maleTape: BodyMeasurements = {
  waistCm: 85,
  neckCm: 38,
  shoulderCm: 120,
  leftArmCm: 36,
  rightArmCm: 36,
  leftThighCm: 58,
  rightThighCm: 58,
};

const femaleTape: BodyMeasurements = { waistCm: 75, neckCm: 32, hipCm: 95 };

test('produces a complete, plausible estimate from tape measurements', async () => {
  const result = await provider.analyze({ measurements: maleTape, profile: maleProfile });

  assert.ok(result.bodyFatPercent > 4 && result.bodyFatPercent < 50, 'body fat out of range');
  assert.ok(result.estimatedMuscleMassKg > 20 && result.estimatedMuscleMassKg < maleProfile.weightKg);
  assert.ok(result.waistBodyRatio > 0.3 && result.waistBodyRatio < 0.8);
  assert.equal(result.symmetryPercent, 100, 'evenly measured limbs should read as balanced');
  assert.equal(result.method, 'navy');
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.equal(result.provider, 'measurement-v1');
});

test('matches the published US Navy figure for a known set of measurements', async () => {
  // 180 cm, 85 cm waist, 38 cm neck is a well-documented ~16% reading.
  const result = await provider.analyze({ measurements: maleTape, profile: maleProfile });
  assert.ok(
    Math.abs(result.bodyFatPercent - 16.2) < 0.5,
    `expected ~16.2%, got ${result.bodyFatPercent}%`,
  );

  const female = await provider.analyze({ measurements: femaleTape, profile: femaleProfile });
  assert.ok(
    Math.abs(female.bodyFatPercent - 27.7) < 0.5,
    `expected ~27.7%, got ${female.bodyFatPercent}%`,
  );
});

test('the measurements drive the result, not the profile alone', async () => {
  const lean = await provider.analyze({ measurements: maleTape, profile: maleProfile });
  const wider = await provider.analyze({
    measurements: { ...maleTape, waistCm: 105 },
    profile: maleProfile,
  });

  assert.ok(wider.bodyFatPercent > lean.bodyFatPercent + 8, 'a 20 cm wider waist must read much higher');
  assert.ok(wider.estimatedMuscleMassKg < lean.estimatedMuscleMassKg, 'more fat at equal weight means less muscle');
  assert.ok(wider.waistBodyRatio > lean.waistBodyRatio);
});

test('the same inputs always produce exactly the same result', async () => {
  const first = await provider.analyze({ measurements: maleTape, profile: maleProfile });
  const second = await provider.analyze({ measurements: { ...maleTape }, profile: { ...maleProfile } });
  assert.deepEqual(first, second);
});

test('no photo is required, and a photo changes nothing', async () => {
  const withoutPhoto = await provider.analyze({ measurements: maleTape, profile: maleProfile });
  const withPhoto = await provider.analyze({
    measurements: maleTape,
    profile: maleProfile,
    photo: Buffer.from('a completely different set of bytes'),
    contentType: 'image/jpeg',
  });

  assert.deepEqual(
    withPhoto,
    withoutPhoto,
    'the analysis must not vary with photo bytes — that was the old fabrication',
  );
});

test('falls back to a BMI estimate, and says so, when there is no tape reading', async () => {
  const measured = await provider.analyze({ measurements: maleTape, profile: maleProfile });
  const unmeasured = await provider.analyze({ measurements: {}, profile: maleProfile });

  assert.equal(unmeasured.method, 'bmi');
  assert.ok(unmeasured.bodyFatPercent > 0);
  assert.ok(
    unmeasured.confidence < measured.confidence,
    'an unmeasured estimate must claim less confidence than a measured one',
  );
});

test('a partial tape reading falls back rather than guessing the rest', async () => {
  // The male formula needs waist and neck; the female formula also needs hips.
  const noNeck = await provider.analyze({ measurements: { waistCm: 85 }, profile: maleProfile });
  assert.equal(noNeck.method, 'bmi');

  const noHips = await provider.analyze({
    measurements: { waistCm: 75, neckCm: 32 },
    profile: femaleProfile,
  });
  assert.equal(noHips.method, 'bmi');
});

test('impossible measurements fall back instead of producing nonsense', async () => {
  const neckWiderThanWaist = await provider.analyze({
    measurements: { waistCm: 36, neckCm: 40 },
    profile: maleProfile,
  });

  assert.equal(neckWiderThanWaist.method, 'bmi');
  assert.ok(Number.isFinite(neckWiderThanWaist.bodyFatPercent));
});

test('sex is reflected in the estimate', async () => {
  const male = await provider.analyze({ measurements: {}, profile: maleProfile });
  const female = await provider.analyze({
    measurements: {},
    profile: { ...femaleProfile, heightCm: 180, weightKg: 82 },
  });
  assert.ok(female.bodyFatPercent > male.bodyFatPercent, 'expected a higher female estimate at equal BMI');
});

test('muscle mass never exceeds lean mass', async () => {
  for (const measurements of [maleTape, {}, { ...maleTape, waistCm: 120 }]) {
    const result = await provider.analyze({ measurements, profile: maleProfile });
    const leanMass = maleProfile.weightKg * (1 - result.bodyFatPercent / 100);
    assert.ok(result.estimatedMuscleMassKg <= leanMass + 0.01, 'muscle mass exceeded lean mass');
  }
});

test('symmetry is measured, or null — never invented', async () => {
  const unmeasured = await provider.analyze({
    measurements: { waistCm: 85, neckCm: 38 },
    profile: maleProfile,
  });
  assert.equal(unmeasured.symmetryPercent, null, 'an unmeasured body is not a symmetrical one');

  const even = await provider.analyze({
    measurements: { ...maleTape, leftArmCm: 36, rightArmCm: 36 },
    profile: maleProfile,
  });
  const uneven = await provider.analyze({
    measurements: { ...maleTape, leftArmCm: 34, rightArmCm: 38 },
    profile: maleProfile,
  });

  assert.equal(even.symmetryPercent, 100);
  assert.ok(uneven.symmetryPercent !== null && uneven.symmetryPercent < 90, 'an 11% arm gap should score poorly');
});

test('hologram geometry describes the current body only', async () => {
  const lean = await provider.analyze({ measurements: maleTape, profile: { ...maleProfile, weightKg: 74 } });
  const heavier = await provider.analyze({
    measurements: { ...maleTape, waistCm: 110, shoulderCm: undefined },
    profile: { ...maleProfile, weightKg: 105 },
  });

  assert.equal(lean.hologramData.version, 2);
  assert.equal(lean.hologramData.segments.length, 8);
  assert.equal(lean.hologramData.sex, 'male');

  // The figure is drawn at a 5-point band, and the heavier body draws with a
  // thicker layer and less of its muscle showing through it.
  assert.equal((lean.hologramData.bodyFatBand ?? 0) % 5, 0);
  assert.ok((lean.hologramData.adiposity ?? 1) < (heavier.hologramData.adiposity ?? 0));
  assert.ok((lean.hologramData.definition ?? 0) > (heavier.hologramData.definition ?? 1));

  for (const segment of lean.hologramData.segments) {
    assert.ok(segment.development >= 0 && segment.development <= 1, `${segment.key} out of range`);
    assert.ok(Math.abs(segment.balance) <= 1, `${segment.key} balance out of range`);
  }

  assert.ok(
    lean.hologramData.shoulderToWaist > heavier.hologramData.shoulderToWaist,
    'a leaner estimate should render a stronger taper',
  );
  assert.ok(lean.hologramData.bodyFatNormalized < heavier.hologramData.bodyFatNormalized);

  // No forward-looking fields exist anywhere in the payload.
  const serialised = JSON.stringify(lean.hologramData);
  for (const forbidden of ['future', 'projected', 'goalBody', 'target']) {
    assert.ok(!serialised.includes(forbidden), `hologram data leaked a ${forbidden} field`);
  }
});

test('a measured limb difference is the only thing that tilts the hologram', async () => {
  const even = await provider.analyze({ measurements: maleTape, profile: maleProfile });
  const uneven = await provider.analyze({
    measurements: { ...maleTape, leftArmCm: 34, rightArmCm: 38, leftThighCm: 56, rightThighCm: 60 },
    profile: maleProfile,
  });

  const balanceOf = (r: typeof even, key: string) =>
    r.hologramData.segments.find((s) => s.key === key)?.balance ?? 0;

  for (const segment of even.hologramData.segments) {
    assert.equal(segment.balance, 0, `${segment.key} tilted without a measured difference`);
  }

  assert.ok(balanceOf(uneven, 'arms') > 0.05, 'a larger right arm should tilt the arms');
  assert.ok(balanceOf(uneven, 'quads') > 0.05, 'a larger right thigh should tilt the quads');
  // Segments with no left/right reading stay even rather than borrowing one.
  assert.equal(balanceOf(uneven, 'chest'), 0);
  assert.equal(balanceOf(uneven, 'calves'), 0);

  assert.ok(uneven.hologramData.symmetryNormalized < even.hologramData.symmetryNormalized);
});

test('the shoulder reading is used when given, and estimated when not', async () => {
  const measured = await provider.analyze({
    measurements: { ...maleTape, shoulderCm: 130, waistCm: 80 },
    profile: maleProfile,
  });
  assert.ok(
    Math.abs(measured.hologramData.shoulderToWaist - 130 / 80) < 0.01,
    'a measured shoulder-to-waist should be used verbatim',
  );

  const estimated = await provider.analyze({
    measurements: { waistCm: 80, neckCm: 38 },
    profile: maleProfile,
  });
  assert.ok(estimated.hologramData.shoulderToWaist > 1 && estimated.hologramData.shoulderToWaist < 1.9);
});

test('a measured limb is drawn from its own girth, not a whole-body average', async () => {
  const armsOf = (r: Awaited<ReturnType<typeof provider.analyze>>, key: string) =>
    r.hologramData.segments.find((s) => s.key === key)?.development ?? 0;

  const base = { waistCm: 85, neckCm: 38 };
  const thin = await provider.analyze({
    measurements: { ...base, leftArmCm: 29, rightArmCm: 29, leftThighCm: 50, rightThighCm: 50 },
    profile: maleProfile,
  });
  const large = await provider.analyze({
    measurements: { ...base, leftArmCm: 43, rightArmCm: 43, leftThighCm: 68, rightThighCm: 68 },
    profile: maleProfile,
  });

  // Same height, same weight, same body fat — only the tape differs, and the
  // figure has to show it.
  assert.equal(thin.bodyFatPercent, large.bodyFatPercent);
  assert.ok(armsOf(large, 'arms') - armsOf(thin, 'arms') > 0.5, 'a 14 cm arm difference barely moved');
  assert.ok(armsOf(large, 'quads') - armsOf(thin, 'quads') > 0.4, 'an 18 cm thigh difference barely moved');
  // Calves follow the legs, the closest measured signal there is.
  assert.ok(armsOf(large, 'calves') > armsOf(thin, 'calves'));

  // An unmeasured limb falls back to the whole-body index and lands between.
  const unmeasured = await provider.analyze({ measurements: base, profile: maleProfile });
  assert.ok(armsOf(unmeasured, 'arms') > armsOf(thin, 'arms'));
  assert.ok(armsOf(unmeasured, 'arms') < armsOf(large, 'arms'));
});
