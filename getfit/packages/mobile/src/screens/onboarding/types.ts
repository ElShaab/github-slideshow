/** Onboarding is 8 screens; the spec merges several of the original pages. */
export const ONBOARDING_STEPS = 8;

export type OnboardingStepName =
  | 'basics'
  | 'level'
  | 'location'
  | 'equipment'
  | 'schedule'
  | 'goals'
  | 'measurements'
  | 'photo';

/**
 * Home users see the equipment screen; gym users skip it, so the visible step
 * numbers stay contiguous either way.
 */
export function stepNumber(step: OnboardingStepName, includesEquipment: boolean): number {
  const order: OnboardingStepName[] = includesEquipment
    ? ['basics', 'level', 'location', 'equipment', 'schedule', 'goals', 'measurements', 'photo']
    : ['basics', 'level', 'location', 'schedule', 'goals', 'measurements', 'photo'];
  return order.indexOf(step) + 1;
}

export function totalSteps(includesEquipment: boolean): number {
  return includesEquipment ? 8 : 7;
}
