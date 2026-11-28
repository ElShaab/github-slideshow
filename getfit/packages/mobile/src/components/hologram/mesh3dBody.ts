import type { HologramData } from '@getfit/shared';
import { buildGeometry } from './geometry';
import { Y, armJoints, legJoints, type Sign, type Widths } from './figure';
import { loft, merge, type MeshData, type Ring } from './mesh';

/**
 * The body as two meshes: the muscle underneath, and the fat over it.
 *
 * Same arrangement as the flat renderer — fat is translucent and the muscle is
 * always there to see through it — but in three dimensions the shell genuinely
 * contains the body rather than being a ring drawn around its outline, so it
 * holds up when the figure turns.
 */

export interface Body3D {
  muscle: MeshData;
  fat: MeshData;
  /** Height of the figure in world units, for framing the camera. */
  height: number;
}

/**
 * Depth relative to width, per landmark.
 *
 * A torso is deeper than it is wide at the ribs and shallower at the hips; a
 * limb is round. Flattening everything to one ratio is what makes a lofted
 * figure look like plumbing.
 */
const DEPTH = {
  head: 1.12,
  neck: 1,
  shoulder: 0.62,
  chest: 0.72,
  belly: 0.84,
  waist: 0.86,
  hip: 0.74,
  limb: 1,
} as const;

/** The 2D view is y-down; the scene is y-up, so heights are flipped here. */
function up(viewY: number): number {
  return Y.foot - viewY;
}

function ring(
  viewY: number,
  halfWidth: number,
  depthRatio: number,
  offsetX = 0,
  offsetZ = 0,
): Ring {
  return {
    y: up(viewY),
    halfWidth: Math.max(0.8, halfWidth),
    halfDepth: Math.max(0.8, halfWidth * depthRatio),
    offsetX,
    offsetZ,
  };
}

function trunkRings(w: Widths): Ring[] {
  const half = (side: { left: number; right: number }): number => (side.left + side.right) / 2;
  // Where the two sides differ, the ring's centre shifts rather than the body
  // becoming lopsided about its own spine — which is what a real asymmetry
  // looks like from the front.
  const shift = (side: { left: number; right: number }): number => (side.right - side.left) / 2;

  return [
    ring(Y.crotch + 4, half(w.hip) * 0.82, DEPTH.hip, shift(w.hip)),
    ring(Y.hip, half(w.hip), DEPTH.hip, shift(w.hip)),
    ring(Y.waist, half(w.waist), DEPTH.waist, shift(w.waist)),
    ring(Y.belly, half(w.belly), DEPTH.belly, shift(w.belly)),
    ring(Y.chest, half(w.chest), DEPTH.chest, shift(w.chest)),
    ring(Y.armpit, half(w.chest) * 1.02, DEPTH.chest, shift(w.chest)),
    ring(Y.shoulder + 4, half(w.shoulder) * 0.92, DEPTH.shoulder, shift(w.shoulder)),
    ring(Y.neck, 13, DEPTH.neck),
    ring(Y.chin - 2, 12, DEPTH.neck),
  ];
}

function headRings(): Ring[] {
  return [
    ring(Y.chin + 2, 9, DEPTH.head),
    ring(Y.chin - 12, 16, DEPTH.head),
    ring(Y.brow + 10, 22, DEPTH.head),
    ring(Y.brow - 4, 25, DEPTH.head),
    ring(Y.headTop + 12, 22, DEPTH.head),
    ring(Y.headTop, 11, DEPTH.head),
  ];
}

function armRings(w: Widths, sign: Sign): Ring[] {
  const { shoulderX, elbowX, wristX, upper, fore } = armJoints(w, sign);
  const x = (value: number): number => sign * value;
  return [
    ring(Y.fingertip, fore * 0.42, DEPTH.limb, x(wristX + fore * 0.1)),
    ring(Y.wrist + 12, fore * 0.62, DEPTH.limb, x(wristX + fore * 0.05)),
    ring(Y.wrist, fore * 0.6, DEPTH.limb, x(wristX)),
    ring(Y.elbow + 26, fore * 0.86, DEPTH.limb, x((elbowX + wristX) / 2)),
    ring(Y.elbow, upper * 0.72, DEPTH.limb, x(elbowX)),
    ring(Y.chest + 16, upper * 0.95, DEPTH.limb, x((shoulderX + elbowX) / 2)),
    ring(Y.armpit, upper * 1.05, DEPTH.limb, x(shoulderX + upper * 0.2)),
    ring(Y.shoulder + 2, upper * 0.9, DEPTH.limb, x(shoulderX + upper * 0.1)),
  ];
}

function legRings(w: Widths, sign: Sign): Ring[] {
  const { hipX, kneeX, ankleX, thigh, knee, calf, ankle } = legJoints(w, sign);
  const x = (value: number): number => sign * value;
  return [
    // The foot is a flattened ring pushed forward, so the figure stands on
    // something rather than tapering to a point.
    { ...ring(Y.foot, ankle * 1.1, 0.45, x(ankleX), 6), halfDepth: ankle * 2.1 },
    ring(Y.ankle, ankle, DEPTH.limb, x(ankleX)),
    ring(Y.calf, calf, DEPTH.limb, x(ankleX)),
    ring(Y.knee, knee, DEPTH.limb, x(kneeX)),
    ring(Y.thigh, thigh, DEPTH.limb, x(hipX)),
    ring(Y.crotch + 2, thigh * 1.04, DEPTH.limb, x(hipX)),
  ];
}

function bodyFrom(w: Widths): MeshData {
  return merge([
    loft(trunkRings(w)),
    loft(headRings()),
    loft(armRings(w, -1)),
    loft(armRings(w, 1)),
    loft(legRings(w, -1)),
    loft(legRings(w, 1)),
  ]);
}

/**
 * Both bodies, from one assessment.
 *
 * The widths come back out of the 2D geometry rather than being recomputed, so
 * there is exactly one place that turns an assessment into a shape. The flat
 * figure and the mesh cannot drift apart into two different people.
 */
export function buildBody3D(data: HologramData): Body3D {
  const geometry = buildGeometry(data);
  return {
    muscle: bodyFrom(geometry.leanWidths),
    fat: bodyFrom(geometry.outerWidths),
    height: Y.foot - Y.headTop,
  };
}
