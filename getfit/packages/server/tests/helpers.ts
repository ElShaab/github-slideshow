import { GYM_EQUIPMENT, type EquipmentId, type GoalType, type TrainingLevel, type TrainingLocation } from '@getfit/shared';
import type { SelectionContext } from '../src/services/exerciseSelectionService';
import type { ProgramGenerationInput } from '../src/services/programGenerationService';

export function selectionContext(overrides: Partial<SelectionContext> = {}): SelectionContext {
  return {
    location: 'gym' as TrainingLocation,
    equipment: GYM_EQUIPMENT,
    level: 'intermediate' as TrainingLevel,
    goals: ['muscle_gain'] as GoalType[],
    ...overrides,
  };
}

export function programInput(
  overrides: Partial<ProgramGenerationInput> = {},
): ProgramGenerationInput {
  return {
    profile: {
      age: 30,
      sex: 'male',
      heightCm: 180,
      weightKg: 82,
      trainingLevel: 'intermediate',
      trainingLocation: 'gym',
      trainingDays: 4,
      sessionDurationMinutes: 60,
      ...(overrides.profile ?? {}),
    },
    goals: overrides.goals ?? ['muscle_gain'],
    equipment: overrides.equipment ?? (GYM_EQUIPMENT as EquipmentId[]),
    exercisePreferences: overrides.exercisePreferences ?? [],
    bodyMetrics: overrides.bodyMetrics ?? { bodyFatPercent: 21.8, muscleMassKg: 61.2 },
    previousPerformance: overrides.previousPerformance ?? {},
  };
}

export function setsOf(
  count: number,
  weight: number | null,
  reps: number,
  opts: { isWarmup?: boolean; prescribedWeight?: number | null; min?: number; max?: number } = {},
) {
  return Array.from({ length: count }, (_unused, index) => ({
    setNumber: index + 1,
    actualWeight: weight,
    actualReps: reps,
    prescribedWeight: opts.prescribedWeight ?? weight,
    prescribedRepsMin: opts.min ?? 8,
    prescribedRepsMax: opts.max ?? 10,
    isWarmup: opts.isWarmup ?? false,
    completedAt: new Date().toISOString(),
  }));
}
