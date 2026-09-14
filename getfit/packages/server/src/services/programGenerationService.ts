import {
  EXERCISE_BY_ID,
  MAX_WARMUP_SETS,
  MUSCLE_GROUPS,
  computeVolume,
  type CardioPrescription,
  type EquipmentId,
  type Exercise,
  type ExercisePreference,
  type GoalType,
  type MuscleGroup,
  type PrescribedSet,
  type ProgramDay,
  type ProgramExercise,
  type SessionDuration,
  type Sex,
  type TrainingDays,
  type TrainingLevel,
  type TrainingLocation,
  type VolumeSummary,
  type WorkoutProgram,
} from '@getfit/shared';
import { errors } from '../utils/errors';
import { ExerciseSelectionService, type SelectionContext } from './exerciseSelectionService';
import { selectCardio } from './cardioService';
import { estimateWorkoutSeconds, type TimedExerciseEstimate } from './sessionBudget';
import { estimateStartingWeight, type StartingWeightContext } from './startingWeight';
import { getSplit, type DayTemplate } from './splits';

export interface ProgramGenerationInput {
  profile: {
    age: number;
    sex: Sex;
    heightCm: number;
    weightKg: number;
    trainingLevel: TrainingLevel;
    trainingLocation: TrainingLocation;
    trainingDays: TrainingDays;
    sessionDurationMinutes: SessionDuration;
  };
  goals: GoalType[];
  equipment: EquipmentId[];
  exercisePreferences: ExercisePreference[];
  bodyMetrics: {
    bodyFatPercent: number;
    muscleMassKg: number;
  } | null;
  /** exerciseId → best recent working weight from real completed sets. */
  previousPerformance: Record<string, number>;
  version?: number;
}

/**
 * ProgramGenerationService
 *
 * Turns a profile, goals, equipment, preferences and real training history into
 * a complete weekly program. Every decision here is rule-driven and inspectable:
 * split choice, exercise selection, ordering, sets, reps, starting weight, rest,
 * warm-ups, cardio and — critically — fitting the finished session inside the
 * duration the user actually picked.
 */
export class ProgramGenerationService {
  constructor(private readonly selection = new ExerciseSelectionService()) {}

  generate(input: ProgramGenerationInput): WorkoutProgram {
    const { profile, goals, equipment } = input;
    const split = getSplit(profile.trainingDays);
    if (!split) throw errors.programGenerationFailed();

    const selectionContext: SelectionContext = {
      location: profile.trainingLocation,
      equipment,
      level: profile.trainingLevel,
      goals,
    };

    const weightContext: StartingWeightContext = {
      bodyWeightKg: profile.weightKg,
      sex: profile.sex,
      level: profile.trainingLevel,
      previousPerformance: input.previousPerformance,
    };

    // Weekly effective-set budget per muscle, so compound overlap does not
    // quietly push a muscle far past what it can recover from.
    const weeklyBudget = buildWeeklyBudget(goals, profile.trainingLevel, profile.trainingDays);
    const weeklyUsed: Record<string, number> = {};
    // Spread each muscle's allowance across the days that actually train it, so
    // day one cannot spend the whole week and starve day five.
    const pacing = buildPacing(split.days);

    const days: ProgramDay[] = [];

    for (let index = 0; index < split.days.length; index += 1) {
      const template = split.days[index];
      const day = this.buildDay({
        template,
        dayNumber: index + 1,
        input,
        selectionContext,
        weightContext,
        weeklyBudget,
        weeklyUsed,
        allowanceByDay: pacing[index],
      });
      days.push(day);
    }

    const volumeSummary = summariseWeeklyVolume(days);

    return {
      version: input.version ?? 1,
      splitName: split.name,
      trainingDays: profile.trainingDays,
      sessionDurationMinutes: profile.sessionDurationMinutes,
      days,
      volumeSummary,
    };
  }

