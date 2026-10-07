import { Y, at, armJoints, legJoints, pick, type Sign, type Widths } from './figure';

/**
 * The muscle map.
 *
 * Each group is a belly — a filled shape — plus the fibres running through it
 * in the direction that muscle actually pulls. The direction is the part that
 * carries the anatomy: pecs fan inward to the sternum, the serratus runs as
 * finger-like slips along the ribs, the rectus femoris runs straight down the
 * thigh while the sartorius crosses it diagonally. Getting those wrong reads as
 * decoration; getting them right reads as a body.
 *
 * Everything here is a function of the same widths the silhouette uses, so a
 * wider chest gets wider pecs rather than the same pecs on a wider frame.
 */

export interface Belly {
  d: string;
  /** Which segment's development brightens it. */
  key: 'shoulders' | 'chest' | 'back' | 'arms' | 'waist' | 'hips' | 'quads' | 'calves';
  /** Relative weight, before development and definition are applied. */
  weight: number;
  /**
   * What makes this belly brighter.
   *
   * `development` for muscles the measurements describe directly — a bigger
   * arm girth means a bigger biceps. `definition` for the abdominals, because
   * nothing in a tape measure describes how developed someone's abs are: the
   * waist reading measures the fat sitting on top of them. Driving abs from
   * the waist segment makes them glow brighter as their owner gains weight,
   * which is exactly backwards.
   */
  driver: 'development' | 'definition';
}

export interface Fibre {
  d: string;
  weight: number;
}

/** Deltoid: three heads over the shoulder, fibres converging downward. */
function deltoid(w: Widths, sign: Sign): { belly: Belly; fibres: Fibre[] } {
  const { shoulderX, upper } = armJoints(w, sign);
  const x = (v: number): number => at(sign, v);
  const outer = shoulderX + upper * 0.95;
  const inner = shoulderX - upper * 0.3;

  const belly: Belly = {
    key: 'shoulders',
    weight: 1,
    driver: 'development',
    d: [
      `M ${x(inner)} ${Y.shoulder + 14}`,
      // Over the top of the joint in one arc, which is the shape that reads as
      // a deltoid rather than a pad strapped to the shoulder.
      `C ${x(inner + 2)} ${Y.shoulder - 2} ${x(outer - 6)} ${Y.shoulder} ${x(outer)} ${Y.armpit - 6}`,
      `C ${x(outer + 1)} ${Y.armpit + 10} ${x(outer - 5)} ${Y.chest + 8} ${x(shoulderX + upper * 0.28)} ${Y.chest + 16}`,
      `C ${x(inner + 8)} ${Y.chest + 6} ${x(inner - 1)} ${Y.armpit - 6} ${x(inner)} ${Y.shoulder + 14}`,
      'Z',
    ].join(' '),
  };

  // Anterior, lateral and posterior heads, all converging on the insertion.
  const fibres: Fibre[] = [0, 1, 2].map((index) => {
    const t = index / 2;
    const start = inner + (outer - inner) * (0.12 + t * 0.78);
    return {
      weight: 0.85,
      d: `M ${x(start)} ${Y.shoulder + 8 + t * 6} Q ${x(start + 2)} ${Y.armpit + 6} ${x(shoulderX + upper * 0.3)} ${Y.chest + 12}`,
    };
  });

  return { belly, fibres };
}

