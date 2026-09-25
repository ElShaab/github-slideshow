/**
 * The hologram's silhouette.
 *
 * Every path here is a string assembled from arithmetic, which fails in a
 * uniquely quiet way: one NaN anywhere in a `d` attribute and SVG discards the
 * whole path, so the figure loses an arm and nothing anywhere reports an error.
 * These tests read the geometry the way the renderer does and check both that
 * it is drawable and that it actually says what the body composition says.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildHologramData, type HologramData } from '@getfit/shared';
import { buildGeometry } from '../src/components/hologram/geometry';
import { Y } from '../src/components/hologram/figure';

function dataAt(bodyFatPercent: number, overrides: Partial<Parameters<typeof buildHologramData>[0]> = {}): HologramData {
  return buildHologramData({
    bodyFatPercent,
    muscleMassKg: 32,
    waistBodyRatio: 0.46,
    heightCm: 178,
    sex: 'male',
    measurements: { waistCm: 82, neckCm: 38 },
    ...overrides,
  });
}

/** Every number that appears in a path, so they can be checked for sanity. */
function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}

function allPaths(geometry: ReturnType<typeof buildGeometry>): string[] {
  return [
    geometry.torsoPath,
    geometry.leftLegPath,
    geometry.rightLegPath,
    geometry.leftArmPath,
    geometry.rightArmPath,
    geometry.muscle.torsoPath,
    geometry.muscle.leftLegPath,
    geometry.muscle.rightLegPath,
    geometry.muscle.leftArmPath,
    geometry.muscle.rightArmPath,
    geometry.muscle.neckPath,
    ...geometry.fatRingPaths,
    ...geometry.contours.map((c) => c.d),
    geometry.headPath,
    ...geometry.facePaths,
    ...geometry.bellies.map((b) => b.d),
    ...geometry.softBands.map((b) => b.d),
    ...geometry.fibres.map((f) => f.d),
  ];
}

describe('every figure is drawable', () => {
  test('no path contains NaN, Infinity or a missing number, at any band', () => {
    for (const sex of ['male', 'female'] as const) {
      for (let percent = 3; percent <= 65; percent += 1) {
        const geometry = buildGeometry(
          dataAt(percent, {
            sex,
            measurements:
              sex === 'female'
                ? { waistCm: 74, neckCm: 32, hipCm: 96 }
                : { waistCm: 82, neckCm: 38 },
          }),
        );

        for (const path of allPaths(geometry)) {
          assert.doesNotMatch(
            path,
            /NaN|Infinity|undefined|null/,
            `${sex} at ${percent}% produced ${path.slice(0, 80)}`,
          );
          for (const value of numbersIn(path)) {
            assert.ok(
              Number.isFinite(value) && Math.abs(value) < 5000,
              `${sex} at ${percent}% produced the coordinate ${value}`,
            );
          }
        }
      }
    }
  });

  test('opacities stay inside 0..1', () => {
    for (let percent = 3; percent <= 65; percent += 1) {
      const geometry = buildGeometry(dataAt(percent));
      const opacities = [
        geometry.fatLayer.ring,
        geometry.fatLayer.wash,
        geometry.fatLayer.rim,
        ...geometry.contours.map((c) => c.opacity),
        ...geometry.softBands.map((b) => b.opacity),
        ...geometry.fibres.map((f) => f.opacity),
        ...geometry.bellies.map((b) => b.intensity),
        geometry.stipple.opacity,
      ];
      for (const opacity of opacities) {
        assert.ok(opacity >= 0 && opacity <= 1, `${percent}% produced an opacity of ${opacity}`);
      }
    }
  });
});