  private buildDay(args: {
    template: DayTemplate;
    dayNumber: number;
    input: ProgramGenerationInput;
    selectionContext: SelectionContext;
    weightContext: StartingWeightContext;
    weeklyBudget: Record<string, number>;
    weeklyUsed: Record<string, number>;
    allowanceByDay: Record<string, number>;
  }): ProgramDay {
    const { template, dayNumber, input, selectionContext, weightContext, weeklyBudget, weeklyUsed, allowanceByDay } =
      args;
    const { profile, goals } = input;

    const budgetSeconds = profile.sessionDurationMinutes * 60;
    const bodyFat = input.bodyMetrics?.bodyFatPercent ?? defaultBodyFat(profile.sex);

    // Cardio is reserved first so it cannot be squeezed out by strength work.
    const reservedCardio = selectCardio({
      bodyFatPercent: bodyFat,
      goals,
      location: profile.trainingLocation,
      equipment: input.equipment,
      dayWeight: template.cardioWeight,
      availableSeconds: Math.floor(budgetSeconds * 0.3),
      bodyWeightKg: profile.weightKg,
      heightCm: profile.heightCm,
    });

    const strengthBudget = budgetSeconds - (reservedCardio ? reservedCardio.minutes * 60 + 60 : 0) - 90;

    const slots = buildSlots(template, profile.trainingLevel, profile.sessionDurationMinutes);
    const chosen: ChosenExercise[] = [];
    const usedExerciseIds = new Set<string>();
    const perMuscleCount: Record<string, number> = {};

    // Session time is the binding constraint, so the order slots are considered
    // in decides what actually gets trained. Work tier by tier, and within a
    // tier take the muscle furthest below its weekly target first — a fixed
    // order spends the whole session on the first few slots and starves the rest.
    const remaining = [...slots];

    while (remaining.length > 0) {
      remaining.sort(
        (a, b) =>
          a.tier - b.tier ||
          slotNeed(b, weeklyUsed, allowanceByDay) - slotNeed(a, weeklyUsed, allowanceByDay) ||
          b.priority - a.priority,
      );
      const slot = remaining.shift() as Slot;

      const { pool } = this.selection.resolvePool(slot.muscle, input.exercisePreferences, selectionContext);
      if (pool.length === 0) continue;

      const alreadyForMuscle = perMuscleCount[slot.muscle] ?? 0;
      if (alreadyForMuscle >= slot.maxPerSession) continue;

      const used = weeklyUsed[slot.muscle] ?? 0;
      // Pace against this day's share of the week rather than the whole week.
      const share = allowanceByDay[slot.muscle] ?? 1;
      if (used >= weeklyBudget[slot.muscle] * share) continue;

      const exercise = pickExercise(pool, usedExerciseIds, chosen, slot, dayNumber);
      if (!exercise) continue;

      const prescription = buildPrescription(exercise, {
        goals,
        level: profile.trainingLevel,
        sessionDuration: profile.sessionDurationMinutes,
        isFirstCompound: chosen.length === 0 && exercise.isCompound,
        compoundIndex: chosen.filter((c) => c.exercise.isCompound).length,
      });

      const candidate: ChosenExercise = {
        exercise,
        muscle: slot.muscle,
        priority: slot.priority,
        ...prescription,
        startingWeight: estimateStartingWeight(exercise, weightContext),
      };

      // Reject anything whose full charge — direct *and* secondary — would push
      // a muscle past what it can recover from in a week. Without this, six
      // pressing movements quietly bury the triceps and front delts.
      if (exceedsCeiling(weeklyUsed, exercise, candidate.sets)) continue;

      const projected = estimateWorkoutSeconds(
        [...chosen, candidate].map(toTimedEstimate),
        0,
      );

      // Always keep at least one exercise, even in a 15-minute session.
      if (projected > strengthBudget && chosen.length > 0) continue;

      chosen.push(candidate);
      usedExerciseIds.add(exercise.id);
      perMuscleCount[slot.muscle] = alreadyForMuscle + 1;
      applyVolume(weeklyUsed, exercise, candidate.sets);
    }

    // A day that booked nothing — every muscle already at its weekly ceiling —
    // would render as an empty workout. Take the day's lead movement anyway.
    if (chosen.length === 0) {
      const fallback = this.buildFallbackExercise({
        template,
        input,
        selectionContext,
        weightContext,
        profile,
        goals,
      });
      if (fallback) {
        chosen.push(fallback);
        applyVolume(weeklyUsed, fallback.exercise, fallback.sets);
      }
    }

    // Recompute cardio against the time actually left over.
    const usedSeconds = estimateWorkoutSeconds(chosen.map(toTimedEstimate), 0);
    const cardio: CardioPrescription | null =
      reservedCardio &&
      selectCardio({
        bodyFatPercent: bodyFat,
        goals,
        location: profile.trainingLocation,
        equipment: input.equipment,
        dayWeight: template.cardioWeight,
        availableSeconds: budgetSeconds - usedSeconds,
        bodyWeightKg: profile.weightKg,
        heightCm: profile.heightCm,
      });

    const ordered = orderExercises(chosen);
    const exercises: ProgramExercise[] = ordered.map((entry, index) => ({
      exerciseId: entry.exercise.id,
      orderIndex: index,
      sets: entry.sets,
      warmupSets: entry.warmupSets,
      repsMin: entry.repsMin,
      repsMax: entry.repsMax,
      startingWeight: entry.startingWeight,
      restSeconds: entry.restSeconds,
      prescribedSets: buildSets(entry),
    }));

    const totalSeconds = estimateWorkoutSeconds(ordered.map(toTimedEstimate), cardio?.minutes ?? 0);

    return {
      dayNumber,
      focus: template.focus,
      durationMinutes: Math.max(1, Math.round(totalSeconds / 60)),
      exercises,
      cardio,
    };
  }

