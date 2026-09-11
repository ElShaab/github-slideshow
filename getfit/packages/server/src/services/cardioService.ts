import {
  CARDIO_BY_ID,
  CARDIO_EXERCISES,
  MAX_CARDIO_MINUTES,
  type CardioExercise,
  type CardioPrescription,
  type EquipmentId,
  type GoalType,
  type TrainingLocation,
} from '@getfit/shared';

/**
 * Cardio is prescribed like any other exercise: the AI chooses the type from
 * available equipment and the duration from current body fat, and the duration
 * falls automatically as body fat improves. It is capped at 15 minutes for
 * everyone, always.
 */

/** Piecewise ladder anchored on the product spec's reference points. */
const CARDIO_LADDER: Array<{ bodyFat: number; minutes: number }> = [
  { bodyFat: 12, minutes: 0 },
  { bodyFat: 18, minutes: 5 },
  { bodyFat: 21, minutes: 8 },
  { bodyFat: 24, minutes: 12 },
  { bodyFat: 27, minutes: 15 },
];

/**
 * Body fat alone sets the duration. A goal bonus used to be added on top, but
 * it pushed the fat-loss case into the 15-minute cap: dropping from 27% to 24%
 * body fat produced no change at all, so the one group watching this number
 * most closely saw no reward for the progress they had made.
 */
export function baseCardioMinutes(bodyFatPercent: number, goals: GoalType[]): number {
  let minutes = interpolateLadder(bodyFatPercent);

  // Someone training purely for strength with low body fat does not need it.
  if (minutes < 3 && !goals.includes('fat_loss') && !goals.includes('general_fitness')) {
    minutes = 0;
  }

  return clampMinutes(minutes);
}

function interpolateLadder(bodyFatPercent: number): number {
  const first = CARDIO_LADDER[0];
  const last = CARDIO_LADDER[CARDIO_LADDER.length - 1];
  if (bodyFatPercent <= first.bodyFat) return 0;
  if (bodyFatPercent >= last.bodyFat) return last.minutes;

  for (let i = 1; i < CARDIO_LADDER.length; i += 1) {
    const lower = CARDIO_LADDER[i - 1];
    const upper = CARDIO_LADDER[i];
    if (bodyFatPercent <= upper.bodyFat) {
      const t = (bodyFatPercent - lower.bodyFat) / (upper.bodyFat - lower.bodyFat);
      return lower.minutes + t * (upper.minutes - lower.minutes);
    }
  }
  return last.minutes;
}

export function clampMinutes(minutes: number): number {
  return Math.max(0, Math.min(MAX_CARDIO_MINUTES, Math.round(minutes)));
}

export interface CardioSelectionContext {
  bodyFatPercent: number;
  goals: GoalType[];
  location: TrainingLocation;
  equipment: EquipmentId[];
  /** 0 = no cardio for this day, 1 = normal, >1 = conditioning-focused day. */
  dayWeight: number;
  /** Remaining session seconds after strength work; cardio is trimmed to fit. */
  availableSeconds: number;
  /** Higher body weight biases the AI toward low-impact options. */
  bodyWeightKg: number;
  heightCm: number;
}

export function selectCardio(context: CardioSelectionContext): CardioPrescription | null {
  const base = baseCardioMinutes(context.bodyFatPercent, context.goals);
  if (base <= 0 || context.dayWeight <= 0) return null;

  const target = clampMinutes(base * context.dayWeight);
  const affordable = Math.floor(Math.max(0, context.availableSeconds - 60) / 60);
  const minutes = clampMinutes(Math.min(target, affordable));
  if (minutes < 3) return null;

  const exercise = chooseCardioExercise(context);
  if (!exercise) return null;

  return { type: exercise.name, minutes, exerciseId: exercise.id };
}

function chooseCardioExercise(context: CardioSelectionContext): CardioExercise | null {
  const owned = new Set<EquipmentId>([...context.equipment, 'bodyweight']);
  const bmi = context.bodyWeightKg / Math.pow(context.heightCm / 100, 2);

  const candidates = CARDIO_EXERCISES.filter((cardio) => {
    if (cardio.availability !== 'both' && cardio.availability !== context.location) return false;
    return cardio.equipment.every((item) => owned.has(item));
  });

  if (candidates.length === 0) return CARDIO_BY_ID.cardio_walking ?? null;

  const scored = candidates.map((cardio) => {
    let score = 0;
    // Incline walking is the default choice: high output, very low joint cost.
    if (cardio.id === 'cardio_incline_walk') score += 20;
    if (cardio.id === 'cardio_walking') score += 8;
    if (cardio.impact === 'low') score += 10;
    if (cardio.impact === 'high') score -= bmi >= 28 ? 25 : 4;
    if (context.goals.includes('fat_loss') && cardio.impact === 'low') score += 6;
    // On a conditioning-weighted day a more demanding modality is appropriate.
    if (context.dayWeight > 1.3 && cardio.impact !== 'low') score += 8;
    return { cardio, score };
  });

  scored.sort((a, b) => b.score - a.score || a.cardio.name.localeCompare(b.cardio.name));
  return scored[0].cardio;
}
