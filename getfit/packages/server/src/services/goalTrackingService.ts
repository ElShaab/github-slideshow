import {
  EXERCISE_BY_ID,
  GOAL_LABELS,
  type BodyAssessment,
  type GoalProgress,
  type GoalType,
  type PersonalRecord,
  type UserGoal,
} from '@getfit/shared';

export interface GoalTrackingInput {
  goals: UserGoal[];
  firstAssessment: BodyAssessment | null;
  latestAssessment: BodyAssessment | null;
  personalRecords: PersonalRecord[];
  workoutsCompleted: number;
  workoutsScheduled: number;
}

/**
 * GoalTrackingService
 *
 * Turns the user's chosen goals into measurable progress cards. Targets are
 * derived from where the user actually started; no invented completion dates
 * are ever produced.
 */
export class GoalTrackingService {
  track(input: GoalTrackingInput): GoalProgress[] {
    return input.goals
      .filter((goal) => goal.isActive !== false)
      .map((goal) => this.trackGoal(goal, input));
  }

  private trackGoal(goal: UserGoal, input: GoalTrackingInput): GoalProgress {
    switch (goal.goalType) {
      case 'fat_loss':
        return this.bodyFatGoal(goal, input);
      case 'muscle_gain':
        return this.muscleGoal(goal, input);
      case 'recomposition':
        return this.recompositionGoal(goal, input);
      case 'strength':
        return this.strengthGoal(goal, input);
      case 'general_fitness':
      default:
        return this.consistencyGoal(goal, input);
    }
  }

  private bodyFatGoal(goal: UserGoal, input: GoalTrackingInput): GoalProgress {
    const start = goal.startValue ?? input.firstAssessment?.bodyFatPercent ?? null;
    const current = input.latestAssessment?.bodyFatPercent ?? start;
    // A sensible default target: a meaningful but achievable reduction from the
    // starting point, floored at a healthy minimum.
    const target = goal.targetValue ?? (start !== null ? Math.max(start - 6, healthyFloor(input)) : null);

    return {
      goalType: 'fat_loss',
      label: GOAL_LABELS.fat_loss,
      startValue: round1(start),
      currentValue: round1(current),
      targetValue: round1(target),
      unit: '%',
      progressPercent: descendingProgress(start, current, target),
      detail:
        start !== null && current !== null
          ? `${start.toFixed(1)}% → ${current.toFixed(1)}%`
          : 'Complete your first assessment to start tracking.',
    };
  }

  private muscleGoal(goal: UserGoal, input: GoalTrackingInput): GoalProgress {
    const start = goal.startValue ?? input.firstAssessment?.estimatedMuscleMassKg ?? null;
    const current = input.latestAssessment?.estimatedMuscleMassKg ?? start;
    const target = goal.targetValue ?? (start !== null ? round1(start + 3) : null);

    return {
      goalType: 'muscle_gain',
      label: GOAL_LABELS.muscle_gain,
      startValue: round1(start),
      currentValue: round1(current),
      targetValue: target,
      unit: 'kg',
      progressPercent: ascendingProgress(start, current, target),
      detail:
        start !== null && current !== null
          ? `${start.toFixed(1)} kg → ${current.toFixed(1)} kg`
          : 'Complete your first assessment to start tracking.',
    };
  }

  private recompositionGoal(goal: UserGoal, input: GoalTrackingInput): GoalProgress {
    const first = input.firstAssessment;
    const latest = input.latestAssessment;
    if (!first || !latest) {
      return emptyGoal('recomposition', 'Complete your first assessment to start tracking.');
    }

    const fatLost = first.bodyFatPercent - latest.bodyFatPercent;
    const muscleGained = latest.estimatedMuscleMassKg - first.estimatedMuscleMassKg;
    // Recomposition is measured on both axes at once.
    const fatProgress = clampPercent((fatLost / 6) * 100);
    const muscleProgress = clampPercent((muscleGained / 3) * 100);

    return {
      goalType: 'recomposition',
      label: GOAL_LABELS.recomposition,
      startValue: round1(first.bodyFatPercent),
      currentValue: round1(latest.bodyFatPercent),
      targetValue: goal.targetValue ?? round1(Math.max(first.bodyFatPercent - 6, healthyFloor(input))),
      unit: '%',
      progressPercent: Math.round((fatProgress + muscleProgress) / 2),
      detail: `${fatLost >= 0 ? '−' : '+'}${Math.abs(fatLost).toFixed(1)}% body fat · ${
        muscleGained >= 0 ? '+' : '−'
      }${Math.abs(muscleGained).toFixed(1)} kg muscle`,
    };
  }

