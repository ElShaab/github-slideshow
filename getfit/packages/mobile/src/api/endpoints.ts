import type {
  AppSettings,
  AssessmentAvailability,
  AuthTokens,
  BodyAssessment,
  BodyMeasurements,
  CardioPrescription,
  CompletedWorkout,
  EquipmentId,
  Exercise,
  ExercisePreference,
  Entitlement,
  GoalType,
  MuscleGroup,
  PersonalRecord,
  ProgramDay,
  ProgressOverview,
  ScheduledWorkout,
  Sex,
  Subscription,
  TrainingLevel,
  TrainingLocation,
  UserGoal,
  UserProfile,
  WorkoutProgram,
} from '@getfit/shared';
import {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICE_USD,
  SUBSCRIPTION_PRODUCT_ID,
  errors,
} from '@getfit/shared';
import { localApi, localRepository } from '../local/api';
import { createStoreProvider } from '../state/billing';
import { clearLocalBilling, resolveEntitlement } from '../state/localEntitlement';

/**
 * The app's data layer.
 *
 * Every one of these used to be an HTTP call. They now run against local
 * storage and the rules in @getfit/shared, with the signatures unchanged so no
 * screen had to be touched. Nothing here reaches a network.
 */

/* ------------------------------ auth ------------------------------ */

export const authApi = {
  /**
   * There are no accounts to sign in to.
   *
   * The install is the identity: data lives on this device and the membership
   * belongs to the App Store or Play account, so there is nothing to
   * authenticate against. These remain so the screens that call them keep
   * working, and they simply make sure local identity exists.
   */
  async startGuestSession(): Promise<AuthTokens> {
    const { userId } = await localApi.me();
    return { accessToken: userId, userId, isGuest: false } as AuthTokens;
  },

  createAccount(_email: string, _password: string): Promise<AuthTokens> {
    return authApi.startGuestSession();
  },

  login(_email: string, _password: string): Promise<AuthTokens> {
    return authApi.startGuestSession();
  },

  me(): Promise<{ userId: string; email: string | null; isGuest: boolean }> {
    return localApi.me();
  },

  deleteAccount(): Promise<{ deleted: boolean; photosRemoved: number }> {
    return localApi.deleteAccount();
  },
};

/* --------------------------- onboarding --------------------------- */

export interface OnboardingOptions {
  levels: Array<{ id: TrainingLevel; label: string; description: string }>;
  goals: Array<{ id: GoalType; label: string; description: string }>;
  equipment: Array<{ id: EquipmentId; name: string; category: string }>;
  trainingDays: number[];
  sessionDurations: number[];
  photoInstructions: string[];
  weeklyPhotoInstructions: string[];
}

export interface OnboardingPayload {
  age: number;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  trainingLevel: TrainingLevel;
  trainingLocation: TrainingLocation;
  trainingDays: number;
  sessionDurationMinutes: number;
  goals: GoalType[];
  equipment: EquipmentId[];
}

export const onboardingApi = {
  options(): Promise<OnboardingOptions> {
    return localApi.options();
  },

  submit(payload: OnboardingPayload): Promise<{ profile: UserProfile }> {
    return localApi.submitOnboarding(payload);
  },

  status(): Promise<{
    profile: UserProfile | null;
    goals: UserGoal[];
    equipment: EquipmentId[];
    hasPreferences: boolean;
  }> {
    return localApi.onboardingStatus();
  },
};

/* --------------------------- assessments -------------------------- */

export interface AssessmentSubmission {
  measurements: BodyMeasurements;
  /** Optional progress photo. Stored privately; never analysed. */
  photoUri?: string | null;
  weightKg?: number;
}

export const assessmentApi = {
  runInitial(input: AssessmentSubmission): Promise<{ assessment: BodyAssessment; repeated: boolean }> {
    return localApi.runInitialAssessment(input);
  },

  runWeekly(input: AssessmentSubmission): Promise<{ assessment: BodyAssessment }> {
    return localApi.runWeeklyAssessment(input);
  },

  availability(): Promise<AssessmentAvailability> {
    return localApi.assessmentAvailability();
  },

  latest(): Promise<{ assessment: BodyAssessment | null }> {
    return localApi.latestAssessment();
  },

  /** History never includes the source photo — only the hologram and metrics. */
  history(): Promise<{ assessments: BodyAssessment[] }> {
    return localApi.assessmentHistory();
  },
};

/* -------------------------- subscription -------------------------- */

export interface SubscriptionPlanOption {
  productId: string;
  period: 'month' | 'year';
  priceUsd: number;
  /** Undiscounted price, struck through beside the real one. */
  listPriceUsd: number | null;
  badge: string | null;
  limitedTime: boolean;
}

