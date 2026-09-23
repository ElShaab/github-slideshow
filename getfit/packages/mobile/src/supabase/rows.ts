import type {
  AppSettings,
  BodyAssessment,
  BodyMeasurements,
  CompletedExercise,
  CompletedWorkout,
  EquipmentId,
  ExercisePreference,
  GoalType,
  MuscleGroup,
  PersonalRecord,
  ProgramDay,
  ScheduleStatus,
  ScheduledWorkout,
  Sex,
  TrainingDays,
  TrainingLevel,
  TrainingLocation,
  SessionDuration,
  UserGoal,
  UserProfile,
  WorkoutProgram,
} from '@getfit/shared';
import type {
  AssessmentsDocument,
  ProfileDocument,
  ProgramDocument,
  WorkoutsDocument,
} from '../local/documents';

/**
 * The translation between the four on-device documents and the rows in
 * Supabase.
 *
 * Deliberately pure and free of any React Native import: this is where a sync
 * bug would silently rewrite somebody's training history, so it is the part
 * that has to be testable off-device, and it is.
 *
 * Two shapes meet here. The device thinks in documents it reads and writes
 * whole; Postgres thinks in rows. Where the data is genuinely row-shaped — a
 * goal, a logged workout, an assessment — it becomes a row with real columns
 * and real constraints. Where it is a nested tree the app only ever reads
 * whole — the day-by-day programme, the sets inside a workout — it stays a
 * document in a jsonb column. Normalising those would buy queries nobody runs
 * and cost a join nobody wants.
 */

/* ------------------------------ row shapes ----------------------------- */

export interface ProfileRow {
  user_id: string;
  local_user_id: string | null;
  age: number | null;
  sex: Sex | null;
  height_cm: number | null;
  weight_kg: number | null;
  training_level: TrainingLevel | null;
  training_location: TrainingLocation | null;
  training_days: number | null;
  session_duration_minutes: number | null;
  onboarding_completed: boolean;
  preferences_chosen: boolean;
  theme_mode: AppSettings['themeMode'];
  reduced_motion: boolean;
  units: AppSettings['units'];
  profile_created_at: string | null;
}

export interface GoalRow {
  user_id: string;
  id: string;
  goal_type: GoalType;
  target_value: number | null;
  target_unit: string | null;
  target_exercise_id: string | null;
  start_value: number | null;
  is_active: boolean;
  goal_created_at: string | null;
}

export interface EquipmentRow {
  user_id: string;
  equipment_id: string;
}

export interface PreferenceRow {
  user_id: string;
  muscle_group: string;
  exercise_ids: string[];
  auto_generated: boolean;
}

export interface ProgramRow {
  user_id: string;
  id: string;
  version: number;
  split_name: string;
  training_days: number;
  session_duration_minutes: number;
  is_active: boolean;
  generated_at: string | null;
  days: ProgramDay[];
  volume_summary: WorkoutProgram['volumeSummary'];
}

export interface ScheduledWorkoutRow {
  user_id: string;
  id: string;
  program_day_id: string;
  day_number: number;
  focus: string;
  scheduled_date: string;
  status: ScheduleStatus;
  duration_minutes: number;
  completed_workout_id: string | null;
}

export interface CompletedWorkoutRow {
  user_id: string;
  id: string;
  program_day_id: string | null;
  day_number: number;
  focus: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
  total_sets: number;
  total_volume_kg: number;
  cardio_minutes: number;
  exercises: CompletedExercise[];
  /** Records set during this workout, kept with it so the log stays whole. */
  personal_records: PersonalRecord[];
}

export interface PersonalRecordRow {
  user_id: string;
  id: string;
  exercise_id: string;
  record_type: PersonalRecord['recordType'];
  value: number;
  previous_value: number | null;
  achieved_at: string;
}

export interface AssessmentRow {
  user_id: string;
  id: string;
  assessment_number: number;
  assessed_at: string;
  weight_kg: number;
  body_fat_percent: number;
  estimated_muscle_mass_kg: number;
  waist_body_ratio: number;
  symmetry_percent: number | null;
  symmetry_method: string | null;
  method: string;
  confidence: number;
  provider: string;
  hologram_data: BodyAssessment['hologramData'];
  measurements: BodyMeasurements;
}

