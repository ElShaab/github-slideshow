import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CARDIO_EXERCISES,
  EQUIPMENT,
  EXERCISES,
  EXERCISE_BY_ID,
  ExerciseSelectionService,
  GOAL_DESCRIPTIONS,
  GOAL_LABELS,
  LEVEL_DESCRIPTIONS,
  LEVEL_LABELS,
  MAX_EXERCISES_PER_MUSCLE,
  MUSCLE_GROUPS,
  PHOTO_INSTRUCTIONS,
  SESSION_DURATIONS,
  TRAINING_DAY_OPTIONS,
  WEEKLY_PHOTO_INSTRUCTIONS,
  errors,
  type EquipmentId,
  type BodyMeasurements,
  type GoalType,
  type MuscleGroup,
  type TrainingLevel,
} from '@getfit/shared';
import { createStoreProvider } from '../state/billing';
import { resolveEntitlement } from '../state/localEntitlement';
import { LocalRepository } from './repository';
import { DocumentStore } from './store';
import { completeWorkout, progressOverview, type CompleteWorkoutInput } from './workouts';

/**
 * The local API.
 *
 * Every function the screens used to call over HTTP, answered from the device
 * instead. The signatures are unchanged, so nothing above this layer knows the
 * network is gone.
 */
/** The one document store. Exported so the cloud sync works on the same copy. */
export const localStore = new DocumentStore(AsyncStorage);

const repo = new LocalRepository(localStore);
const selection = new ExerciseSelectionService();

/** Membership, from the store. Screens that show it ask through here. */
const currentEntitlement = () =>
  resolveEntitlement(createStoreProvider({ mockAvailable: __DEV__ }));

export const localRepository = repo;

/** The context the selection rules need, drawn from the stored profile. */
async function selectionContext() {
  const doc = await repo.profileDoc();
  const { profile } = doc;
  if (!profile) throw errors.invalidInput('Complete onboarding first.');
  return {
    location: profile.trainingLocation,
    equipment: doc.equipment,
    level: profile.trainingLevel,
    goals: doc.goals.map((goal) => goal.goalType),
  };
}

