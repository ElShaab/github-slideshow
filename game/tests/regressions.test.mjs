/**
 * Regressions.
 *
 * Every test here pins a bug that was found in review and fixed. They are kept
 * together so it is obvious what must never come back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, cloneConfig } from '../src/core/Config.js';
import { escortLaneSpawns, resolveBossEncounter, resolveLaneStream } from '../src/core/CombatModel.js';
import { LaneController } from '../src/systems/LaneController.js';
import { RunState } from '../src/core/RunState.js';
import { Profile, MemoryStorage } from '../src/core/Profile.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import { LevelGenerator } from '../src/core/LevelGenerator.js';
import { LevelSimulator } from '../src/core/LevelSimulator.js';
import { validateLevel } from '../src/core/LevelValidator.js';
import { continueRestoration } from '../src/core/Economy.js';

test('a boss escort puts its FULL count in every lane, not a third in each', () => {
  const boss = { hp: 100, speed: 6, contactLoss: 3, escort: { count: 45, hp: 80, speed: 8.5, spacing: 2 } };
  const spawns = escortLaneSpawns(boss, CONFIG.lanes.count);

  assert.equal(spawns.length, CONFIG.lanes.count);
  for (const count of spawns) {
    assert.equal(count, boss.escort.count,
      'every lane must carry the count the combat model resolves, or the live escort is easier than the certified stage');
  }

  // Whichever lane the player takes, the fight matches what the model priced.
  const weapon = WeaponStats.fromLevels({ damage: 1 });
  const modelled = resolveBossEncounter({ squadSize: 60, weapon, boss, efficiency: 1 });
  for (const count of spawns) {
    const lane = resolveLaneStream({
      squadSize: 60, weapon, enemyHp: boss.escort.hp, enemyCount: count,
      enemySpeed: boss.escort.speed, spacing: boss.escort.spacing
    });
    assert.ok(lane.leaks > 0 || modelled.squadAfter === 60,
      'a lane of the escort must cost what the model charged for it');
  }

  assert.deepEqual(escortLaneSpawns({ hp: 10, escort: null }, 3), [], 'escortless bosses spawn nothing');
});

test('a paid continue restores soldiers without minting lifetime Soldier Points', () => {
  const profile = new Profile(new MemoryStorage());
  const run = new RunState(CONFIG, profile);

  run.addSoldiers(290);                       // earned during play: these do count
  const earned = profile.soldierPoints;
  run.removeSoldiers(run.squad);              // wiped out
  assert.equal(run.squad, 0);

  const restored = continueRestoration({ minimumViable: 40, previousSquad: 300 });
  run.restoreSoldiers(restored);

  assert.equal(run.squad, restored);
  assert.equal(run.alive, true);
  assert.equal(profile.soldierPoints, earned,
    'reinforcements are not newly acquired soldiers; crediting them turns continues into a currency printer');

  // Repeating the cycle must not drift either.
  for (let i = 0; i < 5; i++) {
    run.removeSoldiers(run.squad);
    run.restoreSoldiers(restored);
  }
  assert.equal(profile.soldierPoints, earned);
});

test('a corrupt gem balance cannot brick the continue system', () => {
  const storage = new MemoryStorage();
  for (const bad of [-12, 3.7, Number.NaN]) {
    storage.setItem('army-runner.profile.v1', JSON.stringify({
      version: 1, gems: bad, soldierPoints: 10, unlockedSkins: ['recruit'], selectedSkin: 'recruit'
    }));
    const profile = new Profile(storage);
    assert.ok(Number.isInteger(profile.gems), `gems became ${profile.gems}`);
    assert.ok(profile.gems >= 0, `gems became ${profile.gems}`);
  }
});

test('the gate awarded is the one the squad is visibly running through', () => {
  const lanes = new LaneController();
  lanes.move(1);                    // swipe registers instantly...
  assert.equal(lanes.lane, 2, 'the input target changes at once');
  assert.equal(lanes.laneAt(lanes.x), 1, '...but the squad is still drawn in the old lane');

  // Once the slide finishes, both agree.
  for (let i = 0; i < 60; i++) lanes.update(1 / 60);
  assert.equal(lanes.laneAt(lanes.x), 2);

  // Half way across, the nearer lane wins -- which is what the player sees.
  const mid = new LaneController();
  mid.move(-1);
  mid.x = mid.laneX(0) * 0.6 + mid.laneX(1) * 0.4;
  assert.equal(mid.laneAt(mid.x), 0);
});

test('lane count is data: a four-lane build generates and validates cleanly', () => {
  const config = cloneConfig();
  config.lanes.count = 4;
  const generator = new LevelGenerator(config);
  const simulator = new LevelSimulator(config);

  for (let seed = 0; seed < 6; seed++) {
    const entry = { squad: 20 + seed * 12, weapon: WeaponStats.fromLevels({}, config) };
    const { level } = generator.generate((seed % 6) + 1, entry, seed * 313 + 7);

    assert.equal(validateLevel(level, config).ok, true);
    for (const section of level.sections) {
      assert.equal(section.gateRow.gates.length, 4);
      for (const wave of section.waves) {
        assert.equal(wave.lanes.length, 4);
        assert.equal(wave.spacings.length, 4);
      }
    }
    assert.equal(simulator.hasWinningPath(level, entry), true);
    assert.equal(escortLaneSpawns(level.boss, config.lanes.count).length,
      level.boss.escort ? 4 : 0);
  }
});

test('section boundaries are exactly adjacent, not a float ULP apart', () => {
  const generator = new LevelGenerator();

  // Seven sections give the arithmetic enough room to drift: startZ is
  // i * length while the previous endZ used to be (i-1) * length + length,
  // and those can land one ULP apart. The validator then read a 0.2 picometre
  // difference as an overlap and threw the whole stage away -- 21% of all
  // candidates, and a third of the generator's running time.
  for (let seed = 1; seed < 120; seed++) {
    const entry = { squad: 40 + (seed * 11) % 200, weapon: WeaponStats.fromLevels({ damage: seed % 3 }) };
    const { level } = generator.generate((seed % 12) + 1, entry, seed * 613 + 7);

    for (let i = 1; i < level.sections.length; i++) {
      const previous = level.sections[i - 1];
      const current = level.sections[i];
      assert.equal(current.startZ, previous.endZ,
        `section ${i} starts at ${current.startZ} but section ${i - 1} ends at ${previous.endZ}`);
    }
    assert.equal(validateLevel(level).ok, true);
  }

  assert.equal(generator.stats.rejectionReasons['sections-overlap'], undefined,
    'no candidate should ever be rejected for sections overlapping');
});