/* -------------------------------- helpers ------------------------------ */

/**
 * PostgREST serialises `numeric` as a JSON number, but a driver or a proxy that
 * hands one back as a string would otherwise put a string where the app expects
 * arithmetic. Coerce once, here.
 */
const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const optionalNum = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : num(value);

/**
 * Postgres returns a timestamptz as `2026-09-23T10:00:00+00:00`; the device
 * writes `…Z`. Both parse, but the app compares and stores these strings, so
 * everything coming back is normalised to the form the app already uses.
 */
export const toIso = (value: unknown): string => {
  if (typeof value !== 'string' || value === '') return new Date(0).toISOString();
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
};

/**
 * A stable id for rows the local model never gave one.
 *
 * Goals and personal records are stored as bare values on-device. A random id
 * would make every push insert a duplicate, so the id is derived from what
 * makes the record unique: one active goal per type, one record per exercise,
 * type and moment.
 */
export const goalId = (goal: UserGoal): string => goal.id ?? `goal_${goal.goalType}`;

export const recordId = (record: PersonalRecord): string =>
  record.id ?? `pr_${record.exerciseId}_${record.recordType}_${record.achievedAt}`;

/* -------------------------------- profile ------------------------------ */

export interface ProfileRows {
  profile: ProfileRow;
  goals: GoalRow[];
  equipment: EquipmentRow[];
  preferences: PreferenceRow[];
}

export function profileDocToRows(userId: string, doc: ProfileDocument): ProfileRows {
  const { profile } = doc;

  return {
    profile: {
      user_id: userId,
      local_user_id: doc.userId,
      age: profile?.age ?? null,
      sex: profile?.sex ?? null,
      height_cm: profile?.heightCm ?? null,
      weight_kg: profile?.weightKg ?? null,
      training_level: profile?.trainingLevel ?? null,
      training_location: profile?.trainingLocation ?? null,
      training_days: profile?.trainingDays ?? null,
      session_duration_minutes: profile?.sessionDurationMinutes ?? null,
      onboarding_completed: profile?.onboardingCompleted ?? false,
      preferences_chosen: doc.preferencesChosen,
      theme_mode: doc.settings.themeMode,
      reduced_motion: doc.settings.reducedMotion,
      units: doc.settings.units,
      profile_created_at: doc.createdAt,
    },
    goals: doc.goals.map((goal) => ({
      user_id: userId,
      id: goalId(goal),
      goal_type: goal.goalType,
      target_value: goal.targetValue ?? null,
      target_unit: goal.targetUnit ?? null,
      target_exercise_id: goal.targetExerciseId ?? null,
      start_value: goal.startValue ?? null,
      is_active: goal.isActive ?? true,
      goal_created_at: goal.createdAt ?? null,
    })),
    equipment: doc.equipment.map((equipmentId) => ({
      user_id: userId,
      equipment_id: equipmentId,
    })),
    preferences: doc.preferences.map((preference) => ({
      user_id: userId,
      muscle_group: preference.muscleGroup,
      exercise_ids: preference.exerciseIds,
      auto_generated: preference.autoGenerated,
    })),
  };
}

