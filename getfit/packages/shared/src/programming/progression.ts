import { roundToIncrement } from '../format';
import type { Exercise, ExercisePerformance, ProgressionDecision, TrainingLocation } from '../types';
import { incrementFor } from './startingWeight';

export interface ProgressionInput {
  exercise: Exercise;
  location: TrainingLocation;
  /** The most recent completed session for this exercise, if any. */
  lastPerformance: ExercisePerformance | null;
  /** The program's baseline working-set count for this exercise. */
  baseSets: number;
  repsMin: number;
  repsMax: number;
}

/**
 * ProgressionService
 *
 * Decides the next prescription from what the user actually lifted. It never
 * asks for RPE, mood or readiness — only weight, reps and sets are used.
 *
 * Home training follows the alternating sets-then-weight ladder:
 *   60 kg x3  →  60 kg x4  →  62.5 kg x3  →  62.5 kg x4  → …
 *
 * Gym training auto-regulates weight, sets and reps from performance. In both
 * modes the load only moves up when the reps justify it.
 */
export class ProgressionService {
  decide(input: ProgressionInput): ProgressionDecision {
    const { exercise, lastPerformance, baseSets, repsMin, repsMax } = input;

    if (!lastPerformance) {
      return {
        exerciseId: exercise.id,
        nextWeight: null,
        nextSets: baseSets,
        nextRepsMin: repsMin,
        nextRepsMax: repsMax,
        action: 'initial',
        reason: 'First time performing this exercise.',
      };
    }

    const workingSets = lastPerformance.sets.filter((s) => !s.isWarmup && s.reps !== null);
    if (workingSets.length === 0) {
      return {
        exerciseId: exercise.id,
        nextWeight: lastPerformance.prescribedWeight,
        nextSets: baseSets,
        nextRepsMin: repsMin,
        nextRepsMax: repsMax,
        action: 'hold',
        reason: 'No working sets were logged last time.',
      };
    }

    // The weight that was actually used drives the next prescription — the user
    // may have changed it during the workout, and reality wins.
    const workedWeight = medianWeight(workingSets);
    const completedSets = workingSets.length;
    const targetMax = lastPerformance.prescribedRepsMax || repsMax;
    const targetMin = lastPerformance.prescribedRepsMin || repsMin;

    const hitTop = workingSets.filter((s) => (s.reps ?? 0) >= targetMax).length;
    const belowMin = workingSets.filter((s) => (s.reps ?? 0) < targetMin).length;
    const allHitTop = hitTop === completedSets;
    const allAtLeastMin = belowMin === 0;

    // Two or more sets under the bottom of the range means the load is too heavy.
    if (belowMin >= 2) {
      return this.backOff(input, workedWeight, completedSets, belowMin);
    }

    if (allHitTop && completedSets >= baseSets) {
      return this.progress(input, workedWeight, completedSets);
    }

    if (allAtLeastMin) {
      return {
        exerciseId: exercise.id,
        nextWeight: workedWeight,
        nextSets: Math.max(baseSets, completedSets),
        nextRepsMin: repsMin,
        nextRepsMax: repsMax,
        action: 'increase_reps',
        reason: `Every set landed in the ${targetMin}–${targetMax} range. Add reps before adding load.`,
      };
    }

    return {
      exerciseId: exercise.id,
      nextWeight: workedWeight,
      nextSets: Math.max(baseSets, completedSets),
      nextRepsMin: repsMin,
      nextRepsMax: repsMax,
      action: 'hold',
      reason: 'Repeat this weight until every set is inside the target range.',
    };
  }

