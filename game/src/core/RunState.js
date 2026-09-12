/**
 * RunState.js -- everything that belongs to the CURRENT run (spec 29, 57).
 *
 * A run survives stage transitions untouched: squad, weapon, weapon stats and
 * stage number carry straight over.  Only death + "END RUN" clears it, and
 * even then lifetime Soldier Points and cosmetics are not part of this object,
 * so they cannot be reset by accident.
 */
import { CONFIG } from './Config.js';
import { WeaponStats } from './WeaponStats.js';
import { applyGate } from './GateMath.js';
import { combatPower } from './CombatModel.js';

export class RunState {
  constructor (config = CONFIG, profile = null) {
    this.config = config;
    this.profile = profile;     // optional Profile for lifetime Soldier Points
    this.reset();
  }

  /** Starts a brand new run. */
  reset () {
    this.squad = this.config.squad.startingSize;
    this.weapon = new WeaponStats(this.config);
    this.stage = 1;
    this.continues = 0;
    this.enemiesDefeated = 0;
    this.soldiersGainedThisRun = 0;
    this.soldiersLostThisRun = 0;
    this.startedAt = Date.now();
    this.alive = true;
    if (this.profile) this.profile.notifyRunStarted();
    return this;
  }

  /**
   * Adds soldiers.  Every NEWLY ACQUIRED soldier also counts towards lifetime
   * Soldier Points, which never decrease when soldiers are lost (spec 30).
   */
  addSoldiers (amount) {
    const gain = Math.max(0, Math.trunc(amount));
    if (gain === 0) return 0;
    this.squad += gain;
    this.soldiersGainedThisRun += gain;
    if (this.profile) {
      // The squad grows by whole soldiers; the points they are worth is a
      // separate, tunable rate so the skin ladder can be balanced without
      // touching gate maths.
      this.profile.addSoldierPoints(Math.round(gain * this.config.economy.soldierPointRate));
    }
    return gain;
  }

  /** Removes soldiers; the squad can never go below zero. */
  removeSoldiers (amount) {
    const loss = Math.min(this.squad, Math.max(0, Math.trunc(amount)));
    this.squad -= loss;
    this.soldiersLostThisRun += loss;
    if (this.squad <= 0) this.alive = false;
    return loss;
  }

  /** Sets the squad directly (gate maths, debug tools). */
  setSquad (value) {
    const next = Math.max(0, Math.trunc(value));
    if (next > this.squad) this.addSoldiers(next - this.squad);
    else this.removeSoldiers(this.squad - next);
    return this.squad;
  }

  /**
   * Puts soldiers back after a paid continue.
   *
   * These are NOT newly acquired soldiers, so they must not award lifetime
   * Soldier Points (spec 30): counting them would let a player mint the skin
   * currency by dying with a big squad and paying one gem, over and over.
   */
  restoreSoldiers (value) {
    this.squad = Math.max(0, Math.trunc(value));
    this.alive = this.squad > 0;
    return this.squad;
  }

  /**
   * Applies a gate. Squad-changing gates route through add/removeSoldiers so
   * lifetime Soldier Points stay correct; weapon gates upgrade the weapon.
   */
  applyGate (gate) {
    if (gate.type === 'WEAPON') {
      const upgraded = this.weapon.upgrade(gate.stat);
      return { squadBefore: this.squad, squadAfter: this.squad, stat: gate.stat, upgraded };
    }
    const before = this.squad;
    const after = applyGate(before, gate);
    this.setSquad(after);
    return { squadBefore: before, squadAfter: this.squad };
  }

  registerKills (count) {
    this.enemiesDefeated += Math.max(0, Math.trunc(count));
  }

  advanceStage () {
    this.stage += 1;
    return this.stage;
  }

  get power () {
    return combatPower(this.squad, this.weapon, this.config);
  }

  snapshot () {
    return {
      squad: this.squad,
      weapon: this.weapon.clone(),
      stage: this.stage,
      continues: this.continues,
      enemiesDefeated: this.enemiesDefeated
    };
  }

  /** Entry state object consumed by the generator and simulator. */
  toEntry () {
    return { squad: this.squad, weapon: this.weapon };
  }
}