export function rowsToProfileDoc(rows: ProfileRows): ProfileDocument {
  const row = rows.profile;

  // A profile exists only once onboarding has produced every field it needs.
  // Half a profile would let the programme generator run on nulls.
  const complete =
    row.age !== null &&
    row.sex !== null &&
    row.height_cm !== null &&
    row.weight_kg !== null &&
    row.training_level !== null &&
    row.training_location !== null &&
    row.training_days !== null &&
    row.session_duration_minutes !== null;

  const localUserId = row.local_user_id ?? row.user_id;

  const profile: UserProfile | null = complete
    ? {
        userId: localUserId,
        age: num(row.age),
        sex: row.sex as Sex,
        heightCm: num(row.height_cm),
        weightKg: num(row.weight_kg),
        trainingLevel: row.training_level as TrainingLevel,
        trainingLocation: row.training_location as TrainingLocation,
        trainingDays: num(row.training_days) as TrainingDays,
        sessionDurationMinutes: num(row.session_duration_minutes) as SessionDuration,
        onboardingCompleted: row.onboarding_completed,
      }
    : null;

  return {
    userId: localUserId,
    createdAt: row.profile_created_at ?? new Date(0).toISOString(),
    profile,
    goals: rows.goals.map(
      (goal): UserGoal => ({
        id: goal.id,
        goalType: goal.goal_type,
        targetValue: optionalNum(goal.target_value),
        targetUnit: goal.target_unit,
        targetExerciseId: goal.target_exercise_id,
        startValue: optionalNum(goal.start_value),
        isActive: goal.is_active,
        createdAt: goal.goal_created_at ?? undefined,
      }),
    ),
    equipment: rows.equipment.map((row) => row.equipment_id as EquipmentId),
    preferences: rows.preferences.map(
      (preference): ExercisePreference => ({
        muscleGroup: preference.muscle_group as MuscleGroup,
        exerciseIds: preference.exercise_ids ?? [],
        autoGenerated: preference.auto_generated,
      }),
    ),
    preferencesChosen: row.preferences_chosen,
    settings: {
      themeMode: row.theme_mode,
      reducedMotion: row.reduced_motion,
      units: row.units,
    },
  };
}

/* -------------------------------- program ------------------------------ */

export interface ProgramRows {
  program: ProgramRow | null;
  schedule: ScheduledWorkoutRow[];
}

export function programDocToRows(userId: string, doc: ProgramDocument): ProgramRows {
  const { program } = doc;

  return {
    program: program
      ? {
          user_id: userId,
          id: program.id ?? 'program_current',
          version: program.version,
          split_name: program.splitName,
          training_days: program.trainingDays,
          session_duration_minutes: program.sessionDurationMinutes,
          is_active: program.isActive ?? true,
          generated_at: program.generatedAt ?? null,
          days: program.days,
          volume_summary: program.volumeSummary,
        }
      : null,
    schedule: doc.schedule.map((slot) => ({
      user_id: userId,
      id: slot.id,
      program_day_id: slot.programDayId,
      day_number: slot.dayNumber,
      focus: slot.focus,
      scheduled_date: slot.scheduledDate,
      status: slot.status,
      duration_minutes: slot.durationMinutes,
      completed_workout_id: slot.completedWorkoutId,
    })),
  };
}

export function rowsToProgramDoc(rows: ProgramRows, localUserId: string): ProgramDocument {
  const row = rows.program;

  return {
    program: row
      ? {
          id: row.id,
          userId: localUserId,
          version: num(row.version),
          splitName: row.split_name,
          trainingDays: num(row.training_days) as TrainingDays,
          sessionDurationMinutes: num(row.session_duration_minutes) as SessionDuration,
          generatedAt: row.generated_at ? toIso(row.generated_at) : undefined,
          isActive: row.is_active,
          days: row.days ?? [],
          volumeSummary: row.volume_summary,
        }
      : null,
    schedule: rows.schedule.map(
      (slot): ScheduledWorkout => ({
        id: slot.id,
        programDayId: slot.program_day_id,
        dayNumber: num(slot.day_number),
        focus: slot.focus,
        // A `date` column comes back as YYYY-MM-DD, which is what the schedule
        // compares against. Left exactly as Postgres gives it.
        scheduledDate: slot.scheduled_date,
        status: slot.status,
        durationMinutes: num(slot.duration_minutes),
        completedWorkoutId: slot.completed_workout_id,
      }),
    ),
  };
}

/* -------------------------------- workouts ----------------------------- */

export interface WorkoutRows {
  completed: CompletedWorkoutRow[];
  records: PersonalRecordRow[];
}