describe('the silhouette says what the composition says', () => {
  test('a lean figure tapers from the shoulders; a heavy one from the belly', () => {
    // This is the single thing that makes a figure read as heavy rather than
    // as a large athlete, so it is worth stating as a rule rather than trusting
    // to the curve constants.
    const lean = buildGeometry(dataAt(12));
    const heavy = buildGeometry(dataAt(40));

    const widest = (g: ReturnType<typeof buildGeometry>): 'shoulders' | 'belly' => {
      const shoulders = shoulderWidth(g);
      const belly = bellyWidth(g);
      return belly > shoulders ? 'belly' : 'shoulders';
    };

    assert.equal(widest(lean), 'shoulders');
    assert.equal(widest(heavy), 'belly');
  });

  test('the belly grows with every band, the figure never shrinks into one', () => {
    let previous = 0;
    for (let band = 10; band <= 55; band += 5) {
      const width = bellyWidth(buildGeometry(dataAt(band)));
      assert.ok(width > previous, `band ${band} has a belly of ${width}, not wider than ${previous}`);
      previous = width;
    }
  });

  test('the fat layer thickens with body fat, and is never zero', () => {
    let previous = 0;
    for (let band = 5; band <= 60; band += 5) {
      const { thickness } = buildGeometry(dataAt(band)).fatLayer;
      assert.ok(thickness > 0, `band ${band} drew no layer at all`);
      assert.ok(thickness > previous, `band ${band} is ${thickness}, no thicker than ${previous}`);
      previous = thickness;
    }
  });

  test('the layer stays translucent at every band', () => {
    // The whole arrangement — muscle body underneath, fat over it — only
    // works while the fat lets the muscle through. An opaque wash is a blank
    // shell with extra steps, and a wash strong enough to be obvious turns a
    // lean figure green, which is neither reference.
    for (let band = 5; band <= 60; band += 5) {
      const { wash, ring } = buildGeometry(dataAt(band)).fatLayer;
      assert.ok(wash > 0, `band ${band} drew no layer over the muscle`);
      assert.ok(wash <= 0.25, `band ${band} washed out the muscle at ${wash}`);
      assert.ok(ring > wash, `band ${band}: the ring should read stronger than the wash`);
    }
  });

  test('the ring is a gap between two outlines, not a solid shape', () => {
    // Filled with the even-odd rule, a ring path needs exactly two subpaths:
    // the outer body and the muscle body inside it. One subpath fills solid
    // and paints over the whole figure.
    const geometry = buildGeometry(dataAt(35));
    assert.equal(geometry.fatRingPaths.length, 5, 'torso, two arms, two legs');
    for (const path of geometry.fatRingPaths) {
      assert.equal(
        (path.match(/Z/g) ?? []).length,
        2,
        `a ring path should close twice: ${path.slice(0, 60)}`,
      );
    }
  });

  test('the muscle body is inside the outer body, and the gap is the layer', () => {
    for (const band of [10, 20, 30, 40, 50]) {
      const geometry = buildGeometry(dataAt(band));
      const outer = bellyWidth(geometry);
      const inner = spanAt(geometry.muscle.torsoPath, Y.belly - 14, Y.waist + 4);
      assert.ok(
        inner <= outer,
        `band ${band}: the muscle body (${inner}) is wider than the body over it (${outer})`,
      );
    }

    const gapAt = (band: number): number => {
      const geometry = buildGeometry(dataAt(band));
      return bellyWidth(geometry) - spanAt(geometry.muscle.torsoPath, Y.belly - 14, Y.waist + 4);
    };
    assert.ok(gapAt(40) > gapAt(20), 'the layer should be thicker at 40% than at 20%');
    assert.ok(gapAt(20) > gapAt(10), 'and thicker at 20% than at 10%');
  });

  test('limbs thicken too, so a heavy figure is not a thin one with a belly', () => {
    assert.ok(armSpan(buildGeometry(dataAt(40))) > armSpan(buildGeometry(dataAt(12))));
  });
});

