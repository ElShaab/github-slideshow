import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXERCISE_BY_ID, type ExercisePerformance, type TrainingLocation } from '../src/index';
import { ProgressionService } from '../src/index';

const progression = new ProgressionService();
const bench = EXERCISE_BY_ID.bench_press;
const pushUp = EXERCISE_BY_ID.push_up;

function performance(
  sets: Array<{ weight: number | null; reps: number }>,
  prescribed = { weight: 60, min: 8, max: 10 },
): ExercisePerformance {
  return {
    exerciseId: 'bench_press',
    performedAt: new Date().toISOString(),
    sets: sets.map((s) => ({ weight: s.weight, reps: s.reps, isWarmup: false })),
    prescribedWeight: prescribed.weight,
    prescribedSets: sets.length,
    prescribedRepsMin: prescribed.min,
    prescribedRepsMax: prescribed.max,
  };
}

function decide(
  sets: Array<{ weight: number | null; reps: number }>,
  opts: { location?: TrainingLocation; baseSets?: number } = {},
) {
  return progression.decide({
    exercise: bench,
    location: opts.location ?? 'gym',
    lastPerformance: performance(sets),
    baseSets: opts.baseSets ?? 3,
    repsMin: 8,
    repsMax: 10,
  });
}

test('a brand new exercise gets the baseline prescription', () => {
  const decision = progression.decide({
    exercise: bench,
    location: 'gym',
    lastPerformance: null,
    baseSets: 3,
    repsMin: 6,
    repsMax: 10,
  });
  assert.equal(decision.action, 'initial');
  assert.equal(decision.nextSets, 3);
  assert.equal(decision.nextWeight, null);
});

test('gym: hitting the top of the range on every set adds weight', () => {
  const decision = decide([
    { weight: 60, reps: 10 },
    { weight: 60, reps: 10 },
    { weight: 60, reps: 10 },
  ]);
  assert.equal(decision.action, 'increase_weight');
  assert.equal(decision.nextWeight, 65); // heavier compound takes a double jump
});

test('gym: mixed reps inside the range holds the weight', () => {
  const decision = decide([
    { weight: 60, reps: 10 },
    { weight: 60, reps: 9 },
    { weight: 60, reps: 8 },
  ]);
  assert.equal(decision.action, 'increase_reps');
  assert.equal(decision.nextWeight, 60);
});

test('gym: falling short does not increase the weight', () => {
  const decision = decide([
    { weight: 60, reps: 8 },
    { weight: 60, reps: 7 },
    { weight: 60, reps: 6 },
  ]);
  assert.notEqual(decision.action, 'increase_weight');
  assert.equal(decision.action, 'reduce_weight');
  assert.ok((decision.nextWeight ?? 0) < 60);
});

test('gym: one weak set holds rather than backing off', () => {
  const decision = decide([
    { weight: 60, reps: 10 },
    { weight: 60, reps: 9 },
    { weight: 60, reps: 7 },
  ]);
  assert.equal(decision.action, 'hold');
  assert.equal(decision.nextWeight, 60);
});

test('home: the alternating ladder adds a set, then weight, then resets', () => {
  // Week 1: 60 kg x3 all at the top of the range → add a set.
  const week1 = decide(
    [
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
    ],
    { location: 'home' },
  );
  assert.equal(week1.action, 'increase_sets');
  assert.equal(week1.nextWeight, 60);
  assert.equal(week1.nextSets, 4);

  // Week 2: 60 kg x4 → move the weight up and reset the set count.
  const week2 = decide(
    [
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
      { weight: 60, reps: 10 },
    ],
    { location: 'home' },
  );
  assert.equal(week2.action, 'increase_weight');
  assert.equal(week2.nextWeight, 62.5);
  assert.equal(week2.nextSets, 3);

  // Week 3: 62.5 kg x3 → back to adding a set.
  const week3 = progression.decide({
    exercise: bench,
    location: 'home',
    baseSets: 3,
    repsMin: 8,
    repsMax: 10,
    lastPerformance: performance(
      [
        { weight: 62.5, reps: 10 },
        { weight: 62.5, reps: 10 },
        { weight: 62.5, reps: 10 },
      ],
      { weight: 62.5, min: 8, max: 10 },
    ),
  });
  assert.equal(week3.action, 'increase_sets');
  assert.equal(week3.nextWeight, 62.5);
  assert.equal(week3.nextSets, 4);
});