  /** The user earned an increase. How it is taken depends on where they train. */
  private progress(
    input: ProgressionInput,
    workedWeight: number | null,
    completedSets: number,
  ): ProgressionDecision {
    const { exercise, location, baseSets, repsMin, repsMax } = input;

    // Bodyweight and timed work cannot be loaded, so reps and sets carry it.
    if (workedWeight === null || workedWeight <= 0 || exercise.isBodyweight || exercise.isTimed) {
      const step = exercise.isTimed ? 5 : 2;
      return {
        exerciseId: exercise.id,
        nextWeight: workedWeight,
        nextSets: completedSets >= baseSets + 1 ? baseSets : completedSets + 1,
        nextRepsMin: completedSets >= baseSets + 1 ? repsMin + step : repsMin,
        nextRepsMax: completedSets >= baseSets + 1 ? repsMax + step : repsMax,
        action: completedSets >= baseSets + 1 ? 'increase_reps' : 'increase_sets',
        reason: 'Top of the range hit on every set — this movement progresses with reps and sets.',
      };
    }

    const increment = incrementFor(exercise);

    if (location === 'home') {
      // Alternating ladder: add a set first, then add weight and reset sets.
      if (completedSets < baseSets + 1) {
        return {
          exerciseId: exercise.id,
          nextWeight: workedWeight,
          nextSets: completedSets + 1,
          nextRepsMin: repsMin,
          nextRepsMax: repsMax,
          action: 'increase_sets',
          reason: 'All sets completed at the top of the range — add a set at the same weight.',
        };
      }
      return {
        exerciseId: exercise.id,
        nextWeight: roundToIncrement(workedWeight + increment, increment),
        nextSets: baseSets,
        nextRepsMin: repsMin,
        nextRepsMax: repsMax,
        action: 'increase_weight',
        reason: `Extra set completed — move up to ${roundToIncrement(workedWeight + increment, increment)} kg and reset to ${baseSets} sets.`,
      };
    }

    // Gym: heavier compounds take proportionally smaller jumps.
    const jump = exercise.isCompound && workedWeight >= 60 ? increment * 2 : increment;
    const nextWeight = roundToIncrement(workedWeight + jump, increment);

    return {
      exerciseId: exercise.id,
      nextWeight,
      nextSets: Math.max(baseSets, Math.min(completedSets, baseSets + 1)),
      nextRepsMin: repsMin,
      nextRepsMax: repsMax,
      action: 'increase_weight',
      reason: `Every set hit the top of the range — move up to ${nextWeight} kg.`,
    };
  }

  private backOff(
    input: ProgressionInput,
    workedWeight: number | null,
    completedSets: number,
    belowMin: number,
  ): ProgressionDecision {
    const { exercise, baseSets, repsMin, repsMax } = input;

    if (workedWeight === null || workedWeight <= 0) {
      return {
        exerciseId: exercise.id,
        nextWeight: workedWeight,
        nextSets: Math.max(2, Math.min(baseSets, completedSets)),
        nextRepsMin: repsMin,
        nextRepsMax: repsMax,
        action: 'hold',
        reason: 'Reps fell short — repeat this session before adding volume.',
      };
    }

    const increment = incrementFor(exercise);
    const reduced = Math.max(increment, roundToIncrement(workedWeight * 0.9, increment));

    return {
      exerciseId: exercise.id,
      nextWeight: reduced,
      nextSets: baseSets,
      nextRepsMin: repsMin,
      nextRepsMax: repsMax,
      action: 'reduce_weight',
      reason: `${belowMin} sets finished below ${repsMin} reps — drop to ${reduced} kg and rebuild.`,
    };
  }
}

/**
 * The representative load for a session. Median rather than max, so one heavy
 * first set followed by two lighter ones does not inflate the next prescription.
 */
function medianWeight(sets: Array<{ weight: number | null }>): number | null {
  const weights = sets
    .map((s) => s.weight)
    .filter((w): w is number => w !== null && w > 0)
    .sort((a, b) => a - b);
  if (weights.length === 0) return null;
  const mid = Math.floor(weights.length / 2);
  return weights.length % 2 === 0 ? (weights[mid - 1] + weights[mid]) / 2 : weights[mid];
}
