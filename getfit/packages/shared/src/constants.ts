import type { GoalType, SessionDuration, TrainingDays, TrainingLevel } from './types';

/** Maximum exercises a user may pick per muscle group in Exercise Preferences. */
export const MAX_EXERCISES_PER_MUSCLE = 3;

/** How many options are offered per muscle in Exercise Preferences. */
export const EXERCISE_CHOICES_PER_MUSCLE = 4;

/** A new official body assessment unlocks exactly this many days after the last. */
export const ASSESSMENT_INTERVAL_DAYS = 7;

/** Cardio is capped for every user regardless of body composition. */
export const MAX_CARDIO_MINUTES = 15;

/** Warm-up sets are deliberately capped — this app does not generate long routines. */
export const MAX_WARMUP_SETS = 2;

export const SUBSCRIPTION_PRICE_USD = 5;
export const SUBSCRIPTION_PRODUCT_ID = 'getfit_membership_monthly';

export const SESSION_DURATIONS: SessionDuration[] = [15, 30, 45, 60];
export const TRAINING_DAY_OPTIONS: TrainingDays[] = [1, 2, 3, 4, 5, 6, 7];

export const GOAL_LABELS: Record<GoalType, string> = {
  muscle_gain: 'Muscle Gain',
  fat_loss: 'Fat Loss',
  recomposition: 'Recomposition',
  strength: 'Strength',
  general_fitness: 'General Fitness',
};

export const GOAL_DESCRIPTIONS: Record<GoalType, string> = {
  muscle_gain: 'Add lean muscle mass with hypertrophy-focused volume.',
  fat_loss: 'Reduce body fat while keeping the muscle you have.',
  recomposition: 'Build muscle and lose fat at the same time.',
  strength: 'Get stronger on the main lifts with heavier loading.',
  general_fitness: 'Stay healthy, capable and consistent.',
};

export const LEVEL_LABELS: Record<TrainingLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const LEVEL_DESCRIPTIONS: Record<TrainingLevel, string> = {
  beginner: 'New to training, or returning after a long break.',
  intermediate: 'Training consistently for six months or more.',
  advanced: 'Years of structured training behind you.',
};

/** Photo guidance shown before the initial and weekly captures. */
export const PHOTO_INSTRUCTIONS: string[] = [
  'Face the camera.',
  'Keep your entire body visible.',
  'Use good lighting.',
  'Keep the camera around waist or chest height.',
  'Stand naturally.',
  'Avoid extreme camera angles.',
  'Use relatively fitted clothing when practical.',
  'Keep the camera distance consistent.',
];

export const WEEKLY_PHOTO_INSTRUCTIONS: string[] = [
  'Same location if possible.',
  'Same lighting.',
  'Same camera distance.',
  'Full body in frame.',
  'Facing forward.',
  'Relaxed, natural position.',
];
