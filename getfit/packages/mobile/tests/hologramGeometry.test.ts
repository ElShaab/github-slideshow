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
    ...geometry.contours.map((c) => c.d),
    ...geometry.seams,
    ...geometry.plates.map((p) => p.d),
    ...geometry.softBands.map((b) => b.d),
    ...geometry.striations.map((s) => s.d),
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
        geometry.fatLayer.opacity,
        ...geometry.contours.map((c) => c.opacity),
        ...geometry.softBands.map((b) => b.opacity),
        ...geometry.striations.map((s) => s.opacity),
        ...geometry.plates.map((p) => p.intensity),
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

  test('limbs thicken too, so a heavy figure is not a thin one with a belly', () => {
    assert.ok(armSpan(buildGeometry(dataAt(40))) > armSpan(buildGeometry(dataAt(12))));
  });
});

describe('detail appears and disappears with the layer over it', () => {
  test('a defined figure is striated and a covered one is bare', () => {
    assert.ok(buildGeometry(dataAt(12)).striations.length > 8, 'a lean figure should show fibre');
    assert.equal(buildGeometry(dataAt(40)).striations.length, 0, '40% should show none');
    assert.equal(buildGeometry(dataAt(50)).striations.length, 0);
  });

  test('striations thin out group by group rather than vanishing at once', () => {
    // Fading every group together puts a cliff between two neighbouring bands,
    // where a figure that was fully striated at 35% is bare at 40%. They should
    // go out one at a time, so each 5-point step has something to show.
    const counts: number[] = [];
    for (let band = 5; band <= 60; band += 5) {
      counts.push(buildGeometry(dataAt(band)).striations.length);
    }

    for (let index = 1; index < counts.length; index += 1) {
      assert.ok(
        counts[index] <= counts[index - 1],
        `striations went up: ${counts.join(', ')}`,
      );
    }

    const distinct = new Set(counts.filter((count) => count > 0));
    assert.ok(
      distinct.size >= 3,
      `fibre should thin through at least three stages, saw ${counts.join(', ')}`,
    );

    const biggestDrop = Math.max(
      ...counts.slice(1).map((count, index) => counts[index] - count),
    );
    const mostFibre = Math.max(...counts);
    assert.ok(
      biggestDrop < mostFibre * 0.6,
      `one band dropped ${biggestDrop} of ${mostFibre} fibres at once: ${counts.join(', ')}`,
    );
  });

  test('soft folds are the mirror image: none when lean, more as fat rises', () => {
    assert.equal(buildGeometry(dataAt(12)).softBands.length, 0, 'nothing to fold on a lean figure');
    assert.ok(buildGeometry(dataAt(30)).softBands.length > 0);
    assert.ok(
      buildGeometry(dataAt(45)).softBands.length >= buildGeometry(dataAt(30)).softBands.length,
    );
  });

  test('abs fade out rather than shrinking', () => {
    // The muscle is still there under the fat; you just cannot see its shape.
    const absAt = (percent: number): number => {
      const plates = buildGeometry(dataAt(percent)).plates.filter((p) => p.key === 'waist');
      return Math.max(...plates.map((p) => p.intensity));
    };
    assert.ok(absAt(12) > absAt(25));
    assert.ok(absAt(25) > absAt(35));
    assert.equal(absAt(45), 0);
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

/** The widest point across the shoulders, read back out of the torso path. */
function shoulderWidth(geometry: ReturnType<typeof buildGeometry>): number {
  return spanAt(geometry.torsoPath, 96, 112);
}

/** The widest point across the abdomen. */
function bellyWidth(geometry: ReturnType<typeof buildGeometry>): number {
  return spanAt(geometry.torsoPath, 180, 216);
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
