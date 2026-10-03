import { EXERCISE_BY_ID } from './exercises';
import { MUSCLE_GROUP_IDS, SECONDARY_TO_GROUP, SECONDARY_VOLUME_FACTOR } from './muscles';
import type { MuscleGroup, VolumeEntry, VolumeSummary } from './types';

export function emptyVolumeSummary(): VolumeSummary {
  const summary = {} as VolumeSummary;
  for (const muscle of MUSCLE_GROUP_IDS) {
    summary[muscle] = { directSets: 0, secondarySets: 0, effectiveSets: 0 };
  }
  return summary;
}

export interface VolumeContribution {
  exerciseId: string;
  workingSets: number;
}

/**
 * Effective volume = direct working sets + a fraction of every set where the
 * muscle is a secondary mover. Compound lifts therefore pay into several
 * muscles at once, which is what stops the generator from stacking six
 * redundant pressing exercises into one session.
 */
export function computeVolume(contributions: VolumeContribution[]): VolumeSummary {
  const summary = emptyVolumeSummary();

  for (const contribution of contributions) {
    const exercise = EXERCISE_BY_ID[contribution.exerciseId];
    if (!exercise) continue;
    const sets = contribution.workingSets;
    if (sets <= 0) continue;

    summary[exercise.primaryMuscle].directSets += sets;

    const counted = new Set<MuscleGroup>([exercise.primaryMuscle]);
    for (const secondary of exercise.secondaryMuscles) {
      const group = SECONDARY_TO_GROUP[secondary];
      if (!group || counted.has(group)) continue;
      counted.add(group);
      summary[group].secondarySets += sets * SECONDARY_VOLUME_FACTOR;
    }
  }

  for (const muscle of MUSCLE_GROUP_IDS) {
    const entry = summary[muscle];
    entry.directSets = round1(entry.directSets);
    entry.secondarySets = round1(entry.secondarySets);
    entry.effectiveSets = round1(entry.directSets + entry.secondarySets);
  }

  return summary;
}

export function mergeVolume(a: VolumeSummary, b: VolumeSummary): VolumeSummary {
  const merged = emptyVolumeSummary();
  for (const muscle of MUSCLE_GROUP_IDS) {
    merged[muscle] = addEntries(a[muscle], b[muscle]);
  }
  return merged;
}

function addEntries(a: VolumeEntry, b: VolumeEntry): VolumeEntry {
  return {
    directSets: round1(a.directSets + b.directSets),
    secondarySets: round1(a.secondarySets + b.secondarySets),
    effectiveSets: round1(a.effectiveSets + b.effectiveSets),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
