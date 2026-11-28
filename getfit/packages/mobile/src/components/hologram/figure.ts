/**
 * The figure's skeleton: landmarks, the pose, and the outlines built on them.
 *
 * Everything is expressed as a half-width out from the centre line at a named
 * height, so one set of measurements shapes the silhouette, the muscle map and
 * the fat layer together. Heights are fixed; widths come from the user.
 *
 * The pose follows the reference renders: standing square to the viewer, arms
 * carried about 18° clear of the body with the hands open, feet a little
 * apart. Arms away from the torso matter more than they sound — they are what
 * lets the lat, the serratus and the obliques be seen at all, and a figure with
 * its arms pinned to its sides hides a third of its own anatomy.
 */

export const VIEW_WIDTH = 320;
export const VIEW_HEIGHT = 560;
export const CX = VIEW_WIDTH / 2;

/** Vertical landmarks, in view units from the top. */
export const Y = {
  headTop: 18,
  headCenter: 56,
  brow: 48,
  chin: 98,
  neck: 108,
  shoulder: 128,
  armpit: 156,
  chest: 182,
  ribs: 214,
  belly: 244,
  waist: 268,
  hip: 300,
  crotch: 328,
  thigh: 366,
  knee: 426,
  calf: 464,
  ankle: 518,
  foot: 538,
  elbow: 250,
  wrist: 352,
  fingertip: 396,
} as const;

export interface Side {
  left: number;
  right: number;
}

export interface Widths {
  shoulder: Side;
  chest: Side;
  belly: Side;
  waist: Side;
  hip: Side;
  thigh: Side;
  knee: Side;
  calf: Side;
  ankle: Side;
  upperArm: Side;
  forearm: Side;
}

export type Sign = -1 | 1;

/** Picks one side's width. `1` is the viewer's right. */
export function pick(side: Side, sign: Sign): number {
  return sign === 1 ? side.right : side.left;
}