  /** Last-resort pick for a day that the budget would otherwise leave empty. */
  private buildFallbackExercise(args: {
    template: DayTemplate;
    input: ProgramGenerationInput;
    selectionContext: SelectionContext;
    weightContext: StartingWeightContext;
    profile: ProgramGenerationInput['profile'];
    goals: GoalType[];
  }): ChosenExercise | null {
    const { template, input, selectionContext, weightContext, profile, goals } = args;

    for (const muscle of [...template.primary, ...template.secondary]) {
      const { pool } = this.selection.resolvePool(muscle, input.exercisePreferences, selectionContext);
      if (pool.length === 0) continue;

      const exercise = pool[0];
      const prescription = buildPrescription(exercise, {
        goals,
        level: profile.trainingLevel,
        sessionDuration: profile.sessionDurationMinutes,
        isFirstCompound: exercise.isCompound,
        compoundIndex: 0,
      });

      return {
        exercise,
        muscle,
        priority: 100,
        ...prescription,
        startingWeight: estimateStartingWeight(exercise, weightContext),
      };
    }

    return null;
  }
}

/**
 * Each muscle's weekly allowance, spread across the days that actually train
 * it. After day N of the K days that touch a muscle, at most N/K of its weekly
 * budget may have been spent — so a four-day split still trains chest twice.
 */
function buildPacing(days: DayTemplate[]): Array<Record<string, number>> {
  const touchDays = new Map<string, number[]>();

  days.forEach((template, index) => {
    for (const muscle of new Set([...template.primary, ...template.secondary])) {
      const list = touchDays.get(muscle) ?? [];
      list.push(index);
      touchDays.set(muscle, list);
    }
  });

  return days.map((_, dayIndex) => {
    const fractions: Record<string, number> = {};
    for (const [muscle, indices] of touchDays) {
      const soFar = indices.filter((i) => i <= dayIndex).length;
      fractions[muscle] = soFar / indices.length;
    }
    return fractions;
  });
}

/* ------------------------------------------------------------------ */
/* Slot planning                                                       */
/* ------------------------------------------------------------------ */

interface Slot {
  muscle: MuscleGroup;
  priority: number;
  maxPerSession: number;
  /** Second pass slots ask for an isolation movement to complement the first. */
  preferIsolation: boolean;
  /**
   * Breadth-first wave. Every slot in an earlier tier is offered the session's
   * remaining time before any slot in a later one, so a muscle cannot take a
   * second exercise while another muscle on the same day still has none.
   */
  tier: number;
}

