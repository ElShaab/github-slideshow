/**
 * Skins (spec 31).
 *
 * Skins are cosmetic and nothing else, and the catalogue has to keep two
 * promises to the player: what you pay for looks different from what you
 * already own, and the ladder reads cheapest-first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, getSkin } from '../src/core/SkinCatalog.js';
import { Profile, MemoryStorage } from '../src/core/Profile.js';
import { WeaponStats } from '../src/core/WeaponStats.js';
import { CONFIG } from '../src/core/Config.js';
import { RunState } from '../src/core/RunState.js';

const CHANNELS = (hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const distance = (a, b) => {
  const [p, q] = [CHANNELS(a), CHANNELS(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

/** The twenty skins added as the prestige ladder, cheapest first. */
const PRESTIGE_IDS = [
  'jungle_ranger', 'urban_scout', 'night_operator', 'savanna_tracker', 'coral_diver',
  'volcanic_sapper', 'copper_vanguard', 'emerald_guard', 'crimson_lancer', 'steel_sentinel',
  'midnight_raider', 'solar_marine', 'amethyst_knight', 'frost_lancer', 'obsidian_ghost',
  'rose_marshal', 'titanium_colossus', 'aurora_sentinel', 'golden_marshal', 'prism_paladin'
];

test('twenty prestige skins span 10,000 to 1,000,000 Soldier Points', () => {
  const prestige = PRESTIGE_IDS.map((id) => {
    const skin = SKINS.find((entry) => entry.id === id);
    assert.ok(skin, `${id} is missing from the catalogue`);
    return skin;
  });

  assert.equal(prestige.length, 20);
  assert.equal(prestige[0].cost, 10000, 'the ladder must start at 10,000');
  assert.equal(prestige[prestige.length - 1].cost, 1000000, 'the ladder must top out at 1,000,000');
  for (const skin of prestige) {
    assert.ok(skin.cost >= 10000 && skin.cost <= 1000000, `${skin.name} sits outside the band`);
  }

  // Every step up the ladder should be a real step, not a rounding difference.
  for (let i = 1; i < prestige.length; i++) {
    assert.ok(prestige[i].cost > prestige[i - 1].cost, `${prestige[i].name} is not dearer than the tier below`);
    const ratio = prestige[i].cost / prestige[i - 1].cost;
    assert.ok(ratio > 1.08, `${prestige[i].name} is only ${ratio.toFixed(2)}x the previous tier`);
    assert.ok(ratio < 1.6, `${prestige[i].name} jumps ${ratio.toFixed(2)}x over the previous tier`);
  }
});

test('the catalogue is well formed and listed cheapest first', () => {
  assert.equal(new Set(SKINS.map((s) => s.id)).size, SKINS.length, 'duplicate skin id');
  assert.equal(new Set(SKINS.map((s) => s.name)).size, SKINS.length, 'duplicate skin name');

  for (let i = 1; i < SKINS.length; i++) {
    assert.ok(SKINS[i].cost >= SKINS[i - 1].cost,
      `the shop would list ${SKINS[i].name} (${SKINS[i].cost}) after a dearer skin`);
  }

  for (const skin of SKINS) {
    assert.ok(Number.isInteger(skin.cost) && skin.cost >= 0, `${skin.id} has a bad price`);
    for (const role of ['uniform', 'gear', 'skin', 'accent']) {
      const value = skin.colors[role];
      assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffff,
        `${skin.id}.${role} is not a 24-bit colour`);
    }
    assert.equal(getSkin(skin.id), skin);
  }
  assert.equal(getSkin('no-such-skin'), SKINS[0], 'an unknown id must fall back to the default skin');
});