/** x at a distance out from the centre line, on the given side. */
export function at(sign: Sign, offset: number): number {
  return CX + sign * offset;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Where one arm hangs, given the shoulder it hangs from. */
export function armJoints(w: Widths, sign: Sign): {
  shoulderX: number;
  elbowX: number;
  wristX: number;
  upper: number;
  fore: number;
} {
  const shoulder = pick(w.shoulder, sign);
  return {
    shoulderX: shoulder - 4,
    // Roughly 18° clear of the body, opening a little further at the wrist.
    elbowX: shoulder + 16,
    wristX: shoulder + 34,
    upper: pick(w.upperArm, sign),
    fore: pick(w.forearm, sign),
  };
}

/** Where one leg hangs, given the pelvis it hangs from. */
export function legJoints(w: Widths, sign: Sign): {
  hipX: number;
  kneeX: number;
  ankleX: number;
  thigh: number;
  knee: number;
  calf: number;
  ankle: number;
} {
  const hip = pick(w.hip, sign);
  const thigh = pick(w.thigh, sign);
  // Each leg hangs far enough out that its inner edge clears the centre line.
  // Closer than this and the two thighs fuse into one mass at the top, which
  // reads as a single limb rather than a standing figure.
  const hipX = Math.max(hip * 0.46, thigh - 6);
  return {
    hipX,
    // The legs close slightly towards the ankle, which is how a person stands.
    kneeX: hipX * 0.9,
    ankleX: hipX * 0.78,
    thigh: pick(w.thigh, sign),
    knee: pick(w.knee, sign),
    calf: pick(w.calf, sign),
    ankle: pick(w.ankle, sign),
  };
}

/**
 * Head and neck.
 *
 * A cranium tapering to a jaw rather than a circle: the reference's head is the
 * brightest thing in the frame and the first thing the eye lands on, so a ball
 * on a stick is the one shape that cannot be got away with.
 */
export function buildHead(): string {
  const skull = 25;
  const jaw = 16;
  return [
    `M ${CX} ${Y.headTop}`,
    `C ${at(1, skull * 0.72)} ${Y.headTop} ${at(1, skull)} ${Y.headTop + 16} ${at(1, skull)} ${Y.brow}`,
    `C ${at(1, skull)} ${Y.brow + 16} ${at(1, jaw + 5)} ${Y.chin - 22} ${at(1, jaw)} ${Y.chin - 10}`,
    `C ${at(1, jaw - 3)} ${Y.chin - 2} ${at(1, 8)} ${Y.chin + 3} ${CX} ${Y.chin + 4}`,
    `C ${at(-1, 8)} ${Y.chin + 3} ${at(-1, jaw - 3)} ${Y.chin - 2} ${at(-1, jaw)} ${Y.chin - 10}`,
    `C ${at(-1, jaw + 5)} ${Y.chin - 22} ${at(-1, skull)} ${Y.brow + 16} ${at(-1, skull)} ${Y.brow}`,
    `C ${at(-1, skull)} ${Y.headTop + 16} ${at(-1, skull * 0.72)} ${Y.headTop} ${CX} ${Y.headTop}`,
    'Z',
  ].join(' ');
}

/** Brow, eye sockets, nose and mouth — enough to read as a face, no more. */
export function buildFace(): string[] {
  return [
    // Brow ridge.
    `M ${at(-1, 19)} ${Y.brow + 2} C ${at(-1, 12)} ${Y.brow - 4} ${at(1, 12)} ${Y.brow - 4} ${at(1, 19)} ${Y.brow + 2}`,
    // Eye sockets.
    `M ${at(-1, 17)} ${Y.brow + 9} C ${at(-1, 13)} ${Y.brow + 14} ${at(-1, 7)} ${Y.brow + 14} ${at(-1, 5)} ${Y.brow + 8}`,
    `M ${at(1, 17)} ${Y.brow + 9} C ${at(1, 13)} ${Y.brow + 14} ${at(1, 7)} ${Y.brow + 14} ${at(1, 5)} ${Y.brow + 8}`,
    // Nose.
    `M ${CX} ${Y.brow + 4} L ${CX} ${Y.brow + 22} M ${at(-1, 5)} ${Y.brow + 24} C ${at(-1, 2)} ${Y.brow + 27} ${at(1, 2)} ${Y.brow + 27} ${at(1, 5)} ${Y.brow + 24}`,
    // Mouth.
    `M ${at(-1, 9)} ${Y.chin - 16} C ${at(-1, 4)} ${Y.chin - 13} ${at(1, 4)} ${Y.chin - 13} ${at(1, 9)} ${Y.chin - 16}`,
    // Cheekbones.
    `M ${at(-1, 22)} ${Y.brow + 12} C ${at(-1, 18)} ${Y.brow + 24} ${at(-1, 13)} ${Y.brow + 30} ${at(-1, 8)} ${Y.brow + 32}`,
    `M ${at(1, 22)} ${Y.brow + 12} C ${at(1, 18)} ${Y.brow + 24} ${at(1, 13)} ${Y.brow + 30} ${at(1, 8)} ${Y.brow + 32}`,
  ];
}

/** Neck and trapezius, closing the gap between the jaw and the shoulders. */
export function buildNeck(w: Widths): string {
  const left = w.shoulder.left - 4;
  const right = w.shoulder.right - 4;
  return [
    `M ${at(-1, 13)} ${Y.chin - 6}`,
    `L ${at(-1, 12)} ${Y.neck}`,
    // Trapezius sweeping out to each deltoid.
    `C ${at(-1, 24)} ${Y.neck + 4} ${at(-1, left - 12)} ${Y.shoulder - 12} ${at(-1, left)} ${Y.shoulder + 6}`,
    // Clavicles dipping in to the sternal notch, rather than a bar straight
    // across: the notch is what makes a pair of shoulders read as shoulders.
    `C ${at(-1, left * 0.55)} ${Y.shoulder + 16} ${at(-1, 16)} ${Y.shoulder + 14} ${CX} ${Y.shoulder + 16}`,
    `C ${at(1, 16)} ${Y.shoulder + 14} ${at(1, right * 0.55)} ${Y.shoulder + 16} ${at(1, right)} ${Y.shoulder + 6}`,
    `C ${at(1, right - 12)} ${Y.shoulder - 12} ${at(1, 24)} ${Y.neck + 4} ${at(1, 12)} ${Y.neck}`,
    `L ${at(1, 13)} ${Y.chin - 6}`,
    'Z',
  ].join(' ');
}

/** Neck, shoulders, ribcage, abdomen and pelvis as one closed shape. */
export function buildTorso(w: Widths): string {
  const r = (value: number): number => at(1, value);
  const l = (value: number): number => at(-1, value);

  return [
    `M ${r(11)} ${Y.neck - 4}`,
    `C ${r(24)} ${Y.neck + 2} ${r(w.shoulder.right - 18)} ${Y.shoulder - 14} ${r(w.shoulder.right)} ${Y.shoulder + 6}`,
    // Deltoid into the armpit, then the lat down the side of the ribcage.
    `C ${r(w.shoulder.right)} ${Y.armpit - 8} ${r(w.chest.right + 3)} ${Y.armpit} ${r(w.chest.right)} ${Y.chest}`,
    `C ${r(w.chest.right)} ${Y.ribs - 4} ${r(w.belly.right)} ${Y.belly - 26} ${r(w.belly.right)} ${Y.belly}`,
    `C ${r(w.belly.right)} ${Y.belly + 12} ${r(w.waist.right + 1)} ${Y.waist - 12} ${r(w.waist.right)} ${Y.waist}`,
    `C ${r(w.waist.right + 2)} ${Y.waist + 14} ${r(w.hip.right)} ${Y.hip - 16} ${r(w.hip.right)} ${Y.hip}`,
    // Pelvic arch, so the legs read as emerging from it.
    `C ${r(w.hip.right - 2)} ${Y.hip + 16} ${r(w.hip.right * 0.55)} ${Y.crotch + 4} ${r(3)} ${Y.crotch + 2}`,
    `C ${l(3)} ${Y.crotch + 2} ${l(w.hip.left * 0.55)} ${Y.crotch + 4} ${l(w.hip.left - 2)} ${Y.hip + 16}`,
    `L ${l(w.hip.left)} ${Y.hip}`,
    `C ${l(w.hip.left)} ${Y.hip - 16} ${l(w.waist.left + 2)} ${Y.waist + 14} ${l(w.waist.left)} ${Y.waist}`,
    `C ${l(w.waist.left + 1)} ${Y.waist - 12} ${l(w.belly.left)} ${Y.belly + 12} ${l(w.belly.left)} ${Y.belly}`,
    `C ${l(w.belly.left)} ${Y.belly - 26} ${l(w.chest.left)} ${Y.ribs - 4} ${l(w.chest.left)} ${Y.chest}`,
    `C ${l(w.chest.left + 3)} ${Y.armpit} ${l(w.shoulder.left)} ${Y.armpit - 8} ${l(w.shoulder.left)} ${Y.shoulder + 6}`,
    `C ${l(w.shoulder.left - 18)} ${Y.shoulder - 14} ${l(24)} ${Y.neck + 2} ${l(11)} ${Y.neck - 4}`,
    'Z',
  ].join(' ');
}

/** One arm: deltoid, upper arm, forearm and an open hand. */
export function buildArm(w: Widths, sign: Sign): string {
  const { shoulderX, elbowX, wristX, upper, fore } = armJoints(w, sign);
  const x = (value: number): number => at(sign, value);
  const hand = fore * 0.95;

  return [
    `M ${x(shoulderX - upper * 0.55)} ${Y.shoulder + 12}`,
    // Outside: the deltoid arcs up over the joint, then the biceps belly, the
    // forearm swell and the hand.
    `C ${x(shoulderX - upper * 0.1)} ${Y.shoulder - 4} ${x(shoulderX + upper * 0.95)} ${Y.shoulder + 4} ${x(shoulderX + upper * 1.05)} ${Y.armpit + 4}`,
    `C ${x(shoulderX + upper * 1.02)} ${Y.chest + 4} ${x(elbowX + upper * 0.8)} ${Y.chest + 14} ${x(elbowX + upper * 0.72)} ${Y.chest + 26}`,
    `C ${x(elbowX + upper * 0.66)} ${Y.elbow - 24} ${x(elbowX + upper * 0.6)} ${Y.elbow - 8} ${x(elbowX + upper * 0.55)} ${Y.elbow}`,
    `C ${x(wristX + fore * 0.92)} ${Y.elbow + 28} ${x(wristX + fore * 0.74)} ${Y.wrist - 36} ${x(wristX + fore * 0.46)} ${Y.wrist}`,
    // Hand: a palm and four fingers, drawn as one edge so it stays readable
    // at the size this is actually shown.
    `C ${x(wristX + hand * 0.8)} ${Y.wrist + 14} ${x(wristX + hand * 0.9)} ${Y.fingertip - 16} ${x(wristX + hand * 0.55)} ${Y.fingertip - 4}`,
    `C ${x(wristX + hand * 0.3)} ${Y.fingertip + 2} ${x(wristX - hand * 0.1)} ${Y.fingertip} ${x(wristX - hand * 0.3)} ${Y.fingertip - 10}`,
    `C ${x(wristX - hand * 0.7)} ${Y.fingertip - 22} ${x(wristX - fore * 0.6)} ${Y.wrist + 8} ${x(wristX - fore * 0.5)} ${Y.wrist}`,
    // Inside: forearm back up to the elbow, then the triceps to the armpit.
    `C ${x(elbowX - fore * 0.62)} ${Y.wrist - 32} ${x(elbowX - upper * 0.52)} ${Y.elbow + 22} ${x(elbowX - upper * 0.5)} ${Y.elbow}`,
    `C ${x(elbowX - upper * 0.66)} ${Y.chest + 20} ${x(shoulderX - upper * 0.55)} ${Y.armpit} ${x(shoulderX - upper * 0.55)} ${Y.shoulder + 12}`,
    'Z',
  ].join(' ');
}

/** One leg: thigh, knee, calf and a foot with toes. */
export function buildLeg(w: Widths, sign: Sign): string {
  const { hipX, kneeX, ankleX, thigh, knee, calf, ankle } = legJoints(w, sign);
  const x = (value: number): number => at(sign, value);
  const hip = pick(w.hip, sign);

  return [
    `M ${x(hip)} ${Y.hip - 2}`,
    // Outside: hip, vastus lateralis, knee, calf, ankle.
    `C ${x(hip + 2)} ${Y.hip + 18} ${x(hipX + thigh)} ${Y.thigh - 30} ${x(hipX + thigh)} ${Y.thigh}`,
    `C ${x(hipX + thigh)} ${Y.thigh + 28} ${x(kneeX + knee + 1)} ${Y.knee - 26} ${x(kneeX + knee)} ${Y.knee}`,
    `C ${x(kneeX + knee)} ${Y.knee + 12} ${x(ankleX + calf)} ${Y.calf - 24} ${x(ankleX + calf)} ${Y.calf}`,
    `C ${x(ankleX + calf)} ${Y.calf + 36} ${x(ankleX + ankle + 1)} ${Y.ankle - 22} ${x(ankleX + ankle)} ${Y.ankle}`,
    // Foot, toes forward.
    `C ${x(ankleX + ankle + 2)} ${Y.ankle + 10} ${x(ankleX + ankle + 3)} ${Y.foot - 4} ${x(ankleX + ankle)} ${Y.foot}`,
    `L ${x(ankleX - ankle - 2)} ${Y.foot}`,
    `C ${x(ankleX - ankle - 3)} ${Y.foot - 8} ${x(ankleX - ankle)} ${Y.ankle + 10} ${x(ankleX - ankle)} ${Y.ankle}`,
    // Inside: back up the calf and the adductors.
    `C ${x(ankleX - calf)} ${Y.ankle - 22} ${x(ankleX - calf)} ${Y.calf + 36} ${x(ankleX - calf)} ${Y.calf}`,
    `C ${x(ankleX - calf)} ${Y.calf - 24} ${x(kneeX - knee)} ${Y.knee + 12} ${x(kneeX - knee)} ${Y.knee}`,
    `C ${x(kneeX - knee)} ${Y.knee - 26} ${x(hipX - thigh)} ${Y.thigh + 28} ${x(hipX - thigh)} ${Y.thigh}`,
    `C ${x(hipX - thigh)} ${Y.thigh - 26} ${x(7)} ${Y.crotch + 18} ${x(4)} ${Y.crotch + 2}`,
    'Z',
  ].join(' ');
}