/**
 * Breadth before depth: every muscle in the day gets one exercise before any
 * muscle gets a second. Whatever does not fit the session budget simply never
 * gets added.
 */
function buildSlots(template: DayTemplate, level: TrainingLevel, duration: SessionDuration): Slot[] {
  const slots: Slot[] = [];
  const maxPerSession = duration <= 30 ? 1 : 2;

  template.primary.forEach((muscle, index) => {
    slots.push({ muscle, priority: 100 - index, maxPerSession, preferIsolation: false, tier: 0 });
  });
  template.secondary.forEach((muscle, index) => {
    slots.push({ muscle, priority: 60 - index, maxPerSession: 1, preferIsolation: true, tier: 1 });
  });

  if (maxPerSession > 1) {
    template.primary.forEach((muscle, index) => {
      slots.push({ muscle, priority: 40 - index, maxPerSession, preferIsolation: true, tier: 2 });
    });
  }

  // Advanced lifters can handle a third pass on the day's lead muscle.
  if (level === 'advanced' && duration >= 60 && template.primary.length > 0) {
    slots.push({
      muscle: template.primary[0],
      priority: 10,
      maxPerSession: 3,
      preferIsolation: true,
      tier: 3,
    });
  }

  return slots;
}

function pickExercise(
  pool: Exercise[],
  usedExerciseIds: Set<string>,
  chosen: ChosenExercise[],
  slot: Slot,
  dayNumber: number,
): Exercise | null {
  const candidates = pool.filter((e) => !usedExerciseIds.has(e.id));
  if (candidates.length === 0) return null;

  const scored = candidates.map((exercise) => {
    let score = 0;
    if (slot.preferIsolation) score += exercise.isCompound ? 0 : 18;
    else score += exercise.isCompound ? 18 : 0;

    // Avoid stacking a second exercise that duplicates the first's pattern.
    const samePattern = chosen.some(
      (c) => c.muscle === slot.muscle && c.exercise.category === exercise.category,
    );
    if (samePattern) score -= 14;

    return { exercise, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Rotate the lead choice across repeated days of the same focus so a
  // Push/Pull/Legs week is not literally the same session twice.
  const top = scored.filter((s) => s.score === scored[0].score).map((s) => s.exercise);
  if (top.length > 1) {
    return top[(dayNumber - 1) % top.length];
  }
  return scored[0].exercise;
}

/* ------------------------------------------------------------------ */
/* Prescription                                                        */
/* ------------------------------------------------------------------ */

interface Prescription {
  sets: number;
  warmupSets: number;
  repsMin: number;
  repsMax: number;
  restSeconds: number;
}

interface ChosenExercise extends Prescription {
  exercise: Exercise;
  muscle: MuscleGroup;
  priority: number;
  startingWeight: number | null;
}

export function buildPrescription(
  exercise: Exercise,
  context: {
    goals: GoalType[];
    level: TrainingLevel;
    sessionDuration: SessionDuration;
    isFirstCompound: boolean;
    compoundIndex: number;
  },
): Prescription {
  const { goals, level, sessionDuration } = context;

  let sets = level === 'advanced' ? 4 : 3;
  if (!exercise.isCompound && level !== 'advanced') sets = 3;
  if (sessionDuration <= 15) sets = 2;
  else if (sessionDuration <= 30 && !exercise.isCompound) sets = 2;
  if (goals.includes('strength') && exercise.isCompound) sets = Math.min(5, sets + 1);

  let repsMin: number;
  let repsMax: number;

  if (exercise.isTimed) {
    repsMin = exercise.repRangeMin;
    repsMax = exercise.repRangeMax;
  } else if (exercise.isCompound) {
    // Default compound band is 6–10, adjusted by goal.
    repsMin = 6;
    repsMax = 10;
    if (goals.includes('strength')) {
      repsMin = 4;
      repsMax = 6;
    } else if (goals.includes('fat_loss') || goals.includes('general_fitness')) {
      repsMin = 8;
      repsMax = 12;
    }
    if (exercise.isBodyweight) {
      // Bodyweight movements cannot be loaded, so reps carry the progression.
      repsMin = Math.max(repsMin, exercise.repRangeMin);
      repsMax = Math.max(repsMax, exercise.repRangeMax);
    }
  } else {
    // Default isolation band is 10–15.
    repsMin = 10;
    repsMax = 15;
    if (goals.includes('strength')) {
      repsMin = 8;
      repsMax = 12;
    } else if (goals.includes('fat_loss')) {
      repsMin = 12;
      repsMax = 15;
    }
    if (exercise.isBodyweight) {
      repsMin = Math.max(repsMin, exercise.repRangeMin);
      repsMax = Math.max(repsMax, exercise.repRangeMax);
    }
  }

  let restSeconds = exercise.restSeconds;
  if (goals.includes('strength') && exercise.isCompound) restSeconds = Math.min(210, restSeconds + 30);
  // Short sessions trade rest for exercise variety — at 15 minutes a 150-second
  // rest would leave room for a single movement.
  if (sessionDuration <= 15) restSeconds = Math.max(40, Math.round(restSeconds * 0.45));
  else if (sessionDuration <= 30) restSeconds = Math.max(45, Math.round(restSeconds * 0.7));

  // Warm-ups only on the first loaded compounds, and never more than two.
  let warmupSets = 0;
  if (exercise.isCompound && !exercise.isBodyweight && !exercise.isTimed && sessionDuration > 15) {
    if (context.compoundIndex === 0) warmupSets = MAX_WARMUP_SETS;
    else if (context.compoundIndex === 1) warmupSets = 1;
  }

  return { sets, warmupSets, repsMin, repsMax, restSeconds };
}

function buildSets(entry: ChosenExercise): PrescribedSet[] {
  const sets: PrescribedSet[] = [];
  let setNumber = 1;

  for (let i = 0; i < entry.warmupSets; i += 1) {
    // Ramp: 50% then 70% of the working weight.
    const fraction = entry.warmupSets === 1 ? 0.6 : 0.5 + i * 0.2;
    sets.push({
      setNumber,
      prescribedWeight:
        entry.startingWeight === null ? null : roundHalf(entry.startingWeight * fraction),
      prescribedRepsMin: Math.max(3, Math.round(entry.repsMin * 0.7)),
      prescribedRepsMax: Math.max(5, Math.round(entry.repsMax * 0.7)),
      restSeconds: 45,
      isWarmup: true,
    });
    setNumber += 1;
  }

  for (let i = 0; i < entry.sets; i += 1) {
    sets.push({
      setNumber,
      prescribedWeight: entry.startingWeight,
      prescribedRepsMin: entry.repsMin,
      prescribedRepsMax: entry.repsMax,
      restSeconds: entry.restSeconds,
      isWarmup: false,
    });
    setNumber += 1;
  }

  return sets;
}

/** Compounds lead, heaviest first; isolation and core close the session. */
function orderExercises(chosen: ChosenExercise[]): ChosenExercise[] {
  return [...chosen].sort((a, b) => {
    if (a.exercise.isCompound !== b.exercise.isCompound) return a.exercise.isCompound ? -1 : 1;
    if (a.muscle === 'abs' !== (b.muscle === 'abs')) return a.muscle === 'abs' ? 1 : -1;
    return b.priority - a.priority;
  });
}

function toTimedEstimate(entry: ChosenExercise): TimedExerciseEstimate {
  return {
    exercise: entry.exercise,
    sets: entry.sets,
    warmupSets: entry.warmupSets,
    repsMin: entry.repsMin,
    repsMax: entry.repsMax,
    restSeconds: entry.restSeconds,
  };
}

/* ------------------------------------------------------------------ */
/* Weekly volume budgeting                                             */
/* ------------------------------------------------------------------ */

function buildWeeklyBudget(
  goals: GoalType[],
  level: TrainingLevel,
  trainingDays: TrainingDays,
): Record<string, number> {
  const budget: Record<string, number> = {};

  for (const group of MUSCLE_GROUPS) {
    let max = group.weeklySetsMax;
    if (level === 'beginner') max = Math.round(max * 0.65);
    else if (level === 'intermediate') max = Math.round(max * 0.85);

    // Fewer training days means less weekly volume is achievable anyway.
    max = Math.round(max * Math.min(1, 0.45 + trainingDays * 0.11));

    if (goals.includes('muscle_gain') || goals.includes('recomposition')) max = Math.round(max * 1.1);
    if (goals.includes('strength') && !group.isMajor) max = Math.round(max * 0.8);

    budget[group.id] = Math.max(group.weeklySetsMin * 0.5, max);
  }

  return budget;
}

/** Weekly effective-set floor per muscle — the minimum worth programming. */
const WEEKLY_FLOOR: Record<string, number> = Object.fromEntries(
  MUSCLE_GROUPS.map((group) => [group.id, group.weeklySetsMin]),
);

/**
 * How badly a muscle needs this slot: its shortfall against the share of the
 * weekly minimum it should have reached by now. Negative once it is on track.
 */
function slotNeed(
  slot: Slot,
  used: Record<string, number>,
  allowanceByDay: Record<string, number>,
): number {
  const floor = WEEKLY_FLOOR[slot.muscle] ?? 0;
  const target = floor * (allowanceByDay[slot.muscle] ?? 1);
  return target - (used[slot.muscle] ?? 0);
}

/** Weekly effective-set ceiling per muscle — the recovery limit, not a target. */
const WEEKLY_CEILING: Record<string, number> = Object.fromEntries(
  MUSCLE_GROUPS.map((group) => [group.id, group.weeklySetsMax]),
);

/**
 * Assisting muscles get headroom above their ceiling. Holding them to the same
 * limit as the muscle actually being trained lets one saturated helper — a
 * forearm at 9 of 10 sets — veto an entire back day.
 */
const SECONDARY_CEILING_TOLERANCE = 1.25;

/**
 * True when booking this exercise would carry the muscle it trains past its
 * weekly ceiling, or bury an assisting muscle well beyond its own.
 */
function exceedsCeiling(used: Record<string, number>, exercise: Exercise, sets: number): boolean {
  const volume = computeVolume([{ exerciseId: exercise.id, workingSets: sets }]);
  for (const [muscle, entry] of Object.entries(volume)) {
    if (entry.effectiveSets <= 0) continue;
    const ceiling = WEEKLY_CEILING[muscle];
    if (ceiling === undefined) continue;
    const limit = entry.directSets > 0 ? ceiling : ceiling * SECONDARY_CEILING_TOLERANCE;
    if ((used[muscle] ?? 0) + entry.effectiveSets > limit) return true;
  }
  return false;
}

/**
 * Books both the direct sets and the secondary contribution of a compound, so
 * three pressing exercises in a week are correctly charged to the triceps and
 * front delts as well as the chest.
 */
function applyVolume(used: Record<string, number>, exercise: Exercise, sets: number): void {
  const volume = computeVolume([{ exerciseId: exercise.id, workingSets: sets }]);
  for (const [muscle, entry] of Object.entries(volume)) {
    if (entry.effectiveSets <= 0) continue;
    used[muscle] = (used[muscle] ?? 0) + entry.effectiveSets;
  }
}

export function summariseWeeklyVolume(days: ProgramDay[]): VolumeSummary {
  const contributions = days.flatMap((day) =>
    day.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      workingSets: exercise.sets,
    })),
  );
  return computeVolume(contributions);
}

function defaultBodyFat(sex: Sex): number {
  return sex === 'male' ? 20 : 28;
}

function roundHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

export function hydrateProgram(program: WorkoutProgram): WorkoutProgram {
  return {
    ...program,
    days: program.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => ({
        ...exercise,
        exercise: EXERCISE_BY_ID[exercise.exerciseId],
      })),
    })),
  };
}
