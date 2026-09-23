import type { BodyFatMethod, GoalType, SessionDuration, SubscriptionPlan, SymmetryMethod, TrainingDays, TrainingLevel } from './types';

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

/**
 * The US monthly price, matching the App Store price point the product was
 * created with. Apple's tiers are .99, and the schedule chosen is $4.99 — the
 * number shown has to be the number charged, or Guideline 3.1.2 applies.
 */
export const SUBSCRIPTION_PRICE_USD = 4.99;
export const SUBSCRIPTION_PRODUCT_ID = 'getfit_membership_monthly';
export const YEARLY_PRODUCT_ID = 'getfit_membership_yearly';

/**
 * Every membership the app sells. The store product ids must match the ones
 * configured in App Store Connect and Play Console exactly, and the server
 * refuses any purchase naming a product that is not in this list — the client
 * chooses which plan to buy, so the catalogue is what bounds that choice.
 *
 * `listPriceUsd` is the undiscounted price. It is struck through beside the
 * price actually charged, and is null when a plan carries no offer.
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    productId: SUBSCRIPTION_PRODUCT_ID,
    period: 'month',
    priceUsd: SUBSCRIPTION_PRICE_USD,
    listPriceUsd: null,
    badge: null,
    limitedTime: false,
  },
  {
    productId: YEARLY_PRODUCT_ID,
    period: 'year',
    priceUsd: 19.99,
    listPriceUsd: 40,
    badge: 'BEST DEAL',
    limitedTime: true,
  },
];

export const PLAN_BY_PRODUCT_ID: Record<string, SubscriptionPlan> = Object.fromEntries(
  SUBSCRIPTION_PLANS.map((plan) => [plan.productId, plan]),
);

/** The plan a store product id refers to, or undefined if we do not sell it. */
export function planForProduct(productId: string | undefined | null): SubscriptionPlan | undefined {
  return productId ? PLAN_BY_PRODUCT_ID[productId] : undefined;
}

/** Whole months covered by one billing period, used to date the paid period. */
export function planPeriodMonths(plan: SubscriptionPlan): number {
  return plan.period === 'year' ? 12 : 1;
}

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

/**
 * How each body-fat method is described to the user. GetFit always says which
 * one produced the number on screen, so an estimate is never mistaken for a
 * measurement.
 */
/**
 * How a balance score is described, mirroring BODY_FAT_METHOD_COPY so the two
 * read the same way on screen.
 */
export const SYMMETRY_METHOD_COPY: Record<
  SymmetryMethod,
  { label: string; short: string; detail: string }
> = {
  measured: {
    label: 'Measured',
    short: 'From both sides of your limbs',
    detail:
      'Calculated from the difference between your left and right arm and thigh. Around 1% between sides is normal; beyond that is worth training out.',
  },
  estimated: {
    label: 'Estimated',
    short: 'Typical for your age',
    detail:
      'Nothing in a waist or neck reading describes whether one arm is bigger than the other, so this is what a typical adult your age looks like rather than a reading off your body. Measure both arms or both thighs to replace it with yours.',
  },
};

export const BODY_FAT_METHOD_COPY: Record<
  BodyFatMethod,
  { label: string; short: string; detail: string }
> = {
  navy: {
    label: 'Measured',
    short: 'From your tape measurements',
    detail:
      'Calculated from your waist, neck and height with the US Navy circumference method, which validates to within about 3-4% of a DEXA scan.',
  },
  bmi: {
    label: 'Estimated',
    short: 'From your height, weight and age',
    detail:
      'Estimated from your height, weight, age and sex. This cannot tell muscle from fat, so it reads high if you are muscular and low if you are not. Add a waist and neck measurement for a much sharper number.',
  },
  vision: {
    label: 'From your photo',
    short: 'From your photo',
    detail: 'Estimated from your photo by the analysis provider configured for this deployment.',
  },
};