export function workoutsDocToRows(userId: string, doc: WorkoutsDocument): WorkoutRows {
  return {
    completed: doc.completed.map((workout) => ({
      user_id: userId,
      id: workout.id,
      program_day_id: workout.programDayId,
      day_number: workout.dayNumber,
      focus: workout.focus,
      started_at: workout.startedAt,
      completed_at: workout.completedAt,
      duration_seconds: workout.durationSeconds,
      total_sets: workout.totalSets,
      total_volume_kg: workout.totalVolumeKg,
      cardio_minutes: workout.cardioMinutes,
      exercises: workout.exercises,
      personal_records: workout.personalRecords,
    })),
    records: doc.records.map((record) => ({
      user_id: userId,
      id: recordId(record),
      exercise_id: record.exerciseId,
      record_type: record.recordType,
      value: record.value,
      previous_value: record.previousValue,
      achieved_at: record.achievedAt,
    })),
  };
}

export function rowsToWorkoutsDoc(rows: WorkoutRows, localUserId: string): WorkoutsDocument {
  return {
    completed: rows.completed.map(
      (row): CompletedWorkout => ({
        id: row.id,
        userId: localUserId,
        programDayId: row.program_day_id,
        dayNumber: num(row.day_number),
        focus: row.focus,
        startedAt: toIso(row.started_at),
        completedAt: toIso(row.completed_at),
        durationSeconds: num(row.duration_seconds),
        totalSets: num(row.total_sets),
        totalVolumeKg: num(row.total_volume_kg),
        cardioMinutes: num(row.cardio_minutes),
        exercises: row.exercises ?? [],
        personalRecords: row.personal_records ?? [],
      }),
    ),
    records: rows.records.map(
      (row): PersonalRecord => ({
        id: row.id,
        exerciseId: row.exercise_id,
        recordType: row.record_type,
        value: num(row.value),
        previousValue: optionalNum(row.previous_value),
        achievedAt: toIso(row.achieved_at),
      }),
    ),
  };
}

/* ------------------------------ assessments ---------------------------- */

export function assessmentsDocToRows(
  userId: string,
  doc: AssessmentsDocument,
): AssessmentRow[] {
  return doc.assessments.map((assessment) => ({
    user_id: userId,
    id: assessment.id,
    assessment_number: assessment.assessmentNumber,
    assessed_at: assessment.createdAt,
    weight_kg: assessment.weightKg,
    body_fat_percent: assessment.bodyFatPercent,
    estimated_muscle_mass_kg: assessment.estimatedMuscleMassKg,
    waist_body_ratio: assessment.waistBodyRatio,
    symmetry_percent: assessment.symmetryPercent,
    symmetry_method: assessment.symmetryMethod ?? null,
    method: assessment.method,
    confidence: assessment.confidence,
    provider: assessment.provider,
    hologram_data: assessment.hologramData,
    measurements: assessment.measurements,
    // sourcePhotoId is absent by design. It is a path inside this app's private
    // directory on this device; the photo itself never leaves, so the path
    // means nothing anywhere else and is not worth putting on a server.
  }));
}

export function rowsToAssessmentsDoc(
  rows: AssessmentRow[],
  localUserId: string,
): AssessmentsDocument {
  return {
    assessments: rows.map(
      (row): BodyAssessment => ({
        id: row.id,
        userId: localUserId,
        createdAt: toIso(row.assessed_at),
        weightKg: num(row.weight_kg),
        assessmentNumber: num(row.assessment_number),
        bodyFatPercent: num(row.body_fat_percent),
        estimatedMuscleMassKg: num(row.estimated_muscle_mass_kg),
        waistBodyRatio: num(row.waist_body_ratio),
        symmetryPercent: optionalNum(row.symmetry_percent),
        symmetryMethod: (row.symmetry_method ?? undefined) as BodyAssessment['symmetryMethod'],
        method: row.method as BodyAssessment['method'],
        confidence: num(row.confidence),
        provider: row.provider,
        hologramData: row.hologram_data,
        measurements: row.measurements ?? {},
        // Pulled on a new device there is no photo to point at, and the old
        // device's path would resolve to nothing.
        sourcePhotoId: null,
      }),
    ),
  };
}
