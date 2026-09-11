import type {
  AppSettings,
  AssessmentAvailability,
  AuthTokens,
  BodyAssessment,
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
import { request, setToken } from './client';

/* ------------------------------ auth ------------------------------ */

export const authApi = {
  async startGuestSession(): Promise<AuthTokens> {
    const tokens = await request<AuthTokens>('/api/auth/guest', { method: 'POST' });
    await setToken(tokens.accessToken);
    return tokens;
  },

  async createAccount(email: string, password: string): Promise<AuthTokens> {
    const tokens = await request<AuthTokens>('/api/auth/account', {
      method: 'POST',
      body: { email, password },
    });
    await setToken(tokens.accessToken);
    return tokens;
  },

  async login(email: string, password: string): Promise<AuthTokens> {
    const tokens = await request<AuthTokens>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    await setToken(tokens.accessToken);
    return tokens;
  },

  me(): Promise<{ userId: string; email: string | null; isGuest: boolean }> {
    return request('/api/auth/me');
  },

  deleteAccount(): Promise<{ deleted: boolean; photosRemoved: number }> {
    return request('/api/auth/account', { method: 'DELETE' });
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
    return request('/api/onboarding/options', {
      cacheKey: 'onboarding-options',
      fallbackToCache: true,
    });
  },

  submit(payload: OnboardingPayload): Promise<{ profile: UserProfile }> {
    return request('/api/onboarding', { method: 'POST', body: payload });
  },

  status(): Promise<{
    profile: UserProfile | null;
    goals: UserGoal[];
    equipment: EquipmentId[];
    hasPreferences: boolean;
  }> {
    return request('/api/onboarding/status');
  },
};

/* --------------------------- assessments -------------------------- */

function photoForm(uri: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  const name = uri.split('/').pop() ?? 'body.jpg';
  const extension = name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const type = extension === 'png' ? 'image/png' : extension === 'heic' ? 'image/heic' : 'image/jpeg';

  // React Native's FormData accepts this file descriptor shape.
  form.append('photo', { uri, name, type } as unknown as Blob);
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return form;
}

export const assessmentApi = {
  runInitial(photoUri: string): Promise<{ assessment: BodyAssessment; repeated: boolean }> {
    return request('/api/assessments/initial', {
      method: 'POST',
      form: photoForm(photoUri),
      timeoutMs: 60_000,
    });
  },

  runWeekly(photoUri: string, weightKg?: number): Promise<{ assessment: BodyAssessment }> {
    return request('/api/assessments/weekly', {
      method: 'POST',
      form: photoForm(photoUri, weightKg !== undefined ? { weightKg: String(weightKg) } : {}),
      timeoutMs: 60_000,
    });
  },

  availability(): Promise<AssessmentAvailability> {
    return request('/api/assessments/availability');
  },

  latest(): Promise<{ assessment: BodyAssessment | null }> {
    return request('/api/assessments/latest', {
      cacheKey: 'latest-assessment',
      fallbackToCache: true,
    });
  },

  /** History never includes the source photo — only the hologram and metrics. */
  history(): Promise<{ assessments: BodyAssessment[] }> {
    return request('/api/assessments/history', {
      cacheKey: 'assessment-history',
      fallbackToCache: true,
    });
  },
};

/* -------------------------- subscription -------------------------- */

export interface SubscriptionPlan {
  productId: string;
  priceUsd: number;
  period: string;
  freeTrial: boolean;
  features: string[];
  mockBillingAvailable: boolean;
}

export const subscriptionApi = {
  plan(): Promise<SubscriptionPlan> {
    return request('/api/subscription/plan', { cacheKey: 'plan', fallbackToCache: true });
  },

  /** The only trustworthy answer about membership state. */
  entitlement(): Promise<Entitlement> {
    return request('/api/subscription/entitlement');
  },

  purchase(input: {
    platform: 'apple' | 'google' | 'mock';
    receipt: string;
    productId?: string;
  }): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    return request('/api/subscription/purchase', { method: 'POST', body: input, timeoutMs: 45_000 });
  },

  restore(input: {
    platform: 'apple' | 'google' | 'mock';
    receipt: string;
    productId?: string;
  }): Promise<{ subscription: Subscription; entitlement: Entitlement }> {
    return request('/api/subscription/restore', { method: 'POST', body: input, timeoutMs: 45_000 });
  },

  cancel(): Promise<Entitlement> {
    return request('/api/subscription/cancel', { method: 'POST' });
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
    return request('/api/exercises/library', {
      cacheKey: 'exercise-library',
      fallbackToCache: true,
    });
  },

  preferenceChoices(): Promise<{
    maxPerMuscle: number;
    choiceSets: ExerciseChoiceSet[];
    saved: ExercisePreference[];
  }> {
    return request('/api/exercises/preferences/choices', {
      cacheKey: 'preference-choices',
      fallbackToCache: true,
    });
  },

  generatePreferences(): Promise<{ preferences: ExercisePreference[]; autoGenerated: boolean }> {
    return request('/api/exercises/preferences/generate', { method: 'POST' });
  },

  savePreferences(
    preferences: Array<{ muscleGroup: MuscleGroup; exerciseIds: string[] }>,
  ): Promise<{ preferences: ExercisePreference[] }> {
    return request('/api/exercises/preferences', { method: 'PUT', body: { preferences } });
  },

  /** Saving from Settings also rebuilds future training. */
  applyPreferences(
    preferences: Array<{ muscleGroup: MuscleGroup; exerciseIds: string[] }>,
  ): Promise<{ preferences: ExercisePreference[]; programRegenerated: boolean }> {
    return request('/api/exercises/preferences/apply', { method: 'PUT', body: { preferences } });
  },
};

