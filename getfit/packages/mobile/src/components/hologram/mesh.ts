/**
 * The hologram as real geometry.
 *
 * The 2D figure is drawn as outlines; this builds the same body as a mesh, so
 * it can be lit, rotated by a real camera and seen to have a front and a back.
 * Both come from one set of measurements, which is what keeps them the same
 * person — the flat renderer is the fallback when a device cannot give us a GL
 * context, and a fallback that drew a different body would be worse than none.
 *
 * Every limb is a loft: a stack of rings, each an ellipse whose half-width
 * comes from the measurements and whose depth is derived from it. A body is
 * deeper than it is wide at the chest and shallower at the waist, and that
 * ratio is most of what separates a human form from a stack of tubes.
 */

export interface Ring {
  /** Height up the figure, 0 at the feet. */
  y: number;
  /** Half-width, left to right. */
  halfWidth: number;
  /** Half-depth, front to back. */
  halfDepth: number;
  /** Sideways offset of the ring's centre, for limbs held away from the body. */
  offsetX: number;
  /** Forward offset, for limbs that sit in front of or behind the trunk. */
  offsetZ: number;
}

export interface MeshData {
  /** Flat xyz triples. */
  positions: Float32Array;
  /** Per-vertex normals, for the fresnel rim the shader needs. */
  normals: Float32Array;
  /** Triangle indices. */
  indices: Uint16Array;
}

/** How many points go around each ring. More is smoother and costs more. */
const SEGMENTS = 18;

/**
 * Lofts one limb from a stack of rings.
 *
 * Rings must be ordered bottom to top. The ends are capped, so the result is a
 * closed surface — an open tube shows its own inside when it turns, which on a
 * translucent hologram reads as a hole.
 */
export function loft(rings: Ring[]): MeshData {
  if (rings.length < 2) throw new Error('a loft needs at least two rings');

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const ring of rings) {
    for (let s = 0; s < SEGMENTS; s += 1) {
      const angle = (s / SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      positions.push(
        ring.offsetX + cos * ring.halfWidth,
        ring.y,
        ring.offsetZ + sin * ring.halfDepth,
      );

      // The ellipse's outward normal, which is not the radial direction unless
      // width and depth happen to match.
      const nx = cos * ring.halfDepth;
      const nz = sin * ring.halfWidth;
      const length = Math.hypot(nx, nz) || 1;
      normals.push(nx / length, 0, nz / length);
    }
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let s = 0; s < SEGMENTS; s += 1) {
      const next = (s + 1) % SEGMENTS;
      const a = r * SEGMENTS + s;
      const b = r * SEGMENTS + next;
      const c = (r + 1) * SEGMENTS + s;
      const d = (r + 1) * SEGMENTS + next;
      indices.push(a, c, b, b, c, d);
    }
  }

  capEnd(rings[0], positions, normals, indices, 0, -1);
  capEnd(
    rings[rings.length - 1],
    positions,
    normals,
    indices,
    (rings.length - 1) * SEGMENTS,
    1,
  );

  smoothNormals(positions, normals, indices);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

/** Closes one end of a loft with a fan to a centre point. */
function capEnd(
  ring: Ring,
  positions: number[],
  normals: number[],
  indices: number[],
  firstIndex: number,
  direction: -1 | 1,
): void {
  const centre = positions.length / 3;
  positions.push(ring.offsetX, ring.y, ring.offsetZ);
  normals.push(0, direction, 0);

  for (let s = 0; s < SEGMENTS; s += 1) {
    const next = (s + 1) % SEGMENTS;
    if (direction === 1) {
      indices.push(centre, firstIndex + s, firstIndex + next);
    } else {
      indices.push(centre, firstIndex + next, firstIndex + s);
    }
  }
}

/**
 * Averages face normals into the vertices.
 *
 * The ring normals above are horizontal, which is right for a cylinder and
 * wrong everywhere the body tapers — and the fresnel rim that makes this read
 * as a hologram is entirely a function of the normal, so a wrong one shows up
 * immediately as a limb with no edge glow.
 */
function smoothNormals(positions: number[], normals: number[], indices: number[]): void {
  const accumulated = new Float64Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const [ia, ib, ic] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];

    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    for (const index of [ia, ib, ic]) {
      accumulated[index] += nx;
      accumulated[index + 1] += ny;
      accumulated[index + 2] += nz;
    }
  }

  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(accumulated[i], accumulated[i + 1], accumulated[i + 2]);
    if (length > 1e-6) {
      normals[i] = accumulated[i] / length;
      normals[i + 1] = accumulated[i + 1] / length;
      normals[i + 2] = accumulated[i + 2] / length;
    }
  }
}

/** Joins several lofts into one mesh, renumbering the indices. */
export function merge(parts: MeshData[]): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...part.positions);
    normals.push(...part.normals);
    for (const index of part.indices) indices.push(index + offset);
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    // A merged body runs past 65535 vertices on some builds, so the index type
    // is widened here rather than silently wrapping round to vertex zero.
    indices: Uint32Array.from(indices) as unknown as Uint16Array,
  };
}