export interface SubscriptionPlan {
  /** The monthly plan, kept flat for older clients. */
  productId: string;
  priceUsd: number;
  period: string;
  freeTrial: boolean;
  /** Every plan on offer. Absent when talking to an older server. */
  plans?: SubscriptionPlanOption[];
  features: string[];
  mockBillingAvailable: boolean;
}

export const subscriptionApi = {
  plan(): Promise<SubscriptionPlan> {
    return Promise.resolve({
      productId: SUBSCRIPTION_PRODUCT_ID,
      priceUsd: SUBSCRIPTION_PRICE_USD,
      period: 'month',
      freeTrial: false,
      plans: SUBSCRIPTION_PLANS,
      features: [
        'Personalized workouts',
        'Progressive overload',
        'Guided workouts',
        'Weekly body analysis',
        'Progress tracking',
        'Goal tracking',
      ],
      mockBillingAvailable: __DEV__,
    });
  },

  /** The only trustworthy answer about membership state. */
  entitlement(): Promise<Entitlement> {
    return resolveEntitlement(createStoreProvider({ mockAvailable: __DEV__ }));
  },

  /**
   * Re-reads membership after a purchase.
   *
   * The receipt is not sent anywhere: with no server to verify it, the store
   * itself is the authority, so this asks the store what the customer now owns
   * rather than taking the app's word for what just happened.
   */
  purchase(): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    return subscriptionApi.entitlement().then((entitlement) => ({
      subscription: null as unknown as Subscription,
      entitlement,
    }));
  },

  restore(): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    return subscriptionApi.purchase();
  },

  cancel(): Promise<Entitlement> {
    // Apple and Google own the billing relationship, so cancelling happens in
    // their settings. Settings → Membership opens the right page.
    return Promise.reject(
      errors.invalidInput(
        'Your store manages this subscription. Cancel it from Settings → Membership.',
      ),
    );
  },
};

/* ---------------------------- exercises --------------------------- */

export interface ExerciseChoiceSet {
  muscleGroup: MuscleGroup;
  choices: Exercise[];
  limitedByEquipment: boolean;
}

export const exerciseApi = {
  library(): Promise<{ exercises: Exercise[]; muscleGroups: unknown[]; cardio: unknown[] }> {
    return localApi.exerciseLibrary();
  },

  preferenceChoices(): Promise<{
    maxPerMuscle: number;
    choiceSets: ExerciseChoiceSet[];
    saved: ExercisePreference[];
  }> {
    return localApi.preferenceChoices();
  },

  generatePreferences(): Promise<{ preferences: ExercisePreference[]; autoGenerated: boolean }> {
    return localApi.generatePreferences();
  },

  savePreferences(
    preferences: Array<{ muscleGroup: MuscleGroup; exerciseIds: string[] }>,
  ): Promise<{ preferences: ExercisePreference[] }> {
    return localApi.savePreferences(preferences);
  },

  /** Saving from Settings also rebuilds future training. */
  applyPreferences(
    preferences: Array<{ muscleGroup: MuscleGroup; exerciseIds: string[] }>,
  ): Promise<{ preferences: ExercisePreference[]; programRegenerated: boolean }> {
    return localApi.savePreferences(preferences);
  },
};

/* ----------------------------- program ---------------------------- */

export const programApi = {
  generate(): Promise<{ program: WorkoutProgram }> {
    return localApi.generateProgram();
  },

  active(): Promise<{ program: WorkoutProgram }> {
    return localApi.activeProgram();
  },

  schedule(): Promise<{
    week: ScheduledWorkout[];
    upcoming: ScheduledWorkout[];
    completed: CompletedWorkout[];
  }> {
    return localApi.programSchedule();
  },

  day(workoutDayId: string): Promise<{ day: ProgramDay }> {
    return localApi.programDay(workoutDayId);
  },
};

/* ---------------------------- workouts ---------------------------- */

export interface TodaysWorkout {
  scheduled: ScheduledWorkout;
  day: ProgramDay;
}

export interface CompleteWorkoutPayload {
  scheduledWorkoutId: string | null;
  workoutDayId: string;
  startedAt: string;
  durationSeconds: number;
  cardioMinutes: number;
  exercises: Array<{
    exerciseId: string;
    workoutExerciseId: string | null;
    orderIndex: number;
    sets: Array<{
      setNumber: number;
      actualWeight: number | null;
      actualReps: number | null;
      prescribedWeight: number | null;
      prescribedRepsMin: number;
      prescribedRepsMax: number;
      isWarmup: boolean;
      completedAt: string;
    }>;
  }>;
}

export interface WorkoutSummary extends CompletedWorkout {
  exerciseCount: number;
  progressionNotes: string[];
}