test('no two skins share a palette, and price-distant skins look different', () => {
  assert.equal(new Set(SKINS.map((s) => JSON.stringify(s.colors))).size, SKINS.length,
    'two skins have identical palettes');

  for (let i = 0; i < SKINS.length; i++) {
    for (let j = i + 1; j < SKINS.length; j++) {
      const [a, b] = [SKINS[i], SKINS[j]];
      const apart = distance(a.colors.uniform, b.colors.uniform);
      assert.ok(apart >= 15, `${a.name} and ${b.name} are near-identical (${apart.toFixed(1)})`);

      // Paying four times as much must buy a visibly different soldier --
      // otherwise the expensive unlock feels like the cheap one.
      const ratio = Math.max(a.cost, b.cost) / Math.max(1, Math.min(a.cost, b.cost));
      if (ratio >= 4) {
        assert.ok(apart >= 45,
          `${a.name} (${a.cost}) and ${b.name} (${b.cost}) look alike at ${apart.toFixed(1)} despite a ${ratio.toFixed(1)}x price gap`);
      }
    }
  }
});

test('skins carry no gameplay fields at all', () => {
  for (const skin of SKINS) {
    assert.deepEqual(Object.keys(skin).sort(), ['colors', 'cost', 'id', 'name'],
      `${skin.id} carries fields beyond cosmetics`);
    assert.deepEqual(Object.keys(skin.colors).sort(), ['accent', 'gear', 'skin', 'uniform']);
  }
  // And owning one changes nothing about how the squad fights.
  const profile = new Profile(new MemoryStorage());
  const before = new WeaponStats().powerMultiplier;
  profile.addSoldierPoints(2000000);
  for (const skin of SKINS) profile.purchaseSkin(skin.id);
  assert.equal(new WeaponStats().powerMultiplier, before);
});

test('every skin can actually be bought, and costs exactly its price', () => {
  const storage = new MemoryStorage();
  const profile = new Profile(storage);
  const total = SKINS.reduce((sum, skin) => sum + skin.cost, 0);
  profile.addSoldierPoints(total);

  let spent = 0;
  for (const skin of SKINS) {
    if (profile.isSkinUnlocked(skin.id)) continue;   // 'recruit' starts owned
    const result = profile.purchaseSkin(skin.id);
    assert.equal(result.ok, true, `${skin.name} could not be bought with enough points`);
    spent += skin.cost;
  }
  assert.equal(profile.soldierPoints, total - spent);
  assert.equal(profile.unlockedSkins.length, SKINS.length);

  // ... and the whole wardrobe survives a reload.
  const reloaded = new Profile(storage);
  assert.equal(reloaded.unlockedSkins.length, SKINS.length);
  assert.equal(reloaded.selectedSkin, SKINS[SKINS.length - 1].id);
});

test('the top skin is out of reach until it is earned', () => {
  const profile = new Profile(new MemoryStorage());
  const top = SKINS[SKINS.length - 1];
  assert.equal(top.cost, 1000000);
  profile.addSoldierPoints(top.cost - 1);
  assert.equal(profile.purchaseSkin(top.id).reason, 'not-enough-points');
  profile.addSoldierPoints(1);
  assert.equal(profile.purchaseSkin(top.id).ok, true);
  assert.equal(profile.soldierPoints, 0);
  assert.equal(profile.skin.id, top.id);
  assert.equal(profile.gems, CONFIG.economy.startingGems, 'skins must never touch gems');
});

test('the Soldier Point rate scales earnings without touching squad maths', () => {
  const base = new Profile(new MemoryStorage());
  const normal = new RunState(CONFIG, base);
  normal.addSoldiers(100);
  assert.equal(base.soldierPoints, 100, 'the default rate is one point per soldier');
  assert.equal(normal.squad, CONFIG.squad.startingSize + 100);

  const faster = JSON.parse(JSON.stringify(CONFIG));
  faster.economy.soldierPointRate = 8;
  const rich = new Profile(new MemoryStorage());
  const boosted = new RunState(faster, rich);
  boosted.addSoldiers(100);
  assert.equal(rich.soldierPoints, 800, 'the rate must scale points earned');
  assert.equal(boosted.squad, faster.squad.startingSize + 100, 'but never the squad itself');
  assert.ok(Number.isInteger(rich.soldierPoints));
});
