/**
 * Exhaustive program-generation invariants.
 *
 * The other suites check specific behaviours on representative inputs. This one
 * sweeps the whole configuration matrix — location x equipment x training days
 * x session duration x training level x goal — and asserts the properties that
 * must hold for every user the product can produce. It is the net that catches
 * a rule tuned for one case breaking another.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXERCISE_BY_ID,
  MAX_CARDIO_MINUTES,
  MAX_WARMUP_SETS,
  MUSCLE_GROUPS,
  SESSION_DURATIONS,
  TRAINING_DAY_OPTIONS,
  computeVolume,
  type EquipmentId,
  type GoalType,
  type SessionDuration,
  type TrainingDays,
  type TrainingLevel,
  type TrainingLocation,
} from '../src/index';
import { ExerciseSelectionService } from '../src/index';
import { ProgramGenerationService } from '../src/index';

const generator = new ProgramGenerationService();
const selection = new ExerciseSelectionService();

const EQUIPMENT_SETS: Record<string, EquipmentId[]> = {
  bodyweight: ['bodyweight'],
  dumbbellsAndBench: ['bodyweight', 'dumbbells', 'bench'],
  fullGym: [
    'bodyweight', 'barbell', 'dumbbells', 'bench', 'cable_machine', 'resistance_machines',
    'pullup_bar', 'smith_machine', 'kettlebell', 'resistance_bands', 'squat_rack',
    'dip_station', 'ez_bar', 'treadmill', 'stationary_bike', 'rowing_machine', 'jump_rope',
  ],
};

const LEVELS: TrainingLevel[] = ['beginner', 'intermediate', 'advanced'];
const GOALS: GoalType[] = ['muscle_gain', 'fat_loss', 'strength', 'general_fitness', 'recomposition'];

interface Scenario {
  label: string;
  location: TrainingLocation;
  equipment: EquipmentId[];
  days: TrainingDays;
  duration: SessionDuration;
  level: TrainingLevel;
  goal: GoalType;
}

function everyScenario(): Scenario[] {
  const scenarios: Scenario[] = [];
  for (const location of ['home', 'gym'] as TrainingLocation[]) {
    for (const [name, equipment] of Object.entries(EQUIPMENT_SETS)) {
      // A gym user always has the full complement; a home user never does.
      if (location === 'gym' && name !== 'fullGym') continue;
      if (location === 'home' && name === 'fullGym') continue;

      for (const days of TRAINING_DAY_OPTIONS) {
        for (const duration of SESSION_DURATIONS) {
          for (const level of LEVELS) {
            for (const goal of GOALS) {
              scenarios.push({
                label: `${location}/${name}/${days}d/${duration}m/${level}/${goal}`,
                location,
                equipment,
                days,
                duration,
                level,
                goal,
              });
            }
          }
        }
      }
    }
  }
  return scenarios;
}

function generate(scenario: Scenario) {
  const context = {
    location: scenario.location,
    equipment: scenario.equipment,
    level: scenario.level,
    goals: [scenario.goal],
  };
  return generator.generate({
    profile: {
      age: 30,
      sex: 'male',
      heightCm: 178,
      weightKg: 82,
      trainingLevel: scenario.level,
      trainingLocation: scenario.location,
      trainingDays: scenario.days,
      sessionDurationMinutes: scenario.duration,
    },
    goals: [scenario.goal],
    equipment: scenario.equipment,
    exercisePreferences: selection.generatePreferences(context),
    bodyMetrics: { bodyFatPercent: 24, muscleMassKg: 35 },
    previousPerformance: {},
  });
}

test('every configuration produces a structurally valid program', () => {
  for (const scenario of everyScenario()) {
    const program = generate(scenario);

    assert.equal(program.days.length, scenario.days, `${scenario.label}: wrong day count`);

    for (const day of program.days) {
      // A day with nothing in it renders as an empty workout the user cannot do.
      assert.ok(day.exercises.length > 0, `${scenario.label}: ${day.focus} had no exercises`);
      assert.ok(
        day.durationMinutes <= scenario.duration,
        `${scenario.label}: ${day.focus} ran ${day.durationMinutes}min over a ${scenario.duration}min budget`,
      );
      assert.ok(
        (day.cardio?.minutes ?? 0) <= MAX_CARDIO_MINUTES,
        `${scenario.label}: cardio exceeded the cap`,
      );

      for (const entry of day.exercises) {
        const exercise = EXERCISE_BY_ID[entry.exerciseId];
        assert.ok(exercise, `${scenario.label}: unknown exercise ${entry.exerciseId}`);
        assert.ok(entry.sets > 0, `${scenario.label}: ${exercise.name} had no sets`);
        assert.ok(
          entry.repsMin <= entry.repsMax,
          `${scenario.label}: ${exercise.name} rep range inverted`,
        );
        assert.equal(
          entry.prescribedSets.length,
          entry.sets + entry.warmupSets,
          `${scenario.label}: ${exercise.name} set rows do not match the prescription`,
        );
        assert.ok(
          entry.warmupSets <= MAX_WARMUP_SETS,
          `${scenario.label}: ${exercise.name} had too many warm-ups`,
        );
        if (entry.warmupSets > 0) {
          assert.ok(
            exercise.isCompound,
            `${scenario.label}: warm-ups prescribed on isolation work (${exercise.name})`,
          );
        }
      }
    }
  }
});

test('no configuration buries a muscle past its weekly recovery ceiling', () => {
  for (const scenario of everyScenario()) {
    const program = generate(scenario);
    const weekly = computeVolume(
      program.days.flatMap((day) =>
        day.exercises.map((entry) => ({ exerciseId: entry.exerciseId, workingSets: entry.sets })),
      ),
    );

    for (const group of MUSCLE_GROUPS) {
      const effective = weekly[group.id]?.effectiveSets ?? 0;
      // Secondary work is allowed some headroom, but never a third again over.
      assert.ok(
        effective <= group.weeklySetsMax * 1.3,
        `${scenario.label}: ${group.id} reached ${effective} effective sets against a ${group.weeklySetsMax} ceiling`,
      );
    }
  }
});

test('a home user is never prescribed equipment they do not own', () => {
  for (const scenario of everyScenario()) {
    if (scenario.location !== 'home') continue;
    const owned = new Set<string>(scenario.equipment);
    const program = generate(scenario);

    for (const day of program.days) {
      for (const entry of day.exercises) {
        const exercise = EXERCISE_BY_ID[entry.exerciseId];
        assert.notEqual(
          exercise.availability,
          'gym',
          `${scenario.label}: ${exercise.name} is gym-only`,
        );
        assert.ok(
          exercise.equipment.length === 0 || exercise.equipment.some((item) => owned.has(item)),
          `${scenario.label}: ${exercise.name} needs equipment the user does not have`,
        );
      }
    }
  }
});