/** Pectoralis major: a fan from the sternum out to the humerus. */
function pectoral(w: Widths, sign: Sign): { belly: Belly; fibres: Fibre[] } {
  const chest = pick(w.chest, sign);
  const x = (v: number): number => at(sign, v);
  const outer = chest * 0.82;

  const belly: Belly = {
    key: 'chest',
    weight: 1,
    driver: 'development',
    d: [
      `M ${x(4)} ${Y.shoulder + 14}`,
      `C ${x(chest * 0.4)} ${Y.shoulder + 10} ${x(outer)} ${Y.armpit - 10} ${x(outer)} ${Y.armpit + 6}`,
      `C ${x(outer)} ${Y.chest + 10} ${x(chest * 0.5)} ${Y.chest + 22} ${x(5)} ${Y.chest + 16}`,
      `C ${x(4)} ${Y.chest} ${x(4)} ${Y.armpit - 10} ${x(4)} ${Y.shoulder + 14}`,
      'Z',
    ].join(' '),
  };

  // The fan: every fibre starts on the sternum and converges on one insertion
  // under the deltoid, which is what gives a pec its twist.
  const insertion = { x: x(outer * 0.94), y: Y.armpit + 2 };
  const fibres: Fibre[] = [0, 1, 2, 3, 4].map((index) => {
    const t = index / 4;
    const startY = Y.shoulder + 14 + t * (Y.chest + 14 - (Y.shoulder + 14));
    return {
      weight: 0.9 - t * 0.12,
      d: `M ${x(5)} ${startY} Q ${x(outer * 0.5)} ${startY - 3 + t * 6} ${insertion.x} ${insertion.y}`,
    };
  });

  return { belly, fibres };
}

/** Serratus anterior: the finger-like slips along the lower ribs. */
function serratus(w: Widths, sign: Sign): Fibre[] {
  const chest = pick(w.chest, sign);
  const x = (v: number): number => at(sign, v);
  return [0, 1, 2, 3].map((index) => {
    const y = Y.chest + 6 + index * 11;
    const reach = chest * (0.78 - index * 0.04);
    return {
      weight: 0.62,
      d: `M ${x(reach)} ${y} Q ${x(reach * 0.72)} ${y + 6} ${x(reach * 0.46)} ${y + 3}`,
    };
  });
}

/**
 * Rectus abdominis: eight blocks either side of the linea alba.
 *
 * Drawn as blocks rather than a slab because the tendinous intersections are
 * the thing anyone recognises, and because they give the fat layer something
 * to obscure gradually instead of all at once.
 */
function abdominals(w: Widths): { bellies: Belly[]; fibres: Fibre[] } {
  const bellies: Belly[] = [];
  const fibres: Fibre[] = [];

  for (let row = 0; row < 4; row += 1) {
    const top = Y.chest + 22 + row * 17;
    const height = row === 3 ? 20 : 14;
    // The block grid narrows towards the navel, as it does on a body.
    const half = Math.min(15, pick(w.belly, 1) * (0.40 - row * 0.02));
    for (const sign of [-1, 1] as Sign[]) {
      const x = (v: number): number => at(sign, v);
      bellies.push({
        key: 'waist',
        weight: 1 - row * 0.08,
        driver: 'definition',
        d: [
          `M ${x(1.5)} ${top}`,
          `C ${x(half * 0.6)} ${top - 2} ${x(half)} ${top + 1} ${x(half)} ${top + height * 0.45}`,
          `C ${x(half)} ${top + height} ${x(half * 0.6)} ${top + height + 2} ${x(1.5)} ${top + height}`,
          'Z',
        ].join(' '),
      });
    }
  }

  // Linea alba, and the tendinous lines across it.
  fibres.push({ weight: 1, d: `M ${at(1, 0)} ${Y.chest + 20} L ${at(1, 0)} ${Y.hip - 12}` });
  for (let row = 1; row < 4; row += 1) {
    const y = Y.chest + 20 + row * 17;
    const half = Math.min(15, pick(w.belly, 1) * 0.4);
    fibres.push({
      weight: 0.7,
      d: `M ${at(-1, half)} ${y + 1} Q ${at(1, 0)} ${y - 2} ${at(1, half)} ${y + 1}`,
    });
  }

  return { bellies, fibres };
}

