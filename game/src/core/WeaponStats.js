/**
 * WeaponStats.js -- the player's weapon, expressed purely as data.
 *
 * The visual weapon tier (pistol -> SMG -> rifle) is derived from the stat
 * levels; it never drives combat behaviour (spec section 15).
 */
import { CONFIG } from './Config.js';
import { WeaponStatKey, WEAPON_STAT_ICONS, WEAPON_STAT_LABELS } from './GateMath.js';

export const WEAPON_STATS = Object.freeze(Object.values(WeaponStatKey));

export class WeaponStats {
  constructor (config = CONFIG) {
    this.config = config;
    this.levels = { fireRate: 0, damage: 0, range: 0, bullets: 0, area: 0 };
  }

  static fromLevels (levels, config = CONFIG) {
    const stats = new WeaponStats(config);
    for (const key of WEAPON_STATS) stats.levels[key] = levels[key] | 0;
    return stats;
  }

  clone () {
    return WeaponStats.fromLevels(this.levels, this.config);
  }

  reset () {
    for (const key of WEAPON_STATS) this.levels[key] = 0;
    return this;
  }

  /** Adds one upgrade level to a stat. Returns false when already maxed. */
  upgrade (stat, amount = 1) {
    if (!WEAPON_STATS.includes(stat)) throw new RangeError(`unknown weapon stat "${stat}"`);
    const max = this.config.weapons.maxLevelPerStat;
    if (this.levels[stat] >= max) return false;
    this.levels[stat] = Math.min(max, this.levels[stat] + amount);
    return true;
  }

  /** Multiplicative factor for a stat: 1 + level * increment. */
  factor (stat) {
    return 1 + this.levels[stat] * this.config.weapons.increments[stat];
  }

  get fireRate () { return this.config.weapons.base.fireRate * this.factor('fireRate'); }
  get damage () { return this.config.weapons.base.damage * this.factor('damage'); }
  get range () { return this.config.weapons.base.range * this.factor('range'); }
  get bullets () { return this.config.weapons.base.bullets * this.factor('bullets'); }
  get area () { return this.config.weapons.base.area * this.factor('area'); }

  /** Number of visible bullets per shot (always at least one). */
  get bulletCount () { return Math.max(1, Math.round(this.bullets)); }

  get totalLevels () {
    return WEAPON_STATS.reduce((sum, key) => sum + this.levels[key], 0);
  }

  /** Cosmetic tier name derived from total upgrades. */
  get tierName () {
    const tiers = this.config.weapons.visualTiers;
    let name = tiers[0].name;
    for (const tier of tiers) if (this.totalLevels >= tier.minLevels) name = tier.name;
    return name;
  }

  get tierIndex () {
    const tiers = this.config.weapons.visualTiers;
    let index = 0;
    for (let i = 0; i < tiers.length; i++) if (this.totalLevels >= tiers[i].minLevels) index = i;
    return index;
  }

  /** Product of every weapon factor -- the weapon half of combat power. */
  get powerMultiplier () {
    return WEAPON_STATS.reduce((product, key) => product * this.factor(key), 1);
  }

  iconFor (stat) { return WEAPON_STAT_ICONS[stat]; }
  labelFor (stat) { return WEAPON_STAT_LABELS[stat]; }

  toJSON () { return { ...this.levels }; }
}