export const localApi = {
  /* -------------------------------- auth ------------------------------ */

  async me() {
    const doc = await repo.ensureUser();
    // There are no accounts without a server, so nobody is ever a guest with
    // something to upgrade to — the install itself is the identity.
    return { userId: doc.userId, email: null, isGuest: false };
  },

  async deleteAccount() {
    await repo.deleteEverything();
    return { deleted: true, photosRemoved: 0 };
  },

  /** Records that the user turned down an account, so they are not asked again. */
  async declineAccount() {
    await repo.updateProfileDoc((doc) => ({ ...doc, accountDeclined: true }));
    return { declined: true };
  },

  /* ----------------------------- onboarding --------------------------- */

  options() {
    return Promise.resolve({
      levels: (Object.keys(LEVEL_LABELS) as TrainingLevel[]).map((id) => ({
        id,
        label: LEVEL_LABELS[id],
        description: LEVEL_DESCRIPTIONS[id],
      })),
      goals: (Object.keys(GOAL_LABELS) as GoalType[]).map((id) => ({
        id,
        label: GOAL_LABELS[id],
        description: GOAL_DESCRIPTIONS[id],
      })),
      equipment: EQUIPMENT.map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
      })),
      trainingDays: [...TRAINING_DAY_OPTIONS],
      sessionDurations: [...SESSION_DURATIONS],
      photoInstructions: [...PHOTO_INSTRUCTIONS],
      weeklyPhotoInstructions: [...WEEKLY_PHOTO_INSTRUCTIONS],
    });
  },

  async submitOnboarding(payload: {
    age: number;
    sex: 'male' | 'female';
    heightCm: number;
    weightKg: number;
    trainingLevel: TrainingLevel;
    trainingLocation: 'home' | 'gym';
    trainingDays: number;
    sessionDurationMinutes: number;
    goals: GoalType[];
    equipment: EquipmentId[];
  }) {
    const doc = await repo.updateProfileDoc((current) => ({
      ...current,
      profile: {
        userId: current.userId,
        age: payload.age,
        sex: payload.sex,
        heightCm: payload.heightCm,
        weightKg: payload.weightKg,
        trainingLevel: payload.trainingLevel,
        trainingLocation: payload.trainingLocation,
        trainingDays: payload.trainingDays as never,
        sessionDurationMinutes: payload.sessionDurationMinutes as never,
        onboardingCompleted: true,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      },
      goals: payload.goals.map((goalType) => ({ goalType, isActive: true })),
      // A gym has everything, so stored equipment only means anything at home.
      equipment: payload.trainingLocation === 'home' ? payload.equipment : [],
    }));

    if (!doc.profile) throw errors.invalidInput('Could not save your profile.');
    return { profile: doc.profile };
  },

  async onboardingStatus() {
    const doc = await repo.profileDoc();
    return {
      profile: doc.profile,
      goals: doc.goals,
      equipment: doc.equipment,
      hasPreferences: doc.preferences.length > 0,
      accountDeclined: doc.accountDeclined ?? false,
    };
  },

  /* ---------------------------- assessments --------------------------- */

  async runInitialAssessment(input: {
    measurements: BodyMeasurements;
    photoUri?: string | null;
    weightKg?: number;
  }) {
    const existing = await repo.latestAssessment();
    // Re-running the initial analysis is not a new weekly assessment.
    if (existing) return { assessment: existing, repeated: true };

    const assessment = await repo.createAssessment({
      measurements: input.measurements,
      photoUri: input.photoUri,
      enforceInterval: false,
    });
    return { assessment, repeated: false };
  },

  async runWeeklyAssessment(input: {
    measurements: BodyMeasurements;
    photoUri?: string | null;
    weightKg?: number;
  }) {
    const assessment = await repo.createAssessment({
      measurements: input.measurements,
      weightKg: input.weightKg,
      photoUri: input.photoUri,
      enforceInterval: true,
    });

    // The profile weight follows the latest assessment so future programming
    // uses the user's current bodyweight.
    if (input.weightKg !== undefined) {
      await repo.updateProfileDoc((doc) =>
        doc.profile
          ? { ...doc, profile: { ...doc.profile, weightKg: input.weightKg as number } }
          : doc,
      );
    }
    return { assessment };
  },

  assessmentAvailability: () => repo.assessmentAvailability(),
  latestAssessment: async () => ({ assessment: await repo.latestAssessment() }),
  assessmentHistory: async () => ({ assessments: await repo.assessments() }),

  /* ------------------------------ exercises --------------------------- */

  exerciseLibrary() {
    return Promise.resolve({
      exercises: EXERCISES,
      muscleGroups: MUSCLE_GROUPS,
      cardio: CARDIO_EXERCISES,
    });
  },

  async preferenceChoices() {
    const context = await selectionContext();
    const doc = await repo.profileDoc();
    return {
      maxPerMuscle: MAX_EXERCISES_PER_MUSCLE,
      choiceSets: selection.buildChoiceSets(context).map((set) => ({
        muscleGroup: set.muscleGroup,
        choices: set.choices,
        limitedByEquipment: set.limitedByEquipment,
      })),
      saved: doc.preferences,
    };
  },

  async generatePreferences() {
    const context = await selectionContext();
    const preferences = selection.generatePreferences(context);
    await repo.updateProfileDoc((doc) => ({ ...doc, preferences, preferencesChosen: false }));
    return { preferences, autoGenerated: true };
  },

  async savePreferences(preferences: Array<{ muscleGroup: MuscleGroup; exerciseIds: string[] }>) {
    const context = await selectionContext();
    // Validated with the same rules the server used, so an impossible
    // selection is refused here rather than producing a broken programme.
    const validated = selection.validatePreferences(
      preferences.map((entry) => ({ ...entry, autoGenerated: false })),
      context,
    );
    await repo.updateProfileDoc((doc) => ({
      ...doc,
      preferences: validated,
      preferencesChosen: true,
    }));
    // Nothing is regenerated behind the user's back; they choose when.
    return { preferences: validated, programRegenerated: false };
  },

  /* ------------------------------ programme --------------------------- */

  generateProgram: async () => ({ program: await repo.generateProgram() }),
  activeProgram: async () => ({ program: await repo.activeProgram() }),
  programDay: async (id: string) => ({ day: await repo.programDay(id) }),

  async programSchedule() {
    const week = await repo.schedule();
    const { completed } = await repo.workoutsDoc();
    return {
      week,
      upcoming: week.filter((slot) => slot.status === 'scheduled'),
      completed: [...completed].reverse(),
    };
  },

  /* ------------------------------- workouts --------------------------- */

  todaysWorkout: async () => ({ workout: await repo.todaysWorkout() }),
  completeWorkout: async (payload: CompleteWorkoutInput) => ({
    summary: await completeWorkout(repo, payload),
  }),

  async workoutHistory() {
    const { completed } = await repo.workoutsDoc();
    return {
      workouts: [...completed].sort(
        (a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt),
      ),
    };
  },

  async workoutDetail(id: string) {
    const { completed } = await repo.workoutsDoc();
    const workout = completed.find((entry) => entry.id === id);
    if (!workout) throw errors.notFound('That workout is no longer available.');
    return { workout };
  },

  /** A skipped session is marked, never deleted, so the week still adds up. */
  async skipWorkout(scheduledWorkoutId: string) {
    await repo.updateProgramDoc((doc) => ({
      ...doc,
      schedule: doc.schedule.map((slot) =>
        slot.id === scheduledWorkoutId ? { ...slot, status: 'missed' as const } : slot,
      ),
    }));
    return { skipped: true };
  },

  /* ------------------------------- progress --------------------------- */

  progressOverview: () => progressOverview(repo),
  personalRecords: async () => ({ records: (await repo.workoutsDoc()).records }),

  /* --------------------------------- home ----------------------------- */

  async home() {
    const [doc, assessment, availability, today, workouts, entitlement] = await Promise.all([
      repo.profileDoc(),
      repo.latestAssessment(),
      repo.assessmentAvailability(),
      repo.todaysWorkout(),
      repo.workoutsDoc(),
      currentEntitlement(),
    ]);

    return {
      entitlement,
      totals: {
        workouts: workouts.completed.length,
        sets: workouts.completed.reduce((n, workout) => n + workout.totalSets, 0),
      },
      profile: doc.profile,
      assessment,
      assessmentAvailability: availability,
      today: today
        ? {
            scheduled: today.scheduled,
            focus: today.day.focus,
            durationMinutes: today.day.durationMinutes,
            exerciseCount: today.day.exercises.length,
            cardio: today.day.cardio,
            preview: today.day.exercises.slice(0, 3).map((exercise) => ({
              exerciseId: exercise.exerciseId,
              name: EXERCISE_BY_ID[exercise.exerciseId]?.name ?? exercise.exerciseId,
              sets: exercise.sets,
              repsMin: exercise.repsMin,
              repsMax: exercise.repsMax,
              startingWeight: exercise.startingWeight,
            })),
          }
        : null,
    };
  },

  /* ------------------------------- settings --------------------------- */

  async settings() {
    const doc = await repo.profileDoc();
    return {
      profile: doc.profile,
      goals: doc.goals,
      equipment: doc.equipment,
      preferences: doc.preferences,
      appSettings: doc.settings,
      entitlement: await currentEntitlement(),
    };
  },

  async updateProfile(patch: Record<string, unknown>) {
    const doc = await repo.updateProfileDoc((current) =>
      current.profile
        ? { ...current, profile: { ...current.profile, ...patch, updatedAt: new Date().toISOString() } }
        : current,
    );
    if (!doc.profile) throw errors.invalidInput('Complete onboarding first.');
    return { profile: doc.profile, programRegenerated: false };
  },

  async updateGoals(goals: GoalType[]) {
    const doc = await repo.updateProfileDoc((current) => ({
      ...current,
      goals: goals.map((goalType) => ({ goalType, isActive: true })),
    }));
    return { goals: doc.goals, programRegenerated: false };
  },

  async updateEquipment(equipment: EquipmentId[]) {
    const doc = await repo.updateProfileDoc((current) => ({ ...current, equipment }));
    return { equipment: doc.equipment, programRegenerated: false };
  },

  async updateAppSettings(patch: Record<string, unknown>) {
    const doc = await repo.updateProfileDoc((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
    return { appSettings: doc.settings };
  },
};
