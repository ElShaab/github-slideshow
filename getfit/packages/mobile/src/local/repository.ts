import {
  ASSESSMENT_INTERVAL_DAYS,
  EXERCISE_BY_ID,
  ExerciseSelectionService,
  ProgramGenerationService,
  analyzeBody,
  WEEK_LAYOUTS,
  addDays,
  errors,
  isoDate,
  type AssessmentAvailability,
  type BodyAssessment,
  type BodyMeasurements,
  type CompletedWorkout,
  type EquipmentId,
  type ExercisePreference,
  type GoalType,
  type ProgramDay,
  type ScheduledWorkout,
  type UserProfile,
  type WorkoutProgram,
} from '@getfit/shared';
import {
  DOCUMENT_KEYS,
  emptyAssessments,
  emptyProfile,
  emptyProgram,
  emptyWorkouts,
  type AssessmentsDocument,
  type ProfileDocument,
  type ProgramDocument,
  type WorkoutsDocument,
} from './documents';
import type { DocumentStore } from './store';

/** Enough entropy for local identity; there is no server to collide with. */
export function localId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The on-device data layer.
 *
 * Every read and write the app used to make over HTTP happens here instead,
 * against four documents in local storage and the programme rules in
 * @getfit/shared. There is no network in any of it.
 */
export class LocalRepository {
  constructor(private readonly store: DocumentStore) {}

  /* ------------------------------ profile ----------------------------- */

  profileDoc(): Promise<ProfileDocument> {
    return this.store.read(DOCUMENT_KEYS.profile, () =>
      emptyProfile(localId('user'), new Date().toISOString()),
    );
  }

  /** Creates the install's identity on first use, then returns it unchanged. */
  async ensureUser(): Promise<ProfileDocument> {
    return this.store.update(
      DOCUMENT_KEYS.profile,
      () => emptyProfile(localId('user'), new Date().toISOString()),
      (current) => current,
    );
  }

  updateProfileDoc(change: (doc: ProfileDocument) => ProfileDocument): Promise<ProfileDocument> {
    return this.store.update(
      DOCUMENT_KEYS.profile,
      () => emptyProfile(localId('user'), new Date().toISOString()),
      change,
    );
  }

  /* ------------------------------ program ----------------------------- */

  programDoc(): Promise<ProgramDocument> {
    return this.store.read(DOCUMENT_KEYS.program, emptyProgram);
  }

  updateProgramDoc(change: (doc: ProgramDocument) => ProgramDocument): Promise<ProgramDocument> {
    return this.store.update(DOCUMENT_KEYS.program, emptyProgram, change);
  }

  /* ----------------------------- workouts ----------------------------- */

  workoutsDoc(): Promise<WorkoutsDocument> {
    return this.store.read(DOCUMENT_KEYS.workouts, emptyWorkouts);
  }

  updateWorkoutsDoc(
    change: (doc: WorkoutsDocument) => WorkoutsDocument,
  ): Promise<WorkoutsDocument> {
    return this.store.update(DOCUMENT_KEYS.workouts, emptyWorkouts, change);
  }

  /* ---------------------------- assessments --------------------------- */

  assessmentsDoc(): Promise<AssessmentsDocument> {
    return this.store.read(DOCUMENT_KEYS.assessments, emptyAssessments);
  }

  updateAssessmentsDoc(
    change: (doc: AssessmentsDocument) => AssessmentsDocument,
  ): Promise<AssessmentsDocument> {
    return this.store.update(DOCUMENT_KEYS.assessments, emptyAssessments, change);
  }

