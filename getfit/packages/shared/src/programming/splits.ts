import type { MuscleGroup, TrainingDays } from '../types';

export interface DayTemplate {
  focus: string;
  /** Muscles that may receive two exercises when the session budget allows. */
  primary: MuscleGroup[];
  /** Muscles that receive at most one exercise. */
  secondary: MuscleGroup[];
  /** Relative cardio weighting for the day (0 = none, 1 = normal, 1.5 = extra). */
  cardioWeight: number;
}

export interface SplitDefinition {
  name: string;
  days: DayTemplate[];
}

const FULL_BODY_A: DayTemplate = {
  focus: 'Full Body A',
  primary: ['chest', 'back', 'quads'],
  secondary: ['shoulders', 'triceps', 'abs'],
  cardioWeight: 1,
};

const FULL_BODY_B: DayTemplate = {
  focus: 'Full Body B',
  primary: ['back', 'shoulders', 'hamstrings'],
  secondary: ['chest', 'biceps', 'glutes', 'calves'],
  cardioWeight: 1,
};

const FULL_BODY_C: DayTemplate = {
  focus: 'Full Body C',
  primary: ['quads', 'chest', 'back'],
  secondary: ['shoulders', 'glutes', 'abs', 'forearms'],
  cardioWeight: 1,
};

const UPPER_A: DayTemplate = {
  focus: 'Upper Body',
  primary: ['chest', 'back', 'shoulders'],
  secondary: ['triceps', 'biceps'],
  cardioWeight: 0.8,
};

const UPPER_B: DayTemplate = {
  focus: 'Upper Body',
  primary: ['back', 'shoulders', 'chest'],
  secondary: ['biceps', 'triceps', 'forearms'],
  cardioWeight: 0.8,
};

const LOWER_A: DayTemplate = {
  focus: 'Lower Body',
  primary: ['quads', 'hamstrings', 'glutes'],
  secondary: ['calves', 'abs'],
  cardioWeight: 1.2,
};

const LOWER_B: DayTemplate = {
  focus: 'Lower Body',
  primary: ['hamstrings', 'quads', 'glutes'],
  secondary: ['calves', 'abs'],
  cardioWeight: 1.2,
};

const PUSH: DayTemplate = {
  focus: 'Push',
  primary: ['chest', 'shoulders', 'triceps'],
  secondary: ['abs'],
  cardioWeight: 0.8,
};

const PULL: DayTemplate = {
  focus: 'Pull',
  primary: ['back', 'biceps'],
  secondary: ['shoulders', 'forearms'],
  cardioWeight: 0.8,
};

const LEGS: DayTemplate = {
  focus: 'Legs',
  primary: ['quads', 'hamstrings', 'glutes'],
  secondary: ['calves', 'abs'],
  cardioWeight: 1.2,
};

const CORE_CONDITIONING: DayTemplate = {
  focus: 'Core & Conditioning',
  primary: ['abs'],
  secondary: ['calves', 'forearms', 'shoulders'],
  cardioWeight: 1.6,
};

const TARGETED_FULL_BODY: DayTemplate = {
  focus: 'Targeted Full Body',
  primary: ['shoulders', 'back', 'quads'],
  secondary: ['abs', 'biceps', 'triceps', 'calves'],
  cardioWeight: 1.1,
};

/**
 * Fewer training days favour full-body work; from four days upward every major
 * muscle group appears at least twice in the week.
 */
export const SPLITS: Record<TrainingDays, SplitDefinition> = {
  1: { name: 'Full Body', days: [{ ...FULL_BODY_A, focus: 'Full Body' }] },
  2: { name: 'Full Body Split', days: [FULL_BODY_A, FULL_BODY_B] },
  3: { name: 'Full Body Split', days: [FULL_BODY_A, FULL_BODY_B, FULL_BODY_C] },
  4: { name: 'Upper / Lower', days: [UPPER_A, LOWER_A, UPPER_B, LOWER_B] },
  5: {
    name: 'Upper / Lower + Targeted',
    days: [UPPER_A, LOWER_A, UPPER_B, LOWER_B, TARGETED_FULL_BODY],
  },
  6: { name: 'Push / Pull / Legs', days: [PUSH, PULL, LEGS, PUSH, PULL, LEGS] },
  7: {
    name: 'Push / Pull / Legs + Conditioning',
    days: [PUSH, PULL, LEGS, PUSH, PULL, LEGS, CORE_CONDITIONING],
  },
};

export function getSplit(trainingDays: TrainingDays): SplitDefinition {
  return SPLITS[trainingDays];
}
