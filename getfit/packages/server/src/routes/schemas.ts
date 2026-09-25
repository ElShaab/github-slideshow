import { z } from 'zod';
import { EQUIPMENT, MUSCLE_GROUP_IDS, SESSION_DURATIONS } from '@getfit/shared';

const equipmentIds = EQUIPMENT.map((e) => e.id) as [string, ...string[]];

export const sexSchema = z.enum(['male', 'female']);
export const levelSchema = z.enum(['beginner', 'intermediate', 'advanced']);
export const locationSchema = z.enum(['home', 'gym']);
export const goalTypeSchema = z.enum([
  'muscle_gain',
  'fat_loss',
  'recomposition',
  'strength',
  'general_fitness',
]);

export const onboardingSchema = z.object({
  age: z.number().int().min(13).max(100),
  sex: sexSchema,
  heightCm: z.number().min(120).max(250),
  weightKg: z.number().min(30).max(300),
  trainingLevel: levelSchema,
  trainingLocation: locationSchema,
  trainingDays: z.number().int().min(1).max(7),
  sessionDurationMinutes: z.number().refine((v) => SESSION_DURATIONS.includes(v as 15), {
    message: 'Session duration must be 15, 30, 45 or 60 minutes.',
  }),
  goals: z.array(goalTypeSchema).min(1, 'Choose at least one goal.'),
  equipment: z.array(z.enum(equipmentIds)).default([]),
});

export const profilePatchSchema = z.object({
  age: z.number().int().min(13).max(100).optional(),
  sex: sexSchema.optional(),
  heightCm: z.number().min(120).max(250).optional(),
  weightKg: z.number().min(30).max(300).optional(),
  trainingLevel: levelSchema.optional(),
  trainingLocation: locationSchema.optional(),
  trainingDays: z.number().int().min(1).max(7).optional(),
  sessionDurationMinutes: z
    .number()
    .refine((v) => SESSION_DURATIONS.includes(v as 15))
    .optional(),
});

export const goalsSchema = z.object({
  goals: z
    .array(
      z.object({
        goalType: goalTypeSchema,
        targetValue: z.number().nullable().optional(),
        targetUnit: z.string().max(16).nullable().optional(),
        targetExerciseId: z.string().max(64).nullable().optional(),
      }),
    )
    .min(1, 'Choose at least one goal.'),
});

export const equipmentSchema = z.object({
  equipment: z.array(z.enum(equipmentIds)),
});

export const preferencesSchema = z.object({
  preferences: z.array(
    z.object({
      muscleGroup: z.enum(MUSCLE_GROUP_IDS as [string, ...string[]]),
      exerciseIds: z.array(z.string().max(64)).max(3, 'Choose up to 3 exercises per muscle.'),
    }),
  ),
});

export const accountSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export const purchaseSchema = z.object({
  platform: z.enum(['apple', 'google', 'mock']),
  receipt: z.string().min(1).max(200_000),
  productId: z.string().max(128).optional(),
  packageName: z.string().max(128).optional(),
});

export const completedSetSchema = z.object({
  setNumber: z.number().int().min(1).max(50),
  actualWeight: z.number().min(0).max(1000).nullable(),
  actualReps: z.number().int().min(0).max(500).nullable(),
  prescribedWeight: z.number().min(0).max(1000).nullable(),
  prescribedRepsMin: z.number().int().min(0).max(500),
  prescribedRepsMax: z.number().int().min(0).max(500),
  isWarmup: z.boolean(),
  completedAt: z.string().datetime().optional(),
});

export const completeWorkoutSchema = z.object({
  scheduledWorkoutId: z.string().uuid().nullable().optional(),
  workoutDayId: z.string().uuid(),
  startedAt: z.string().datetime(),
  durationSeconds: z.number().int().min(0).max(60 * 60 * 8),
  cardioMinutes: z.number().int().min(0).max(15).default(0),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string().max(64),
        workoutExerciseId: z.string().uuid().nullable().optional(),
        orderIndex: z.number().int().min(0).max(50),
        sets: z.array(completedSetSchema).min(1),
      }),
    )
    .min(1, 'Log at least one exercise.'),
});

export const settingsSchema = z.object({
  themeMode: z.enum(['dark', 'light', 'system']).optional(),
  reducedMotion: z.boolean().optional(),
  // Presentation only. Every reading stays stored in centimetres and
  // kilograms, so this can be changed without touching a single measurement.
  units: z.enum(['metric', 'imperial']).optional(),
});

export const assessmentWeightSchema = z.object({
  weightKg: z.coerce.number().min(30).max(300).optional(),
});

/**
 * Tape measurements, in centimetres.
 *
 * Every field is optional — the analysis degrades to a BMI estimate rather than
 * refusing — but anything supplied has to be a plausible human measurement, so
 * a slipped decimal point cannot drive the body-fat formula somewhere absurd.
 * Arriving over multipart form data, values are strings, hence the coercion.
 */
const cm = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.coerce.number().min(min).max(max).optional(),
  );

export const bodyMeasurementsSchema = z.object({
  waistCm: cm(40, 200),
  // Matches the client floor. 35 excluded most adult women.
  neckCm: cm(26, 70),
  hipCm: cm(50, 200),
  shoulderCm: cm(60, 200),
  leftArmCm: cm(15, 70),
  rightArmCm: cm(15, 70),
  leftThighCm: cm(25, 110),
  rightThighCm: cm(25, 110),
});

export const assessmentSubmissionSchema = bodyMeasurementsSchema.extend({
  weightKg: z.coerce.number().min(30).max(300).optional(),
});