  private strengthGoal(goal: UserGoal, input: GoalTrackingInput): GoalProgress {
    const tracked = goal.targetExerciseId ?? this.pickStrengthAnchor(input.personalRecords);
    if (!tracked) {
      return emptyGoal('strength', 'Complete a workout to start tracking your lifts.');
    }

    const exercise = EXERCISE_BY_ID[tracked];
    const records = input.personalRecords
      .filter((r) => r.exerciseId === tracked && r.recordType === 'weight')
      .sort((a, b) => a.achievedAt.localeCompare(b.achievedAt));

    const start = goal.startValue ?? records[0]?.previousValue ?? records[0]?.value ?? null;
    const current = records[records.length - 1]?.value ?? start;
    const target = goal.targetValue ?? (start !== null ? roundTo2point5(start * 1.2) : null);

    return {
      goalType: 'strength',
      label: GOAL_LABELS.strength,
      startValue: round1(start),
      currentValue: round1(current),
      targetValue: target,
      unit: 'kg',
      progressPercent: ascendingProgress(start, current, target),
      exerciseName: exercise?.name,
      detail:
        start !== null && current !== null
          ? `${exercise?.name ?? 'Main lift'}  ${start} kg → ${current} kg`
          : 'Complete a workout to start tracking your lifts.',
    };
  }

  private consistencyGoal(_goal: UserGoal, input: GoalTrackingInput): GoalProgress {
    const scheduled = Math.max(1, input.workoutsScheduled);
    const rate = clampPercent((input.workoutsCompleted / scheduled) * 100);

    return {
      goalType: 'general_fitness',
      label: GOAL_LABELS.general_fitness,
      startValue: 0,
      currentValue: input.workoutsCompleted,
      targetValue: input.workoutsScheduled,
      unit: 'workouts',
      progressPercent: Math.round(rate),
      detail: `${input.workoutsCompleted} of ${input.workoutsScheduled} scheduled workouts completed`,
    };
  }

  /** The heaviest compound the user has a record on is the best strength anchor. */
  private pickStrengthAnchor(records: PersonalRecord[]): string | null {
    const compoundRecords = records.filter((r) => {
      const exercise = EXERCISE_BY_ID[r.exerciseId];
      return exercise?.isCompound && r.recordType === 'weight';
    });
    if (compoundRecords.length === 0) return records[0]?.exerciseId ?? null;
    return compoundRecords.sort((a, b) => b.value - a.value)[0].exerciseId;
  }
}

function healthyFloor(input: GoalTrackingInput): number {
  const sex = input.latestAssessment?.hologramData.sex ?? input.firstAssessment?.hologramData.sex;
  return sex === 'female' ? 20 : 12;
}

function descendingProgress(start: number | null, current: number | null, target: number | null): number {
  if (start === null || current === null || target === null || start === target) return 0;
  return clampPercent(((start - current) / (start - target)) * 100);
}

function ascendingProgress(start: number | null, current: number | null, target: number | null): number {
  if (start === null || current === null || target === null || target === start) return 0;
  return clampPercent(((current - start) / (target - start)) * 100);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

function roundTo2point5(value: number): number {
  return Math.round(value / 2.5) * 2.5;
}

function emptyGoal(goalType: GoalType, detail: string): GoalProgress {
  return {
    goalType,
    label: GOAL_LABELS[goalType],
    startValue: null,
    currentValue: null,
    targetValue: null,
    unit: '',
    progressPercent: 0,
    detail,
  };
}