/** External oblique: the flank, running down and in towards the pelvis. */
function oblique(w: Widths, sign: Sign): { belly: Belly; fibres: Fibre[] } {
  const x = (v: number): number => at(sign, v);
  const ribs = pick(w.chest, sign) * 0.9;
  const waist = pick(w.waist, sign);
  const hip = pick(w.hip, sign);

  const belly: Belly = {
    key: 'waist',
    weight: 0.5,
    driver: 'definition',
    d: [
      `M ${x(ribs * 0.55)} ${Y.chest + 10}`,
      `C ${x(ribs)} ${Y.ribs - 6} ${x(waist)} ${Y.waist - 14} ${x(waist * 0.96)} ${Y.waist + 4}`,
      `C ${x(hip * 0.8)} ${Y.hip - 8} ${x(hip * 0.5)} ${Y.hip - 4} ${x(hip * 0.3)} ${Y.hip - 6}`,
      `C ${x(hip * 0.42)} ${Y.waist - 8} ${x(ribs * 0.5)} ${Y.ribs - 10} ${x(ribs * 0.55)} ${Y.chest + 10}`,
      'Z',
    ].join(' '),
  };

  const fibres: Fibre[] = [0, 1, 2].map((index) => {
    const t = index / 2;
    const startY = Y.chest + 16 + t * 26;
    return {
      weight: 0.6,
      d: `M ${x(ribs * (0.92 - t * 0.06))} ${startY} Q ${x(waist * 0.72)} ${startY + 20} ${x(hip * 0.36)} ${startY + 36}`,
    };
  });

  // The inguinal line over each hip, which frames the lower abdomen.
  fibres.push({
    weight: 0.4,
    d: `M ${x(hip * 0.8)} ${Y.hip - 14} Q ${x(hip * 0.5)} ${Y.hip + 2} ${x(hip * 0.22)} ${Y.crotch - 10}`,
  });

  return { belly, fibres };
}

/** Biceps and triceps on the upper arm, and the forearm groups below. */
function armMuscles(w: Widths, sign: Sign): { bellies: Belly[]; fibres: Fibre[] } {
  const { shoulderX, elbowX, wristX, upper, fore } = armJoints(w, sign);
  const x = (v: number): number => at(sign, v);

  const biceps: Belly = {
    key: 'arms',
    weight: 0.95,
    driver: 'development',
    d: [
      `M ${x(shoulderX + upper * 0.1)} ${Y.chest - 6}`,
      `C ${x(shoulderX + upper * 0.7)} ${Y.chest + 6} ${x(elbowX + upper * 0.5)} ${Y.elbow - 40} ${x(elbowX + upper * 0.18)} ${Y.elbow - 8}`,
      `C ${x(elbowX - upper * 0.2)} ${Y.elbow - 30} ${x(shoulderX - upper * 0.2)} ${Y.chest + 14} ${x(shoulderX + upper * 0.1)} ${Y.chest - 6}`,
      'Z',
    ].join(' '),
  };

  const forearm: Belly = {
    key: 'arms',
    weight: 0.8,
    driver: 'development',
    d: [
      `M ${x(elbowX + upper * 0.45)} ${Y.elbow - 4}`,
      `C ${x(wristX + fore * 0.78)} ${Y.elbow + 34} ${x(wristX + fore * 0.5)} ${Y.wrist - 30} ${x(wristX + fore * 0.28)} ${Y.wrist - 6}`,
      `C ${x(wristX - fore * 0.2)} ${Y.wrist - 24} ${x(elbowX - upper * 0.2)} ${Y.elbow + 30} ${x(elbowX + upper * 0.45)} ${Y.elbow - 4}`,
      'Z',
    ].join(' '),
  };

  const fibres: Fibre[] = [
    // Biceps long and short heads.
    {
      weight: 0.8,
      d: `M ${x(shoulderX + upper * 0.25)} ${Y.chest} Q ${x(elbowX + upper * 0.45)} ${Y.elbow - 60} ${x(elbowX + upper * 0.22)} ${Y.elbow - 10}`,
    },
    {
      weight: 0.7,
      d: `M ${x(shoulderX - upper * 0.05)} ${Y.chest + 4} Q ${x(elbowX + upper * 0.1)} ${Y.elbow - 58} ${x(elbowX + upper * 0.14)} ${Y.elbow - 10}`,
    },
    // Triceps, on the inside edge.
    {
      weight: 0.6,
      d: `M ${x(shoulderX - upper * 0.35)} ${Y.armpit + 12} Q ${x(elbowX - upper * 0.42)} ${Y.elbow - 50} ${x(elbowX - upper * 0.38)} ${Y.elbow - 6}`,
    },
    // Forearm flexor and extensor groups.
    {
      weight: 0.6,
      d: `M ${x(elbowX + upper * 0.38)} ${Y.elbow + 4} Q ${x(wristX + fore * 0.62)} ${Y.wrist - 56} ${x(wristX + fore * 0.3)} ${Y.wrist - 8}`,
    },
    {
      weight: 0.55,
      d: `M ${x(elbowX - upper * 0.1)} ${Y.elbow + 6} Q ${x(wristX + fore * 0.18)} ${Y.wrist - 52} ${x(wristX + fore * 0.02)} ${Y.wrist - 6}`,
    },
    // Tendons across the back of the hand.
    ...[0, 1, 2].map((index) => ({
      weight: 0.45,
      d: `M ${x(wristX + fore * (0.34 - index * 0.16))} ${Y.wrist + 4} L ${x(
        wristX + fore * (0.46 - index * 0.28),
      )} ${Y.fingertip - 12}`,
    })),
  ];

  return { bellies: [biceps, forearm], fibres };
}

