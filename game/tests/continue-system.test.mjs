import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/core/Config.js';
import { LevelGenerator } from '../src/core/LevelGenerator.js';
import { LevelSimulator } from '../src/core/LevelSimulator.js';
import { continueCost, continueRestoration, GemManager } from '../src/core/Economy.js';
import { Profile, MemoryStorage } from '../src/core/Profile.js';
import { RunState } from '../src/core/RunState.js';
import { WeaponStats } from '../src/core/WeaponStats.js';

test('continuing restores a squad that can actually finish the rest of the stage', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();

  for (let seed = 0; seed < 12; seed++) {
    const entry = { squad: 60 + seed * 9, weapon: WeaponStats.fromLevels({ damage: 2, fireRate: 1 }) };
    const { level } = generator.generate((seed % 9) + 1, entry, seed * 719 + 13);
    const fromSection = Math.min(level.sections.length - 1, seed % level.sections.length);

    const minimumViable = simulator.minimumEntrySquad(level, entry, { fromSection });
    assert.ok(minimumViable !== null, 'the rest of the stage must be finishable by some squad');

    const restored = continueRestoration({ minimumViable, previousSquad: entry.squad });
    assert.ok(restored >= minimumViable,
      `restored ${restored} is below the survivable minimum ${minimumViable}`);
    assert.equal(
      simulator.hasWinningPath(level, { squad: restored, weapon: entry.weapon }, { fromSection }),
      true,
      'the restored squad has no winning route'
    );
    // The cap keeps a continue from out-earning the run, except where the
    // survivable minimum is itself larger -- handing back an unsurvivable
    // squad would make the purchase worthless.
    const cap = Math.max(minimumViable * CONFIG.economy.continueSafetyMargin,
      entry.squad * CONFIG.economy.continueRestoreCap);
    assert.ok(restored <= Math.ceil(cap) + 1,
      `restored ${restored} exceeded the abuse cap ${cap}`);
  }
});

test('a full death-and-continue cycle charges gems and keeps the run going', () => {
  const profile = new Profile(new MemoryStorage());
  const gems = new GemManager(profile);
  const run = new RunState(CONFIG, profile);
  run.addSoldiers(40);
  run.weapon.upgrade('damage');
  run.advanceStage();

  const stageBefore = run.stage;
  const weaponBefore = run.weapon.totalLevels;

  run.removeSoldiers(run.squad);        // wiped out
  assert.equal(run.alive, false);
  assert.equal(run.squad, 0);

  // First continue: costs one gem.
  const cost = continueCost(run.continues + 1);
  assert.equal(cost, 1);
  assert.equal(gems.spend(cost), true);
  assert.equal(profile.gems, CONFIG.economy.startingGems - 1);
  run.continues += 1;
  run.setSquad(continueRestoration({ minimumViable: 6, previousSquad: 40 }));
  run.alive = true;

  assert.ok(run.squad > 0);
  assert.equal(run.stage, stageBefore, 'a continue must not reset the stage');
  assert.equal(run.weapon.totalLevels, weaponBefore, 'a continue must not reset weapon upgrades');

  // Second continue costs six gems, which the player can no longer afford.
  assert.equal(continueCost(run.continues + 1), 6);
  assert.equal(gems.canAfford(6), false);
});

test('the run carries squad, weapon and stats across a stage transition (spec 57)', () => {
  const profile = new Profile(new MemoryStorage());
  const run = new RunState(CONFIG, profile);
  run.setSquad(87);
  run.weapon.upgrade('fireRate');
  run.weapon.upgrade('fireRate');
  run.weapon.upgrade('damage');

  const before = {
    squad: run.squad,
    levels: run.weapon.toJSON(),
    tier: run.weapon.tierName
  };

  const stage = run.advanceStage();

  assert.equal(stage, 2);
  assert.equal(run.squad, before.squad);
  assert.deepEqual(run.weapon.toJSON(), before.levels);
  assert.equal(run.weapon.tierName, before.tier);
  assert.equal(run.alive, true);
});

test('the next stage is always generated to be beatable from whatever the run carries', () => {
  const generator = new LevelGenerator();
  const simulator = new LevelSimulator();
  const profile = new Profile(new MemoryStorage());
  const run = new RunState(CONFIG, profile);

  for (let stage = 1; stage <= 12; stage++) {
    const { level } = generator.generate(run.stage, run.toEntry(), stage * 151 + 3);
    assert.equal(simulator.hasWinningPath(level, run.toEntry()), true,
      `stage ${run.stage} unbeatable from squad ${run.squad}`);

    const result = simulator.simulatePath(level, run.toEntry(), level.validation.bestPath);
    assert.equal(result.survived, true);
    run.setSquad(result.finalSquad);
    run.weapon = result.weapon;
    run.advanceStage();
  }
  assert.ok(run.squad > 0);
});
