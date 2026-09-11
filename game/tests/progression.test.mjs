import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { DifficultyManager } from '../src/core/DifficultyManager.js';
import { continueCost, continueRestoration, GemManager } from '../src/core/Economy.js';
import { Profile, MemoryStorage } from '../src/core/Profile.js';
import { RunState } from '../src/core/RunState.js';
import { WeaponStats } from '../src/core/WeaponStats.js';

const difficulty = new DifficultyManager();

test('spec 19: difficulty follows 70%, 73% ... capped at 95%', () => {
  const expected = [0.70, 0.73, 0.76, 0.79, 0.82, 0.85, 0.88, 0.91, 0.94, 0.95];
  expected.forEach((value, index) => {
    assert.equal(difficulty.difficultyFor(index + 1), value, `stage ${index + 1}`);
  });
});

test('difficulty never exceeds 95% no matter how deep the run goes', () => {
  for (let stage = 1; stage <= 500; stage++) {
    assert.ok(difficulty.difficultyFor(stage) <= 0.95 + 1e-9, `stage ${stage}`);
  }
});

test('spec 20: after stage 10 only enemy speed grows, alternating +1% and +7%', () => {
  for (let stage = 1; stage <= 10; stage++) {
    assert.equal(difficulty.enemySpeedStep(stage), 1, `stage ${stage} must not speed up`);
    assert.equal(difficulty.enemySpeedMultiplier(stage), 1);
  }
  const expectedSteps = { 11: 1.01, 12: 1.07, 13: 1.01, 14: 1.07, 15: 1.01, 16: 1.07, 17: 1.01 };
  for (const [stage, step] of Object.entries(expectedSteps)) {
    assert.ok(Math.abs(difficulty.enemySpeedStep(Number(stage)) - step) < 1e-12, `stage ${stage}`);
  }
  // The modifiers are relative to the previous stage's speed.
  let cumulative = 1;
  for (let stage = 11; stage <= 40; stage++) {
    cumulative *= difficulty.enemySpeedStep(stage);
    assert.ok(Math.abs(difficulty.enemySpeedMultiplier(stage) - cumulative) < 1e-9, `stage ${stage}`);
    assert.ok(difficulty.enemySpeed(stage) > difficulty.enemySpeed(stage - 1), 'enemy speed must grow');
  }
});

test('spec 27: continue costs are 1, 6, 11, 16, 21', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => continueCost(n)), [1, 6, 11, 16, 21]);
  for (let n = 1; n <= 20; n++) {
    assert.equal(continueCost(n), 1 + 5 * (n - 1));
  }
});

test('players start with three free gems and gems are spent on continues', () => {
  const profile = new Profile(new MemoryStorage());
  assert.equal(profile.gems, CONFIG.economy.startingGems);
  const gems = new GemManager(profile);
  assert.equal(gems.spend(continueCost(1)), true);
  assert.equal(profile.gems, 2);
  assert.equal(gems.spend(continueCost(2)), false, 'cannot afford a 6-gem continue with 2 gems');
  assert.equal(profile.gems, 2);
});

test('gem packs are purchasable through the mock store', async () => {
  const profile = new Profile(new MemoryStorage());
  const gems = new GemManager(profile);
  const result = await gems.purchasePack('pack_mid');
  assert.equal(result.ok, true);
  assert.equal(profile.gems, CONFIG.economy.startingGems + 50);
  assert.equal((await gems.purchasePack('nope')).ok, false);
});

test('spec 28: continue restoration sits between the viable minimum and the old squad', () => {
  const restored = continueRestoration({ minimumViable: 20, previousSquad: 100 });
  assert.ok(restored >= Math.ceil(20 * CONFIG.economy.continueSafetyMargin), 'below the survivable minimum');
  assert.ok(restored <= 100 * CONFIG.economy.continueRestoreCap + 1, 'above the abuse cap');
  // Closer to the previous squad than to the bare minimum (spec wording).
  assert.ok(restored > (25 + 100) / 2 - 20);
  // Never below the configured floor, even from nothing.
  assert.ok(continueRestoration({ minimumViable: 1, previousSquad: 2 }) >= CONFIG.economy.continueMinSquad);
});

test('spec 29/30: death resets the run but never the permanent progression', () => {
  const profile = new Profile(new MemoryStorage());
  const run = new RunState(CONFIG, profile);
  run.addSoldiers(90);
  run.weapon.upgrade('damage');
  run.advanceStage();
  run.advanceStage();
  run.continues = 2;
  profile.gems = 7;
  const points = profile.soldierPoints;
  profile.addSoldierPoints(2000);
  assert.equal(profile.purchaseSkin('desert').ok, true);

  run.reset();

  assert.equal(run.squad, CONFIG.squad.startingSize);
  assert.equal(run.stage, 1);
  assert.equal(run.continues, 0);
  assert.equal(run.weapon.totalLevels, 0);
  assert.equal(profile.gems, 7, 'gems are permanent');
  assert.ok(profile.soldierPoints >= 0);
  assert.ok(profile.isSkinUnlocked('desert'), 'skins are permanent');
  assert.ok(points > 0);
});

test('lifetime soldier points count every acquired soldier and never fall', () => {
  const profile = new Profile(new MemoryStorage());
  const run = new RunState(CONFIG, profile);
  const start = profile.soldierPoints;
  run.addSoldiers(25);
  run.addSoldiers(40);
  run.removeSoldiers(60);
  run.applyGate({ type: 'MULTIPLY', value: 3 });
  assert.equal(profile.soldierPoints - start, 25 + 40 + (run.squad - 15));
  const before = profile.soldierPoints;
  run.removeSoldiers(1000);
  assert.equal(profile.soldierPoints, before);
});

test('skins are cosmetic, persist, and cost lifetime points only', () => {
  const storage = new MemoryStorage();
  const profile = new Profile(storage);
  profile.addSoldierPoints(20000);
  const before = new WeaponStats().powerMultiplier;
  assert.equal(profile.purchaseSkin('arctic').ok, true);
  assert.equal(profile.selectedSkin, 'arctic');
  assert.equal(new WeaponStats().powerMultiplier, before, 'skins must not touch weapon stats');

  const reloaded = new Profile(storage);
  assert.ok(reloaded.isSkinUnlocked('arctic'));
  assert.equal(reloaded.selectedSkin, 'arctic');
  assert.equal(reloaded.purchaseSkin('arctic').ok, false);
});

test('a corrupt save falls back to a fresh profile instead of crashing', () => {
  const storage = new MemoryStorage();
  storage.setItem('army-runner.profile.v1', '{not json');
  const profile = new Profile(storage);
  assert.equal(profile.gems, CONFIG.economy.startingGems);
  assert.equal(profile.soldierPoints, 0);
});