test('home: a failed week does not advance the ladder', () => {
  const decision = decide(
    [
      { weight: 60, reps: 7 },
      { weight: 60, reps: 6 },
      { weight: 60, reps: 6 },
    ],
    { location: 'home' },
  );
  assert.equal(decision.action, 'reduce_weight');
  assert.ok((decision.nextWeight ?? 0) < 60);
});

test('a weight changed during the workout drives the next prescription', () => {
  // Prescribed 60 kg, actually lifted 57.5 kg and hit the top of the range.
  const decision = progression.decide({
    exercise: bench,
    location: 'gym',
    baseSets: 3,
    repsMin: 8,
    repsMax: 10,
    lastPerformance: performance(
      [
        { weight: 57.5, reps: 10 },
        { weight: 57.5, reps: 10 },
        { weight: 57.5, reps: 10 },
      ],
      { weight: 60, min: 8, max: 10 },
    ),
  });
  assert.equal(decision.action, 'increase_weight');
  // Progression builds on what was actually lifted (57.5), not on the
  // prescription (60) — so the next step is 60, not 65.
  assert.equal(decision.nextWeight, 60);
});

test('bodyweight exercises progress by sets and reps, never by load', () => {
  const first = progression.decide({
    exercise: pushUp,
    location: 'home',
    baseSets: 3,
    repsMin: 12,
    repsMax: 20,
    lastPerformance: {
      exerciseId: 'push_up',
      performedAt: new Date().toISOString(),
      sets: [
        { weight: null, reps: 20, isWarmup: false },
        { weight: null, reps: 20, isWarmup: false },
        { weight: null, reps: 20, isWarmup: false },
      ],
      prescribedWeight: null,
      prescribedSets: 3,
      prescribedRepsMin: 12,
      prescribedRepsMax: 20,
    },
  });
  assert.equal(first.action, 'increase_sets');
  assert.equal(first.nextWeight, null);
  assert.equal(first.nextSets, 4);
});

test('a session with no logged working sets simply holds', () => {
  const decision = progression.decide({
    exercise: bench,
    location: 'gym',
    baseSets: 3,
    repsMin: 8,
    repsMax: 10,
    lastPerformance: {
      exerciseId: 'bench_press',
      performedAt: new Date().toISOString(),
      sets: [{ weight: 40, reps: null, isWarmup: true }],
      prescribedWeight: 60,
      prescribedSets: 3,
      prescribedRepsMin: 8,
      prescribedRepsMax: 10,
    },
  });
  assert.equal(decision.action, 'hold');
});

test('warm-up sets are excluded from the progression decision', () => {
  const decision = progression.decide({
    exercise: bench,
    location: 'gym',
    baseSets: 3,
    repsMin: 8,
    repsMax: 10,
    lastPerformance: {
      exerciseId: 'bench_press',
      performedAt: new Date().toISOString(),
      sets: [
        { weight: 30, reps: 6, isWarmup: true },
        { weight: 45, reps: 5, isWarmup: true },
        { weight: 60, reps: 10, isWarmup: false },
        { weight: 60, reps: 10, isWarmup: false },
        { weight: 60, reps: 10, isWarmup: false },
      ],
      prescribedWeight: 60,
      prescribedSets: 3,
      prescribedRepsMin: 8,
      prescribedRepsMax: 10,
    },
  });
  assert.equal(decision.action, 'increase_weight');
  assert.ok((decision.nextWeight ?? 0) > 60);
});
