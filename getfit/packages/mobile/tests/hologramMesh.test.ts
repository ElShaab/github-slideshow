/**
 * The hologram's geometry, as a mesh.
 *
 * A broken mesh fails quietly and expensively: a wrong index draws nothing, an
 * unnormalised normal kills the rim glow that makes the whole thing read as a
 * hologram, and a shell that does not contain the body puts fat inside the
 * muscle. None of that throws — it just looks wrong on a device I cannot see.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildHologramData, type HologramData } from '@getfit/shared';
import { buildBody3D } from '../src/components/hologram/mesh3dBody';
import { loft, type MeshData } from '../src/components/hologram/mesh';

function dataAt(bodyFatPercent: number, sex: 'male' | 'female' = 'male'): HologramData {
  return buildHologramData({
    bodyFatPercent,
    muscleMassKg: 34,
    waistBodyRatio: 0.46,
    heightCm: 178,
    sex,
    measurements:
      sex === 'female'
        ? { waistCm: 74, neckCm: 32, hipCm: 96 }
        : { waistCm: 82, neckCm: 38, leftArmCm: 36, rightArmCm: 36 },
  });
}

function checkMesh(mesh: MeshData, what: string): void {
  assert.ok(mesh.positions.length > 0, `${what} has no vertices`);
  assert.equal(mesh.positions.length % 3, 0, `${what} has a partial vertex`);
  assert.equal(
    mesh.normals.length,
    mesh.positions.length,
    `${what} has a normal per vertex mismatch`,
  );
  assert.equal(mesh.indices.length % 3, 0, `${what} has a partial triangle`);

  for (const value of mesh.positions) {
    assert.ok(Number.isFinite(value), `${what} has a non-finite position`);
  }

  const vertexCount = mesh.positions.length / 3;
  for (const index of mesh.indices) {
    assert.ok(
      index >= 0 && index < vertexCount,
      `${what} indexes vertex ${index} of ${vertexCount}`,
    );
  }

  // Every normal must be unit length, or the fresnel rim is wrong wherever it
  // is not — and the rim is the entire hologram effect.
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert.ok(
      Math.abs(length - 1) < 1e-3,
      `${what} has a normal of length ${length.toFixed(4)}`,
    );
  }
}

describe('the mesh is drawable', () => {
  test('both bodies are sound, at every band and either sex', () => {
    for (const sex of ['male', 'female'] as const) {
      for (let band = 5; band <= 60; band += 5) {
        const body = buildBody3D(dataAt(band, sex));
        checkMesh(body.muscle, `${sex} muscle at ${band}%`);
        checkMesh(body.fat, `${sex} fat at ${band}%`);
        assert.ok(body.height > 0);
      }
    }
  });

  test('a loft closes at both ends', () => {
    // An open tube shows its own inside when it turns, which on a translucent
    // additive material reads as a hole in the limb.
    const rings = [
      { y: 0, halfWidth: 4, halfDepth: 4, offsetX: 0, offsetZ: 0 },
      { y: 10, halfWidth: 6, halfDepth: 5, offsetX: 0, offsetZ: 0 },
    ];
    const mesh = loft(rings);
    checkMesh(mesh, 'a two-ring loft');

    // Each edge of a closed surface is shared by exactly two triangles.
    const edges = new Map<string, number>();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const tri = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
      for (let e = 0; e < 3; e += 1) {
        const [a, b] = [tri[e], tri[(e + 1) % 3]];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [edge, count] of edges) {
      assert.equal(count, 2, `edge ${edge} borders ${count} triangles, so the surface is open`);
    }
  });

  test('a loft needs more than one ring', () => {
    assert.throws(() => loft([{ y: 0, halfWidth: 4, halfDepth: 4, offsetX: 0, offsetZ: 0 }]));
  });
});

describe('the mesh says what the composition says', () => {
  test('the fat shell contains the muscle body', () => {
    // Fat inside muscle is not a rendering artefact anyone would spot as a
    // bug: it just looks like a slightly odd figure. So it is asserted.
    for (const band of [10, 20, 30, 40, 50]) {
      const body = buildBody3D(dataAt(band));
      const muscle = extent(body.muscle);
      const fat = extent(body.fat);
      assert.ok(
        fat.maxX >= muscle.maxX - 0.01 && fat.minX <= muscle.minX + 0.01,
        `band ${band}: the shell is narrower than the body inside it`,
      );
    }
  });

  test('the layer over the trunk thickens with every band', () => {
    // Measured across the trunk specifically. A whole-body extent is dominated
    // by the feet and the fingertips, which barely move — an earlier version of
    // this test passed for that reason rather than because the layer worked.
    let previous = -1;
    for (let band = 10; band <= 50; band += 10) {
      const body = buildBody3D(dataAt(band));
      const gap = trunkDepth(body.fat) - trunkDepth(body.muscle);
      assert.ok(gap > previous, `band ${band} has a layer of ${gap.toFixed(2)}, no deeper than ${previous.toFixed(2)}`);
      previous = gap;
    }
  });

  test('the trunk underneath moves far less than the layer over it', () => {
    // Muscle segments do shift a little with body fat, because a girth reading
    // is partly fat — but the layer is what carries the change, by an order of
    // magnitude. If the two ever moved together, the shell would be decoration.
    const lean = buildBody3D(dataAt(12));
    const heavy = buildBody3D(dataAt(45));

    const muscleShift = Math.abs(trunkDepth(heavy.muscle) - trunkDepth(lean.muscle));
    const layerShift = Math.abs(
      trunkDepth(heavy.fat) - trunkDepth(heavy.muscle) - (trunkDepth(lean.fat) - trunkDepth(lean.muscle)),
    );

    assert.ok(
      layerShift > muscleShift * 4,
      `the layer moved ${layerShift.toFixed(2)} and the body under it ${muscleShift.toFixed(2)}`,
    );
  });

  test('the same assessment always builds the same mesh', () => {
    const a = buildBody3D(dataAt(25));
    const b = buildBody3D(dataAt(25));
    assert.deepEqual(Array.from(a.muscle.positions), Array.from(b.muscle.positions));
    assert.deepEqual(Array.from(a.fat.indices), Array.from(b.fat.indices));
  });

  test('the figure stands the right way up', () => {
    // The 2D view is y-down and the scene is y-up. Getting the flip wrong
    // renders an upside-down person, which is obvious on a device and
    // invisible in a diff.
    const body = buildBody3D(dataAt(20));
    const { minY, maxY } = extent(body.muscle);
    assert.ok(minY >= -0.01, 'the feet should sit at or above zero');
    assert.ok(maxY > minY, 'the head should be above the feet');
    assert.ok(maxY <= body.height + 0.01);
  });
});

/**
 * How deep the trunk is, front to back, at belly height.
 *
 * The trunk is where the layer actually shows. Taking the whole body's extent
 * instead measures the feet, which is how a broken layer could look fine.
 */
function trunkDepth(mesh: MeshData): number {
  const { minY, maxY } = extent(mesh);
  const height = maxY - minY;
  // Wide enough to take in the belly as well as the waist and hips. A window
  // that missed the belly measured only the parts whose girth saturates in the
  // upper bands, so the layer looked static above 40% when it was not.
  const low = minY + height * 0.36;
  const high = minY + height * 0.60;

  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const y = mesh.positions[i + 1];
    if (y < low || y > high) continue;
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  assert.ok(Number.isFinite(maxZ), 'no vertices across the trunk');
  return maxZ;
}

function extent(mesh: MeshData): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    minX = Math.min(minX, mesh.positions[i]);
    maxX = Math.max(maxX, mesh.positions[i]);
    minY = Math.min(minY, mesh.positions[i + 1]);
    maxY = Math.max(maxY, mesh.positions[i + 1]);
    maxZ = Math.max(maxZ, mesh.positions[i + 2]);
  }
  return { minX, maxX, minY, maxY, maxZ };
}