  /** Newest first, which is the order every screen wants. */
  async assessments(): Promise<BodyAssessment[]> {
    const { assessments } = await this.assessmentsDoc();
    return [...assessments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async latestAssessment(): Promise<BodyAssessment | null> {
    return (await this.assessments())[0] ?? null;
  }

  /**
   * Whether a new official assessment is unlocked.
   *
   * The seven-day interval is the product's own rule, so it is enforced here
   * exactly as the server enforced it. Without a server there is no clock but
   * the device's, which a determined user can move — that is a consequence of
   * the local-only architecture, not something this check can solve.
   */
  async assessmentAvailability(now = new Date()): Promise<AssessmentAvailability> {
    const latest = await this.latestAssessment();
    if (!latest) {
      return { available: true, daysRemaining: 0, nextAvailableAt: null, lastAssessmentAt: null };
    }

    const nextAvailable = addDays(new Date(latest.createdAt), ASSESSMENT_INTERVAL_DAYS);
    const msRemaining = nextAvailable.getTime() - now.getTime();

    return {
      available: msRemaining <= 0,
      daysRemaining: msRemaining <= 0 ? 0 : Math.ceil(msRemaining / 86_400_000),
      nextAvailableAt: nextAvailable.toISOString(),
      lastAssessmentAt: latest.createdAt,
    };
  }

  /**
   * Runs an assessment and stores it.
   *
   * The analysis is the same measurement provider the server used, which is
   * pure — so it runs here unchanged and produces the identical figures.
   */
  async createAssessment(args: {
    measurements: BodyMeasurements;
    weightKg?: number;
    photoUri?: string | null;
    enforceInterval: boolean;
  }): Promise<BodyAssessment> {
    const { profile } = await this.profileDoc();
    if (!profile) throw errors.invalidInput('Complete onboarding before your analysis.');

    if (args.enforceInterval) {
      const availability = await this.assessmentAvailability();
      if (!availability.available) {
        throw errors.assessmentLocked(
          `Your next assessment unlocks in ${availability.daysRemaining} ${
            availability.daysRemaining === 1 ? 'day' : 'days'
          }.`,
        );
      }
    }

    const weightKg = args.weightKg ?? profile.weightKg;
    const analysis = analyzeBody({
      measurements: args.measurements,
      profile: {
        age: profile.age,
        sex: profile.sex,
        heightCm: profile.heightCm,
        weightKg,
      },
    });

    const doc = await this.updateAssessmentsDoc((current) => ({
      assessments: [
        ...current.assessments,
        {
          ...analysis,
          id: localId('assessment'),
          userId: profile.userId,
          createdAt: new Date().toISOString(),
          weightKg,
          assessmentNumber: current.assessments.length + 1,
          measurements: args.measurements,
          // The photo never leaves the device, so the local file path is the
          // reference. Nothing uploads it and nothing analyses it.
          sourcePhotoId: args.photoUri ?? null,
        },
      ],
    }));

    return doc.assessments[doc.assessments.length - 1];
  }

  /* ----------------------------- programme ---------------------------- */

  /** Builds a programme from the stored profile and lays out the first week. */
  async generateProgram(): Promise<WorkoutProgram> {
    const doc = await this.profileDoc();
    const { profile } = doc;
    if (!profile) throw errors.invalidInput('Complete onboarding before building your program.');

    const assessment = await this.latestAssessment();
    const { completed } = await this.workoutsDoc();

    const program = new ProgramGenerationService().generate({
      profile: {
        age: profile.age,
        sex: profile.sex,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        trainingLevel: profile.trainingLevel,
        trainingLocation: profile.trainingLocation,
        trainingDays: profile.trainingDays,
        sessionDurationMinutes: profile.sessionDurationMinutes,
      },
      goals: doc.goals.map((goal) => goal.goalType),
      equipment: doc.equipment,
      exercisePreferences: doc.preferences,
      bodyMetrics: assessment
        ? {
            bodyFatPercent: assessment.bodyFatPercent,
            muscleMassKg: assessment.estimatedMuscleMassKg,
          }
        : null,
      previousPerformance: bestWeights(completed),
    });

    const withIds: WorkoutProgram = {
      ...program,
      id: localId('program'),
      userId: profile.userId,
      days: program.days.map((day) => ({ ...day, id: day.id ?? localId('day') })),
    };

    await this.updateProgramDoc(() => ({
      program: withIds,
      schedule: layOutWeek(withIds, profile.trainingDays),
    }));

    return withIds;
  }

  async activeProgram(): Promise<WorkoutProgram> {
    const { program } = await this.programDoc();
    if (!program) throw errors.notFound('No program yet. Generate one first.');
    return program;
  }

  async programDay(workoutDayId: string): Promise<ProgramDay> {
    const program = await this.activeProgram();
    const day = program.days.find((entry) => entry.id === workoutDayId);
    if (!day) throw errors.notFound('That workout is not part of your program.');
    return day;
  }

  /**
   * The session due now.
   *
   * Anything scheduled for today or earlier and still outstanding counts: a
   * user who opens the app on Tuesday having missed Monday should be offered
   * Monday's session, not nothing.
   */
  async todaysWorkout(now = new Date()): Promise<{ scheduled: ScheduledWorkout; day: ProgramDay } | null> {
    const { program, schedule } = await this.programDoc();
    if (!program) return null;

    const todayKey = isoDate(now);
    const due = schedule
      .filter((slot) => slot.status === 'scheduled' && slot.scheduledDate <= todayKey)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))[0];
    if (!due) return null;

    const day = program.days.find((entry) => entry.id === due.programDayId);
    return day ? { scheduled: due, day } : null;
  }

  async schedule(): Promise<ScheduledWorkout[]> {
    const { schedule } = await this.programDoc();
    return [...schedule].sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate));
  }

  /* ------------------------------- reset ------------------------------ */

  /** Account deletion. Everything is here, so this really does remove it all. */
  async deleteEverything(): Promise<void> {
    await this.store.clear();
  }
}

/** Best working weight per exercise, so a rebuild keeps earned progress. */
export function bestWeights(completed: CompletedWorkout[]): Record<string, number> {
  const best: Record<string, number> = {};
  for (const workout of completed) {
    for (const exercise of workout.exercises) {
      for (const set of exercise.sets) {
        if (set.isWarmup || typeof set.actualWeight !== 'number') continue;
        const current = best[exercise.exerciseId] ?? 0;
        if (set.actualWeight > current) best[exercise.exerciseId] = set.actualWeight;
      }
    }
  }
  return best;
}

/**
 * Spreads the programme's days across the coming week.
 *
 * The layout comes from the same table the server used, so a four-day week
 * still lands on the same rest pattern.
 */
export function layOutWeek(
  program: WorkoutProgram,
  trainingDays: keyof typeof WEEK_LAYOUTS,
  start = new Date(),
): ScheduledWorkout[] {
  const offsets = WEEK_LAYOUTS[trainingDays] ?? [];
  return program.days.slice(0, offsets.length).map((day, index) => ({
    id: localId('slot'),
    programDayId: day.id ?? '',
    dayNumber: day.dayNumber,
    focus: day.focus,
    scheduledDate: isoDate(addDays(start, offsets[index])),
    status: 'scheduled' as const,
    durationMinutes: day.durationMinutes,
    completedWorkoutId: null,
  }));
}

/** Named export so the assessment path reads clearly at the call site. */
export const exerciseSelection = new ExerciseSelectionService();
export const exerciseById = EXERCISE_BY_ID;
export type { ExercisePreference, EquipmentId, GoalType, UserProfile };