/** Quadriceps, sartorius, knee and calf. */
function legMuscles(w: Widths, sign: Sign): { bellies: Belly[]; fibres: Fibre[] } {
  const { hipX, kneeX, ankleX, thigh, knee, calf } = legJoints(w, sign);
  const x = (v: number): number => at(sign, v);

  const quad: Belly = {
    key: 'quads',
    weight: 1,
    driver: 'development',
    d: [
      `M ${x(hipX - thigh * 0.55)} ${Y.crotch - 4}`,
      `C ${x(hipX - thigh * 0.8)} ${Y.thigh + 6} ${x(kneeX - knee * 0.55)} ${Y.knee - 44} ${x(kneeX - knee * 0.3)} ${Y.knee - 20}`,
      `C ${x(kneeX + knee * 0.35)} ${Y.knee - 30} ${x(hipX + thigh * 0.85)} ${Y.thigh + 4} ${x(hipX + thigh * 0.6)} ${Y.crotch - 8}`,
      `C ${x(hipX + thigh * 0.2)} ${Y.crotch - 16} ${x(hipX - thigh * 0.25)} ${Y.crotch - 14} ${x(hipX - thigh * 0.55)} ${Y.crotch - 4}`,
      'Z',
    ].join(' '),
  };

  const calfBelly: Belly = {
    key: 'calves',
    weight: 0.9,
    driver: 'development',
    d: [
      `M ${x(ankleX - calf * 0.62)} ${Y.knee + 14}`,
      `C ${x(ankleX - calf * 0.82)} ${Y.calf} ${x(ankleX - calf * 0.42)} ${Y.calf + 28} ${x(ankleX)} ${Y.calf + 34}`,
      `C ${x(ankleX + calf * 0.42)} ${Y.calf + 28} ${x(ankleX + calf * 0.82)} ${Y.calf} ${x(ankleX + calf * 0.62)} ${Y.knee + 14}`,
      'Z',
    ].join(' '),
  };

  const fibres: Fibre[] = [
    // Rectus femoris straight down the middle, vastus lateralis and medialis
    // sweeping in to the knee from either side.
    {
      weight: 0.85,
      d: `M ${x(hipX)} ${Y.crotch - 2} C ${x(hipX + 2)} ${Y.thigh + 20} ${x(kneeX)} ${Y.knee - 50} ${x(kneeX)} ${Y.knee - 18}`,
    },
    {
      weight: 0.7,
      d: `M ${x(hipX + thigh * 0.5)} ${Y.crotch + 6} C ${x(hipX + thigh * 0.72)} ${Y.thigh + 14} ${x(kneeX + knee * 0.3)} ${Y.knee - 46} ${x(kneeX + knee * 0.18)} ${Y.knee - 20}`,
    },
    {
      weight: 0.7,
      d: `M ${x(hipX - thigh * 0.35)} ${Y.thigh - 20} C ${x(hipX - thigh * 0.6)} ${Y.thigh + 26} ${x(kneeX - knee * 0.45)} ${Y.knee - 44} ${x(kneeX - knee * 0.24)} ${Y.knee - 16}`,
    },
    // Sartorius crossing the thigh, the longest muscle in the body and the one
    // that makes a thigh read as a thigh rather than a cylinder.
    {
      weight: 0.6,
      d: `M ${x(hipX + thigh * 0.76)} ${Y.crotch - 10} C ${x(hipX + thigh * 0.2)} ${Y.thigh + 20} ${x(kneeX - knee * 0.5)} ${Y.knee - 56} ${x(kneeX - knee * 0.6)} ${Y.knee - 14}`,
    },
    // Patella.
    {
      weight: 0.8,
      d: `M ${x(kneeX - knee * 0.45)} ${Y.knee - 4} C ${x(kneeX - knee * 0.3)} ${Y.knee + 10} ${x(kneeX + knee * 0.3)} ${Y.knee + 10} ${x(kneeX + knee * 0.45)} ${Y.knee - 4}`,
    },
    // Gastrocnemius heads, and the tibialis down the shin.
    {
      weight: 0.66,
      d: `M ${x(ankleX - calf * 0.4)} ${Y.knee + 18} Q ${x(ankleX - calf * 0.6)} ${Y.calf + 6} ${x(ankleX - calf * 0.1)} ${Y.calf + 30}`,
    },
    {
      weight: 0.66,
      d: `M ${x(ankleX + calf * 0.4)} ${Y.knee + 18} Q ${x(ankleX + calf * 0.6)} ${Y.calf + 6} ${x(ankleX + calf * 0.1)} ${Y.calf + 30}`,
    },
    {
      weight: 0.5,
      d: `M ${x(ankleX + calf * 0.15)} ${Y.knee + 16} C ${x(ankleX + calf * 0.3)} ${Y.calf + 20} ${x(ankleX + calf * 0.2)} ${Y.ankle - 30} ${x(ankleX + calf * 0.05)} ${Y.ankle - 4}`,
    },
    // Toes.
    ...[0, 1, 2, 3].map((index) => ({
      weight: 0.4,
      d: `M ${x(ankleX - calf * 0.5 + index * (calf * 0.32))} ${Y.foot - 9} L ${x(
        ankleX - calf * 0.5 + index * (calf * 0.32),
      )} ${Y.foot - 1}`,
    })),
  ];

  return { bellies: [quad, calfBelly], fibres };
}