/* ----------------------------- program ---------------------------- */

export const programApi = {
  generate(): Promise<{ program: WorkoutProgram }> {
    return request('/api/program/generate', { method: 'POST', timeoutMs: 45_000 });
  },

  active(): Promise<{ program: WorkoutProgram }> {
    return request('/api/program/active', { cacheKey: 'active-program', fallbackToCache: true });
  },

  schedule(): Promise<{
    week: ScheduledWorkout[];
    upcoming: ScheduledWorkout[];
    completed: CompletedWorkout[];
  }> {
    return request('/api/program/schedule', { cacheKey: 'schedule', fallbackToCache: true });
  },

  day(workoutDayId: string): Promise<{ day: ProgramDay }> {
    return request(`/api/program/day/${workoutDayId}`);
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
    return request('/api/workouts/today', {
      cacheKey: 'todays-workout',
      fallbackToCache: true,
    });
  },

  complete(payload: CompleteWorkoutPayload): Promise<{ summary: WorkoutSummary }> {
    return request('/api/workouts/complete', { method: 'POST', body: payload, timeoutMs: 45_000 });
  },

  history(): Promise<{ workouts: CompletedWorkout[] }> {
    return request('/api/workouts/history', { cacheKey: 'workout-history', fallbackToCache: true });
  },

  detail(workoutId: string): Promise<{ workout: CompletedWorkout }> {
    return request(`/api/workouts/history/${workoutId}`);
  },

  skip(scheduledWorkoutId: string): Promise<{ skipped: boolean }> {
    return request(`/api/workouts/skip/${scheduledWorkoutId}`, { method: 'POST' });
  },
};

/* ---------------------------- progress ---------------------------- */

export const progressApi = {
  overview(): Promise<ProgressOverview> {
    return request('/api/progress/overview', { cacheKey: 'progress', fallbackToCache: true });
  },

  records(): Promise<{ records: PersonalRecord[] }> {
    return request('/api/progress/records');
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
    return request('/api/home', { cacheKey: 'home', fallbackToCache: true });
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
    return request('/api/settings', { cacheKey: 'settings', fallbackToCache: true });
  },

  updateProfile(
    patch: Partial<UserProfile>,
  ): Promise<{ profile: UserProfile; programRegenerated: boolean }> {
    return request('/api/settings/profile', { method: 'PATCH', body: patch, timeoutMs: 45_000 });
  },

  updateGoals(goals: GoalType[]): Promise<{ goals: UserGoal[]; programRegenerated: boolean }> {
    return request('/api/settings/goals', {
      method: 'PUT',
      body: { goals: goals.map((goalType) => ({ goalType })) },
      timeoutMs: 45_000,
    });
  },

  updateEquipment(
    equipment: EquipmentId[],
  ): Promise<{ equipment: EquipmentId[]; programRegenerated: boolean }> {
    return request('/api/settings/equipment', { method: 'PUT', body: { equipment }, timeoutMs: 45_000 });
  },

  updateApp(patch: Partial<AppSettings>): Promise<{ appSettings: AppSettings }> {
    return request('/api/settings/app', { method: 'PATCH', body: patch });
  },
};

/* ------------------------ development mode ------------------------ */

export const devApi = {
  config(): Promise<{
    devMode: boolean;
    mockAiMode: boolean;
    mockBilling: boolean;
    scenarios: string[];
  }> {
    return request('/api/dev/config');
  },

  expireSubscription(): Promise<{ entitlement: Entitlement }> {
    return request('/api/dev/subscription/expire', { method: 'POST' });
  },

  backdateAssessment(days = 7): Promise<{ backdatedDays: number }> {
    return request(`/api/dev/assessment/backdate?days=${days}`, { method: 'POST' });
  },

  backdateSchedule(days = 3): Promise<{ backdatedDays: number }> {
    return request(`/api/dev/schedule/backdate?days=${days}`, { method: 'POST' });
  },
};
