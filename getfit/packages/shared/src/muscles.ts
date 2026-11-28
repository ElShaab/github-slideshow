import type { EquipmentId, MuscleGroup, SecondaryMuscle } from './types';

export interface MuscleGroupMeta {
  id: MuscleGroup;
  name: string;
  region: 'upper' | 'lower' | 'core';
  isMajor: boolean;
  /** Weekly effective-set target band used by the program generator. */
  weeklySetsMin: number;
  weeklySetsMax: number;
  displayOrder: number;
}

export const MUSCLE_GROUPS: MuscleGroupMeta[] = [
  { id: 'chest', name: 'Chest', region: 'upper', isMajor: true, weeklySetsMin: 8, weeklySetsMax: 20, displayOrder: 1 },
  { id: 'back', name: 'Back', region: 'upper', isMajor: true, weeklySetsMin: 10, weeklySetsMax: 22, displayOrder: 2 },
  { id: 'shoulders', name: 'Shoulders', region: 'upper', isMajor: true, weeklySetsMin: 8, weeklySetsMax: 20, displayOrder: 3 },
  { id: 'biceps', name: 'Biceps', region: 'upper', isMajor: false, weeklySetsMin: 6, weeklySetsMax: 18, displayOrder: 4 },
  { id: 'triceps', name: 'Triceps', region: 'upper', isMajor: false, weeklySetsMin: 6, weeklySetsMax: 18, displayOrder: 5 },
  { id: 'forearms', name: 'Forearms', region: 'upper', isMajor: false, weeklySetsMin: 2, weeklySetsMax: 10, displayOrder: 6 },
  { id: 'quads', name: 'Quads', region: 'lower', isMajor: true, weeklySetsMin: 8, weeklySetsMax: 20, displayOrder: 7 },
  { id: 'hamstrings', name: 'Hamstrings', region: 'lower', isMajor: true, weeklySetsMin: 6, weeklySetsMax: 18, displayOrder: 8 },
  { id: 'glutes', name: 'Glutes', region: 'lower', isMajor: true, weeklySetsMin: 6, weeklySetsMax: 18, displayOrder: 9 },
  { id: 'calves', name: 'Calves', region: 'lower', isMajor: false, weeklySetsMin: 4, weeklySetsMax: 14, displayOrder: 10 },
  { id: 'abs', name: 'Abs', region: 'core', isMajor: false, weeklySetsMin: 4, weeklySetsMax: 16, displayOrder: 11 },
];

export const MUSCLE_GROUP_IDS: MuscleGroup[] = MUSCLE_GROUPS.map((m) => m.id);

export const MAJOR_MUSCLE_GROUPS: MuscleGroup[] = MUSCLE_GROUPS.filter((m) => m.isMajor).map((m) => m.id);

/**
 * Secondary muscles are recorded at anatomical resolution (rear delts, lats, …)
 * but volume is accounted at muscle-group resolution. This maps one to the other.
 */
export const SECONDARY_TO_GROUP: Record<SecondaryMuscle, MuscleGroup | null> = {
  chest: 'chest',
  back: 'back',
  shoulders: 'shoulders',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearms',
  quads: 'quads',
  hamstrings: 'hamstrings',
  glutes: 'glutes',
  calves: 'calves',
  abs: 'abs',
  traps: 'back',
  lats: 'back',
  lower_back: 'back',
  rear_delts: 'shoulders',
  front_delts: 'shoulders',
  obliques: 'abs',
  adductors: 'quads',
  hip_flexors: null,
  cardio: null,
};

/** A secondary muscle counts as a fraction of a direct working set. */
export const SECONDARY_VOLUME_FACTOR = 0.5;

export interface EquipmentMeta {
  id: EquipmentId;
  name: string;
  /** Shown in the home-equipment picker during onboarding. */
  selectable: boolean;
  /** Present in every commercial gym, so gym users implicitly own it. */
  gymDefault: boolean;
  category: 'free_weights' | 'machines' | 'cardio' | 'accessories' | 'bodyweight';
}

export const EQUIPMENT: EquipmentMeta[] = [
  { id: 'bodyweight', name: 'Bodyweight', selectable: true, gymDefault: true, category: 'bodyweight' },
  { id: 'resistance_bands', name: 'Resistance Bands', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'dumbbells', name: 'Dumbbells', selectable: true, gymDefault: true, category: 'free_weights' },
  { id: 'adjustable_dumbbells', name: 'Adjustable Dumbbells', selectable: true, gymDefault: true, category: 'free_weights' },
  { id: 'kettlebell', name: 'Kettlebell', selectable: true, gymDefault: true, category: 'free_weights' },
  { id: 'barbell', name: 'Barbell', selectable: true, gymDefault: true, category: 'free_weights' },
  { id: 'weight_plates', name: 'Weight Plates', selectable: true, gymDefault: true, category: 'free_weights' },
  { id: 'ez_bar', name: 'EZ-Bar', selectable: true, gymDefault: true, category: 'free_weights' },
  { id: 'bench', name: 'Bench', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'pullup_bar', name: 'Pull-up Bar', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'dip_station', name: 'Dip Station', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'squat_rack', name: 'Squat Rack', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'cable_machine', name: 'Cable Machine', selectable: true, gymDefault: true, category: 'machines' },
  { id: 'smith_machine', name: 'Smith Machine', selectable: true, gymDefault: true, category: 'machines' },
  { id: 'resistance_machines', name: 'Resistance Machines', selectable: true, gymDefault: true, category: 'machines' },
  { id: 'treadmill', name: 'Treadmill', selectable: true, gymDefault: true, category: 'cardio' },
  { id: 'stationary_bike', name: 'Stationary Bike', selectable: true, gymDefault: true, category: 'cardio' },
  { id: 'rowing_machine', name: 'Rowing Machine', selectable: true, gymDefault: true, category: 'cardio' },
  { id: 'elliptical', name: 'Elliptical', selectable: true, gymDefault: true, category: 'cardio' },
  { id: 'jump_rope', name: 'Jump Rope', selectable: true, gymDefault: true, category: 'cardio' },
  { id: 'ab_wheel', name: 'Ab Wheel', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'medicine_ball', name: 'Medicine Ball', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'stability_ball', name: 'Stability Ball', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'suspension_trainer', name: 'Suspension Trainer', selectable: true, gymDefault: true, category: 'accessories' },
  { id: 'step_platform', name: 'Step Platform', selectable: true, gymDefault: true, category: 'accessories' },
];

export const GYM_EQUIPMENT: EquipmentId[] = EQUIPMENT.filter((e) => e.gymDefault).map((e) => e.id);

export const EQUIPMENT_BY_ID: Record<string, EquipmentMeta> = Object.fromEntries(
  EQUIPMENT.map((e) => [e.id, e]),
);