/** Trapezius and sternocleidomastoid, which frame the neck. */
function neckMuscles(w: Widths): Fibre[] {
  const fibres: Fibre[] = [];
  for (const sign of [-1, 1] as Sign[]) {
    const x = (v: number): number => at(sign, v);
    const shoulder = pick(w.shoulder, sign);
    fibres.push({
      weight: 0.7,
      d: `M ${x(6)} ${Y.chin - 2} Q ${x(13)} ${Y.neck + 6} ${x(16)} ${Y.shoulder}`,
    });
    fibres.push({
      weight: 0.6,
      d: `M ${x(11)} ${Y.neck} Q ${x(shoulder * 0.55)} ${Y.neck + 8} ${x(shoulder - 10)} ${Y.shoulder + 2}`,
    });
  }
  return fibres;
}

/** The whole map, assembled. */
export function buildAnatomy(w: Widths): { bellies: Belly[]; fibres: Fibre[] } {
  const bellies: Belly[] = [];
  const fibres: Fibre[] = [];

  const abs = abdominals(w);
  bellies.push(...abs.bellies);
  fibres.push(...abs.fibres);
  fibres.push(...neckMuscles(w));

  for (const sign of [-1, 1] as Sign[]) {
    const delt = deltoid(w, sign);
    const pec = pectoral(w, sign);
    const obl = oblique(w, sign);
    const arm = armMuscles(w, sign);
    const leg = legMuscles(w, sign);

    bellies.push(delt.belly, pec.belly, obl.belly, ...arm.bellies, ...leg.bellies);
    fibres.push(
      ...delt.fibres,
      ...pec.fibres,
      ...obl.fibres,
      ...arm.fibres,
      ...leg.fibres,
      ...serratus(w, sign),
    );
  }

  return { bellies, fibres };
}