describe('detail appears and disappears with the layer over it', () => {
  test('muscle is drawn at every band, however much fat is over it', () => {
    // This is the rule the whole layering exists to serve. Muscle someone has
    // built does not stop existing at 40% body fat, and a figure that erased
    // it would be telling them it had.
    for (const sex of ['male', 'female'] as const) {
      for (let band = 5; band <= 60; band += 5) {
        const geometry = buildGeometry(
          dataAt(band, {
            sex,
            measurements:
              sex === 'female'
                ? { waistCm: 74, neckCm: 32, hipCm: 96 }
                : { waistCm: 82, neckCm: 38 },
          }),
        );
        assert.ok(
          geometry.fibres.length > 0,
          `${sex} at ${band}% lost its muscle fibre entirely`,
        );
        assert.ok(
          Math.max(...geometry.bellies.map((p) => p.intensity)) > 0,
          `${sex} at ${band}% lost its muscle bellies entirely`,
        );
      }
    }
  });

  test('fibre softens as the layer thickens, rather than vanishing', () => {
    const brightest = (band: number): number =>
      Math.max(...buildGeometry(dataAt(band)).fibres.map((s) => s.opacity));

    assert.ok(brightest(12) > brightest(25));
    assert.ok(brightest(25) > brightest(40));
    assert.ok(brightest(40) > 0, '40% should still show fibre, only softer');
  });

  test('soft folds are the mirror image: none when lean, more as fat rises', () => {
    assert.equal(buildGeometry(dataAt(12)).softBands.length, 0, 'nothing to fold on a lean figure');
    assert.ok(buildGeometry(dataAt(30)).softBands.length > 0);
    assert.ok(
      buildGeometry(dataAt(45)).softBands.length >= buildGeometry(dataAt(30)).softBands.length,
    );
  });

  test('abs fade out rather than shrinking, and never to nothing', () => {
    // The muscle is still there under the fat; you just cannot see its shape.
    const absAt = (percent: number): number => {
      const bellies = buildGeometry(dataAt(percent)).bellies.filter((p) => p.key === 'waist');
      return Math.max(...bellies.map((p) => p.intensity));
    };
    assert.ok(absAt(12) > absAt(25));
    assert.ok(absAt(25) > absAt(35));
    assert.ok(absAt(45) > 0, 'even at 45% the abs are under there somewhere');
  });
});

describe('older stored assessments still draw', () => {
  test('a version 1 payload, which predates the layer, renders without it', () => {
    const current = dataAt(30);
    const legacy: HologramData = {
      ...current,
      version: 1,
      accentPalette: ['#22E3F2', '#0FB9D6', '#7CF6FF'],
    };
    delete legacy.bodyFatBand;
    delete legacy.adiposity;
    delete legacy.definition;

    const geometry = buildGeometry(legacy);
    assert.ok(geometry.fatLayer.thickness > 0);
    assert.ok(geometry.adiposity >= 0 && geometry.adiposity <= 1);
    for (const path of allPaths(geometry)) {
      assert.doesNotMatch(path, /NaN|undefined/);
    }
  });
});

/**
 * The widest point across the shoulders, read back out of the torso path.
 *
 * Both of these read the landmark heights by name rather than by number. An
 * earlier version hardcoded them, and when the figure was redrawn at new
 * proportions the tests went on passing while measuring the wrong parts of the
 * body — the shoulder check was reading the neck.
 */
function shoulderWidth(geometry: ReturnType<typeof buildGeometry>): number {
  return spanAt(geometry.torsoPath, Y.shoulder - 10, Y.shoulder + 10);
}

/** The widest point across the abdomen. */
function bellyWidth(geometry: ReturnType<typeof buildGeometry>): number {
  return spanAt(geometry.torsoPath, Y.belly - 14, Y.waist + 4);
}

function armSpan(geometry: ReturnType<typeof buildGeometry>): number {
  const xs = coordinates(geometry.rightArmPath).map(([x]) => x);
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * The horizontal span of a path between two heights.
 *
 * Only the curve endpoints and control points are available without evaluating
 * the béziers, which is close enough: the figure's extremes all sit on named
 * landmarks rather than halfway along a curve.
 */
function spanAt(path: string, fromY: number, toY: number): number {
  const xs = coordinates(path)
    .filter(([, y]) => y >= fromY && y <= toY)
    .map(([x]) => x);
  assert.ok(xs.length > 0, `no points between y=${fromY} and y=${toY}`);
  return Math.max(...xs) - Math.min(...xs);
}

function coordinates(path: string): Array<[number, number]> {
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const points: Array<[number, number]> = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    points.push([numbers[index], numbers[index + 1]]);
  }
  return points;
}