export const workoutApi = {
  today(): Promise<{ workout: TodaysWorkout | null }> {
    return localApi.todaysWorkout();
  },

  complete(payload: CompleteWorkoutPayload): Promise<{ summary: WorkoutSummary }> {
    return localApi.completeWorkout(payload);
  },

  history(): Promise<{ workouts: CompletedWorkout[] }> {
    return localApi.workoutHistory();
  },

  detail(workoutId: string): Promise<{ workout: CompletedWorkout }> {
    return localApi.workoutDetail(workoutId);
  },

  skip(scheduledWorkoutId: string): Promise<{ skipped: boolean }> {
    return localApi.skipWorkout(scheduledWorkoutId);
  },
};

/* ---------------------------- progress ---------------------------- */

export const progressApi = {
  overview(): Promise<ProgressOverview> {
    return localApi.progressOverview();
  },

  records(): Promise<{ records: PersonalRecord[] }> {
    return localApi.personalRecords();
  },
};

/* ------------------------------ home ------------------------------ */

export interface HomeData {
  entitlement: Entitlement;
  profile: UserProfile | null;
  assessment: BodyAssessment | null;
  assessmentAvailability: AssessmentAvailability;
  today: {
    scheduled: ScheduledWorkout;
    focus: string;
    durationMinutes: number;
    exerciseCount: number;
    cardio: CardioPrescription | null;
    preview: Array<{
      exerciseId: string;
      name: string;
      sets: number;
      repsMin: number;
      repsMax: number;
      startingWeight: number | null;
    }>;
  } | null;
  totals: { workouts: number; sets: number };
  recentWorkouts?: CompletedWorkout[];
}

export const homeApi = {
  load(): Promise<HomeData> {
    return localApi.home();
  },
};

/* ---------------------------- settings ---------------------------- */

export interface SettingsData {
  profile: UserProfile | null;
  goals: UserGoal[];
  equipment: EquipmentId[];
  preferences: ExercisePreference[];
  appSettings: AppSettings;
  entitlement: Entitlement;
}

export const settingsApi = {
  load(): Promise<SettingsData> {
    return localApi.settings();
  },

  updateProfile(
    patch: Partial<UserProfile>,
  ): Promise<{ profile: UserProfile; programRegenerated: boolean }> {
    return localApi.updateProfile(patch);
  },

  updateGoals(goals: GoalType[]): Promise<{ goals: UserGoal[]; programRegenerated: boolean }> {
    return localApi.updateGoals(goals);
  },

  updateEquipment(
    equipment: EquipmentId[],
  ): Promise<{ equipment: EquipmentId[]; programRegenerated: boolean }> {
    return localApi.updateEquipment(equipment);
  },

  updateApp(patch: Partial<AppSettings>): Promise<{ appSettings: AppSettings }> {
    return localApi.updateAppSettings(patch);
  },
};

/* ------------------------ development mode ------------------------ */

export const devApi = {
  config(): Promise<{
    devMode: boolean;
    mockBilling: boolean;
    aiProvider: string;
    storageDriver: string;
    scenarios: string[];
  }> {
    return Promise.resolve({
      devMode: __DEV__,
      mockBilling: __DEV__,
      aiProvider: 'measurement',
      storageDriver: 'device',
      scenarios: ['mock-success', 'mock-expired', 'mock-cancelled', 'mock-cancel'],
    });
  },

  /** Clears the development grant, so the paywall returns. */
  async expireSubscription(): Promise<{ entitlement: Entitlement }> {
    await clearLocalBilling();
    return { entitlement: await resolveEntitlement(createStoreProvider({ mockAvailable: __DEV__ })) };
  },

  /** Moves the last assessment back so the seven-day lock can be exercised. */
  async backdateAssessment(days = 7): Promise<{ backdatedDays: number }> {
    await localRepository.updateAssessmentsDoc((doc) => ({
      assessments: doc.assessments.map((assessment, index) =>
        index === doc.assessments.length - 1
          ? {
              ...assessment,
              createdAt: new Date(
                Date.parse(assessment.createdAt) - days * 86_400_000,
              ).toISOString(),
            }
          : assessment,
      ),
    }));
    return { backdatedDays: days };
  },

  /** Moves the week back so a session falls due today. */
  async backdateSchedule(days = 3): Promise<{ backdatedDays: number }> {
    await localRepository.updateProgramDoc((doc) => ({
      ...doc,
      schedule: doc.schedule.map((slot) => ({
        ...slot,
        scheduledDate: new Date(Date.parse(slot.scheduledDate) - days * 86_400_000)
          .toISOString()
          .slice(0, 10),
      })),
    }));
    return { backdatedDays: days };
  },
};
