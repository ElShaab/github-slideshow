import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { MockBodyAnalysisProvider } from '../src/ai/mockBodyAnalysisProvider';

const provider = new MockBodyAnalysisProvider();

const maleProfile = { age: 30, sex: 'male' as const, heightCm: 180, weightKg: 82 };
const femaleProfile = { age: 30, sex: 'female' as const, heightCm: 165, weightKg: 64 };

function photo(seed: string): Buffer {
  return Buffer.concat([Buffer.from(seed), randomBytes(0)]);
}

test('produces a complete, plausible estimate', async () => {
  const result = await provider.analyze({
    photo: photo('user-one'),
    contentType: 'image/jpeg',
    profile: maleProfile,
  });

  assert.ok(result.bodyFatPercent > 4 && result.bodyFatPercent < 50, 'body fat out of range');
  assert.ok(result.estimatedMuscleMassKg > 20 && result.estimatedMuscleMassKg < maleProfile.weightKg);
  assert.ok(result.waistBodyRatio > 0.3 && result.waistBodyRatio < 0.8);
  assert.ok(result.symmetryPercent >= 60 && result.symmetryPercent <= 100);
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.equal(result.provider, 'mock-v1');
});

test('values are dynamic, not hardcoded', async () => {
  const a = await provider.analyze({ photo: photo('photo-a'), contentType: 'image/jpeg', profile: maleProfile });
  const b = await provider.analyze({ photo: photo('photo-b'), contentType: 'image/jpeg', profile: maleProfile });
  const c = await provider.analyze({
    photo: photo('photo-a'),
    contentType: 'image/jpeg',
    profile: { ...maleProfile, weightKg: 95 },
  });

  assert.notEqual(a.bodyFatPercent, b.bodyFatPercent, 'different photos gave identical results');
  assert.notEqual(a.bodyFatPercent, c.bodyFatPercent, 'a heavier profile gave an identical result');
  assert.ok(c.bodyFatPercent > a.bodyFatPercent, 'more mass at the same height should read higher');
});

test('the same photo and profile always produce the same result', async () => {
  const first = await provider.analyze({ photo: photo('stable'), contentType: 'image/jpeg', profile: maleProfile });
  const second = await provider.analyze({ photo: photo('stable'), contentType: 'image/jpeg', profile: maleProfile });
  assert.deepEqual(first, second);
});

test('sex is reflected in the estimate', async () => {
  const male = await provider.analyze({ photo: photo('same'), contentType: 'image/jpeg', profile: maleProfile });
  const female = await provider.analyze({ photo: photo('same'), contentType: 'image/jpeg', profile: femaleProfile });
  assert.ok(female.bodyFatPercent > male.bodyFatPercent, 'expected a higher female estimate at equal BMI');
});

test('muscle mass never exceeds lean mass', async () => {
  const result = await provider.analyze({ photo: photo('lean'), contentType: 'image/jpeg', profile: maleProfile });
  const leanMass = maleProfile.weightKg * (1 - result.bodyFatPercent / 100);
  assert.ok(result.estimatedMuscleMassKg <= leanMass + 0.01, 'muscle mass exceeded lean mass');
});

test('a follow-up assessment stays anchored to the previous one', async () => {
  const first = await provider.analyze({
    photo: photo('week-1'),
    contentType: 'image/jpeg',
    profile: maleProfile,
  });

  const followUp = (trainingAdherence: number) =>
    provider.analyze({
      photo: photo('week-2'),
      contentType: 'image/jpeg',
      profile: { ...maleProfile, weightKg: 81 },
      previous: {
        bodyFatPercent: first.bodyFatPercent,
        muscleMassKg: first.estimatedMuscleMassKg,
        symmetryPercent: first.symmetryPercent,
        waistBodyRatio: first.waistBodyRatio,
        daysSince: 7,
      },
      trainingAdherence,
    });

  const consistent = await followUp(1);
  const inconsistent = await followUp(0);
  const unanchored = await provider.analyze({
    photo: photo('week-2'),
    contentType: 'image/jpeg',
    profile: { ...maleProfile, weightKg: 81 },
  });

  // A new reading stays close to the previous one rather than jumping around.
  const drift = Math.abs(consistent.bodyFatPercent - first.bodyFatPercent);
  assert.ok(drift < 4, `week-to-week body fat jumped by ${drift.toFixed(1)} points`);
  assert.ok(
    Math.abs(consistent.bodyFatPercent - first.bodyFatPercent) <
      Math.abs(unanchored.bodyFatPercent - first.bodyFatPercent),
    'the follow-up should be pulled toward the previous assessment',
  );

  // Training the user actually did moves the estimate in the right direction.
  assert.ok(
    consistent.bodyFatPercent < inconsistent.bodyFatPercent,
    'consistent training should read leaner than missed training',
  );
  assert.ok(
    consistent.estimatedMuscleMassKg >= first.estimatedMuscleMassKg,
    'consistent training should not lose muscle',
  );
});

test('a poor-quality photo lowers confidence but still analyses', async () => {
  const tiny = await provider.analyze({
    photo: Buffer.alloc(2000, 1),
    contentType: 'image/jpeg',
    profile: maleProfile,
  });
  const large = await provider.analyze({
    photo: Buffer.alloc(700_000, 2),
    contentType: 'image/jpeg',
    profile: maleProfile,
  });

  assert.ok(tiny.bodyFatPercent > 0, 'a small photo must still produce a result');
  assert.ok(tiny.confidence < large.confidence, 'a low-quality photo should score lower confidence');
});

test('hologram geometry describes the current body only', async () => {
  const lean = await provider.analyze({
    photo: photo('athlete'),
    contentType: 'image/jpeg',
    profile: { ...maleProfile, weightKg: 74 },
  });
  const heavier = await provider.analyze({
    photo: photo('athlete'),
    contentType: 'image/jpeg',
    profile: { ...maleProfile, weightKg: 105 },
  });

  assert.equal(lean.hologramData.version, 1);
  assert.equal(lean.hologramData.segments.length, 8);
  assert.equal(lean.hologramData.sex, 'male');

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

test('lower symmetry produces a more visibly imbalanced hologram', async () => {
  const results = await Promise.all(
    ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) =>
      provider.analyze({ photo: photo(seed), contentType: 'image/jpeg', profile: maleProfile }),
    ),
  );

  const sorted = [...results].sort((a, b) => a.symmetryPercent - b.symmetryPercent);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];
  const imbalance = (r: (typeof results)[number]) =>
    Math.max(...r.hologramData.segments.map((s) => Math.abs(s.balance)));

  assert.ok(best.hologramData.symmetryNormalized > worst.hologramData.symmetryNormalized);
  assert.ok(imbalance(worst) >= imbalance(best) * 0.9, 'low symmetry should allow more imbalance');
});
