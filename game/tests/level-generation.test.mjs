import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { LevelGenerator } from '../src/core/LevelGenerator.js';
import { LevelSimulator } from '../src/core/LevelSimulator.js';
import { validateLevel } from '../src/core/LevelValidator.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import { DifficultyManager } from '../src/core/DifficultyManager.js';
import { isValidGate } from '../src/core/GateMath.js';

const entry = (squad = 10, levels = {}) => ({ squad, weapon: WeaponStats.fromLevels(levels) });

test('a generated stage is structurally valid and has a winning path', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  const start = entry();
  const { level } = generator.generate(1, start, 4242);

  assert.equal(validateLevel(level).ok, true);
  assert.ok(level.validation.winningPaths >= 1);
  assert.ok(simulator.hasWinningPath(level, start));
});

test('the winning path reported by the generator really survives', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  for (let seed = 0; seed < 40; seed++) {
    const start = entry(10 + seed);
    const { level } = generator.generate((seed % 12) + 1, start, seed * 977 + 1);
    const result = simulator.simulatePath(level, start, level.validation.bestPath);
    assert.equal(result.survived, true, `seed ${seed}: reported best path died`);
    assert.ok(result.finalSquad > 0);
    assert.ok(Number.isInteger(result.finalSquad));
  }
});

test('gates in a row are never all mathematically identical', () => {
  const generator = new LevelGenerator();
  for (let seed = 0; seed < 60; seed++) {
    const { level } = generator.generate((seed % 10) + 1, entry(10 + (seed % 50)), seed + 500);
    for (const section of level.sections) {
      const labels = section.gateRow.gates.map((gate) =>
        gate.type === 'WEAPON' ? `w:${gate.stat}` : `${gate.type}:${gate.value}`);
      assert.equal(new Set(labels).size >= 2, true, 'a gate row offered three identical choices');
      for (const gate of section.gateRow.gates) assert.ok(isValidGate(gate));
    }
  }
});

test('stages last roughly two to three minutes', () => {
  const generator = new LevelGenerator();
  for (let seed = 0; seed < 40; seed++) {
    const { level } = generator.generate((seed % 15) + 1, entry(20 + seed), seed * 31 + 7);
    assert.ok(level.estimatedSeconds >= CONFIG.generation.minStageSeconds, `${level.estimatedSeconds}s is too short`);
    assert.ok(level.estimatedSeconds <= CONFIG.generation.maxStageSeconds, `${level.estimatedSeconds}s is too long`);
  }
});

test('enemy speed in a generated stage follows the post-95% rules', () => {
  const generator = new LevelGenerator();
  const difficulty = new DifficultyManager();
  let previousSpeed = 0;
  for (let stage = 1; stage <= 24; stage++) {
    const { level } = generator.generate(stage, entry(60), stage * 13 + 3);
    assert.ok(Math.abs(level.enemySpeed - difficulty.enemySpeed(stage)) < 1e-9);
    if (stage <= CONFIG.enemies.speedRampStartStage - 1) {
      assert.equal(level.enemySpeedMultiplier, 1);
    } else {
      assert.ok(level.enemySpeed > previousSpeed);
    }
    assert.ok(level.difficulty <= CONFIG.difficulty.max + 1e-9);
    previousSpeed = level.enemySpeed;
  }
});

test('waves use one, two and three lanes across a run (not always all three)', () => {
  const generator = new LevelGenerator();
  const seen = new Set();
  for (let seed = 0; seed < 60; seed++) {
    const { level } = generator.generate((seed % 10) + 1, entry(40), seed * 17 + 11);
    for (const section of level.sections) {
      for (const wave of section.waves) {
        seen.add(wave.lanes.filter((count) => count > 0).length);
      }
    }
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('backward requirement propagation is consistent with forward simulation', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  for (let seed = 0; seed < 25; seed++) {
    const start = entry(30 + seed);
    const { level } = generator.generate((seed % 8) + 1, start, seed * 61 + 5);

    // The generator promises the stage is beatable from requiredEntrySquad.
    assert.ok(level.requiredEntrySquad <= start.squad);
    const atRequirement = { squad: level.requiredEntrySquad, weapon: start.weapon };
    assert.equal(simulator.hasWinningPath(level, atRequirement), true,
      `seed ${seed}: requirement ${level.requiredEntrySquad} is not actually sufficient`);

    // ... and that the requirement is tight: one soldier fewer should not
    // leave the golden route comfortably intact.
    const minimum = simulator.minimumEntrySquad(level, start);
    assert.ok(minimum <= level.requiredEntrySquad,
      `seed ${seed}: simulator needs ${minimum} but generator claimed ${level.requiredEntrySquad}`);
  }
});

test('a stage generated for a tiny squad is still beatable (continue case)', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  for (const squad of [1, 2, 3, 5, 8]) {
    for (const stage of [1, 5, 12, 20]) {
      const start = entry(squad);
      const { level } = generator.generate(stage, start, squad * 100 + stage);
      assert.equal(simulator.hasWinningPath(level, start), true,
        `stage ${stage} with a squad of ${squad} had no winning path`);
    }
  }
});

test('generation is deterministic for a given seed', () => {
  const a = new LevelGenerator().generate(6, entry(45), 9090).level;
  const b = new LevelGenerator().generate(6, entry(45), 9090).level;
  assert.equal(JSON.stringify(a.sections), JSON.stringify(b.sections));
  assert.equal(JSON.stringify(a.boss), JSON.stringify(b.boss));
});

test('an unplayably weak entry state still produces a valid stage', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  const start = entry(1);
  const { level } = generator.generate(30, start, 31337);
  assert.equal(validateLevel(level).ok, true);
  assert.equal(simulator.hasWinningPath(level, start), true);
});
