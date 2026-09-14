import { estimateOneRepMax, type CompletedSet, type PersonalRecord } from '@getfit/shared';

export interface ExistingRecords {
  weight: number | null;
  reps: number | null;
  estimated_1rm: number | null;
  volume: number | null;
}

export interface PrDetectionInput {
  exerciseId: string;
  sets: CompletedSet[];
  existing: ExistingRecords;
  achievedAt: string;
}

/**
 * Detects personal records from a finished exercise. Warm-up sets never count,
 * and a record only fires when the new value genuinely beats the old one.
 */
export function detectPersonalRecords(input: PrDetectionInput): PersonalRecord[] {
  const working = input.sets.filter(
    (s) => !s.isWarmup && s.actualReps !== null && s.actualReps > 0,
  );
  if (working.length === 0) return [];

  const records: PersonalRecord[] = [];

  const bestWeight = Math.max(...working.map((s) => s.actualWeight ?? 0));
  const bestReps = Math.max(...working.map((s) => s.actualReps ?? 0));
  const best1rm = Math.max(
    ...working.map((s) => estimateOneRepMax(s.actualWeight ?? 0, s.actualReps ?? 0)),
  );
  const totalVolume = round2(
    working.reduce((sum, s) => sum + (s.actualWeight ?? 0) * (s.actualReps ?? 0), 0),
  );

  const push = (
    recordType: PersonalRecord['recordType'],
    value: number,
    previous: number | null,
  ): void => {
    if (value <= 0) return;
    if (previous !== null && value <= previous) return;
    records.push({
      exerciseId: input.exerciseId,
      recordType,
      value: round2(value),
      previousValue: previous,
      achievedAt: input.achievedAt,
    });
  };

  push('weight', bestWeight, input.existing.weight);
  push('estimated_1rm', best1rm, input.existing.estimated_1rm);
  push('volume', totalVolume, input.existing.volume);

  // A rep PR is only meaningful at or above the weight already recorded —
  // otherwise a light high-rep set would always "beat" a heavy set.
  const repSetsAtRecordWeight = working.filter(
    (s) => input.existing.weight === null || (s.actualWeight ?? 0) >= input.existing.weight,
  );
  if (repSetsAtRecordWeight.length > 0) {
    const repsAtWeight = Math.max(...repSetsAtRecordWeight.map((s) => s.actualReps ?? 0));
    push('reps', repsAtWeight, input.existing.reps);
  } else if (bestWeight <= 0) {
    // Bodyweight movements record raw reps.
    push('reps', bestReps, input.existing.reps);
  }

  return records;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
