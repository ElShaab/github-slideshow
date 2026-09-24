import type {
  AppSettings,
  BodyAssessment,
  CompletedWorkout,
  EquipmentId,
  ExercisePreference,
  PersonalRecord,
  ScheduledWorkout,
  UserGoal,
  UserProfile,
  WorkoutProgram,
} from '@getfit/shared';

/**
 * The on-device database.
 *
 * Split into four documents by how they are written, not by how they are read.
 * Logging a set rewrites the workout log many times a session; the profile is
 * written once in onboarding and rarely after. Keeping them apart means a set
 * logged mid-workout does not rewrite the programme, and a corrupt document
 * costs one area rather than everything.
 */

export const DOCUMENT_KEYS = {
  profile: 'getfit.local.profile',
  program: 'getfit.local.program',
  workouts: 'getfit.local.workouts',
  assessments: 'getfit.local.assessments',
} as const;

export interface ProfileDocument {
  /** Stable identity for this install. There are no accounts to sign in to. */
  userId: string;
  createdAt: string;
  profile: UserProfile | null;
  goals: UserGoal[];
  equipment: EquipmentId[];
  preferences: ExercisePreference[];
  /** True when the user chose them rather than accepting the generated set. */
  preferencesChosen: boolean;
  /**
   * When the user last postponed creating their account.
   *
   * A timestamp rather than a flag: postponing is "not now", not "never". The
   * membership does not depend on it — entitlement comes from the store — so
   * the app asks again later rather than blocking someone with no signal.
   */
  accountDeferredAt?: string;
  settings: AppSettings;
}

export interface ProgramDocument {
  program: WorkoutProgram | null;
  schedule: ScheduledWorkout[];
}

export interface WorkoutsDocument {
  completed: CompletedWorkout[];
  records: PersonalRecord[];
}

export interface AssessmentsDocument {
  assessments: BodyAssessment[];
}

export const emptyProfile = (userId: string, now: string): ProfileDocument => ({
  userId,
  createdAt: now,
  profile: null,
  goals: [],
  equipment: [],
  preferences: [],
  preferencesChosen: false,
  settings: { themeMode: 'dark', reducedMotion: false, units: 'metric' },
});

export const emptyProgram = (): ProgramDocument => ({ program: null, schedule: [] });
export const emptyWorkouts = (): WorkoutsDocument => ({ completed: [], records: [] });
export const emptyAssessments = (): AssessmentsDocument => ({ assessments: [] });
