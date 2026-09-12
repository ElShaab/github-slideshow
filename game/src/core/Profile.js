/**
 * Profile.js -- permanent progression (spec 29, 30, 31, 44).
 *
 * Holds everything that MUST survive death: gems, lifetime Soldier Points,
 * purchased skins, the selected skin and settings.  Temporary run progression
 * deliberately lives in RunState instead, so "END RUN" cannot touch this.
 *
 * Storage is injected (localStorage in the browser, a plain object in tests),
 * which keeps the module free of platform assumptions.
 */
import { CONFIG } from './Config.js';
import { SKINS, getSkin } from './SkinCatalog.js';

const STORAGE_KEY = 'army-runner.profile.v1';
const SAVE_VERSION = 1;

/** Minimal in-memory storage, used by tests and as a browser fallback. */
export class MemoryStorage {
  constructor () { this.map = new Map(); }
  getItem (key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem (key, value) { this.map.set(key, String(value)); }
  removeItem (key) { this.map.delete(key); }
}

export class Profile {
  constructor (storage = new MemoryStorage(), config = CONFIG) {
    this.storage = storage;
    this.config = config;
    this.gems = config.economy.startingGems;
    this.soldierPoints = 0;       // lifetime, never decreases
    this.lifetimeSoldiersLost = 0;
    this.unlockedSkins = ['recruit'];
    this.selectedSkin = 'recruit';
    this.bestStage = 1;
    this.runsPlayed = 0;
    this.settings = { audio: true, haptics: true };
    this.load();
  }

  /* ------------------------------------------------------- soldier points */

  /** Lifetime Soldier Points only ever go up (spec 30). */
  addSoldierPoints (amount) {
    const gain = Math.max(0, Math.trunc(amount));
    if (gain === 0) return this.soldierPoints;
    this.soldierPoints += gain;
    this.save();
    return this.soldierPoints;
  }

  notifyRunStarted () {
    this.runsPlayed += 1;
    this.save();
  }

  notifyStageReached (stage) {
    if (stage > this.bestStage) {
      this.bestStage = stage;
      this.save();
    }
  }

  /* ---------------------------------------------------------------- skins */

  isSkinUnlocked (id) { return this.unlockedSkins.includes(id); }

  /** Buys a skin with lifetime Soldier Points. Cosmetic only. */
  purchaseSkin (id) {
    const skin = SKINS.find((entry) => entry.id === id);
    if (!skin) return { ok: false, reason: 'unknown-skin' };
    if (this.isSkinUnlocked(id)) return { ok: false, reason: 'already-owned' };
    if (this.soldierPoints < skin.cost) return { ok: false, reason: 'not-enough-points' };
    this.soldierPoints -= skin.cost;
    this.unlockedSkins.push(id);
    this.selectedSkin = id;
    this.save();
    return { ok: true, skin };
  }

  selectSkin (id) {
    if (!this.isSkinUnlocked(id)) return false;
    this.selectedSkin = id;
    this.save();
    return true;
  }

  get skin () { return getSkin(this.selectedSkin); }

  /* -------------------------------------------------------------- storage */

  toJSON () {
    return {
      version: SAVE_VERSION,
      gems: this.gems,
      soldierPoints: this.soldierPoints,
      lifetimeSoldiersLost: this.lifetimeSoldiersLost,
      unlockedSkins: this.unlockedSkins,
      selectedSkin: this.selectedSkin,
      bestStage: this.bestStage,
      runsPlayed: this.runsPlayed,
      settings: this.settings
    };
  }

  save () {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
      return true;
    } catch (error) {
      // A full or unavailable storage must never break a run.
      console.warn('Profile: save failed', error);
      return false;
    }
  }

  load () {
    let raw = null;
    try {
      raw = this.storage.getItem(STORAGE_KEY);
    } catch (error) {
      console.warn('Profile: load failed', error);
      return false;
    }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== SAVE_VERSION) return false;
      // Clamped like every other saved number: a negative or fractional
      // balance would persist and lock the player out of continues forever.
      this.gems = Number.isFinite(data.gems) ? Math.max(0, Math.trunc(data.gems)) : this.gems;
      this.soldierPoints = Math.max(0, Math.trunc(data.soldierPoints || 0));
      this.lifetimeSoldiersLost = Math.max(0, Math.trunc(data.lifetimeSoldiersLost || 0));
      this.unlockedSkins = Array.isArray(data.unlockedSkins) && data.unlockedSkins.length
        ? data.unlockedSkins.filter((id) => SKINS.some((skin) => skin.id === id))
        : ['recruit'];
      this.selectedSkin = this.isSkinUnlocked(data.selectedSkin) ? data.selectedSkin : 'recruit';
      this.bestStage = Math.max(1, Math.trunc(data.bestStage || 1));
      this.runsPlayed = Math.max(0, Math.trunc(data.runsPlayed || 0));
      this.settings = { ...this.settings, ...(data.settings || {}) };
      return true;
    } catch (error) {
      console.warn('Profile: corrupt save discarded', error);
      return false;
    }
  }

  /** Wipes permanent progression -- debug tooling only. */
  hardReset () {
    this.gems = this.config.economy.startingGems;
    this.soldierPoints = 0;
    this.unlockedSkins = ['recruit'];
    this.selectedSkin = 'recruit';
    this.bestStage = 1;
    this.runsPlayed = 0;
    this.save();
  }
}
