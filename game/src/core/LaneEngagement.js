/**
 * LaneEngagement.js -- the real-time form of the combat model.
 *
 * `CombatModel.resolveLaneStream` resolves a whole enemy stream analytically
 * (that is what makes the level simulator fast enough to validate thousands of
 * stages).  The live game needs the same maths stepped frame by frame, and
 * this class is it: same damage pool, same front-to-back targeting, same
 * carry-over of surplus damage, same "one contact costs one soldier" rule.
 *
 * tests/parity.test.mjs proves the two agree, which is what lets the simulator
 * promise a level is beatable (spec 51).
 */
import { CONFIG } from './Config.js';
import { squadDps } from './CombatModel.js';

/**
 * How far behind the squad an enemy may be and still count as a contact.
 * An enemy closes at ~22 m/s, so even a 20 fps frame advances it barely one
 * metre: anything deeper than this was never in the squad's lane.
 */
const PASSED_DEPTH = 2.5;

export class LaneEngagement {
  constructor (config = CONFIG) {
    this.config = config;
    this.damagePool = 0;
  }

  reset () {
    this.damagePool = 0;
  }

  /**
   * Advances the engagement by `dt` seconds.
   *
   * @param {object} params
   * @param {number} params.squadSize
   * @param {WeaponStats} params.weapon
   * @param {Array} params.enemies  enemies of the ENGAGED lane, nearest first,
   *                                each `{ hp, distance }` (metres ahead)
   * @param {function} params.onKill     called with the enemy that dies
   * @param {function} params.onContact  called with the enemy that reaches the squad
   * @returns {{kills:number, contacts:number, damage:number}}
   */
  step (params) {
    const { squadSize, weapon, enemies, dt } = params;
    const onKill = params.onKill || (() => {});
    const onContact = params.onContact || (() => {});
    const onPassed = params.onPassed || onContact;

    let kills = 0;
    let contacts = 0;
    let squad = squadSize;

    // 1. Contacts first: an enemy that has reached the squad is removed and
    //    costs exactly one soldier.  Damage invested in it is lost.
    //
    //    An enemy already well behind the squad ran past in a lane the squad
    //    was not standing in; swerving into that lane afterwards must not be
    //    punished for enemies that are, physically, already gone.
    while (enemies.length > 0 && enemies[0].distance <= 0) {
      const enemy = enemies.shift();
      if (enemy.distance <= -PASSED_DEPTH) {
        onPassed(enemy);
        continue;
      }
      contacts++;
      this.damagePool = 0;
      squad = Math.max(0, squad - this.config.combat.enemyContactSoldierLoss);
      onContact(enemy);
      if (squad <= 0) return { kills, contacts, damage: 0, squadAfter: 0 };
    }

    // 2. Only enemies inside weapon range are engaged.
    const range = weapon.range;
    let inRange = 0;
    while (inRange < enemies.length && enemies[inRange].distance <= range) inRange++;
    if (inRange === 0 || squad <= 0) {
      return { kills, contacts, damage: 0, squadAfter: squad };
    }

    // 3. Pour this frame's damage into the pool and spend it front-to-back.
    const damage = squadDps(squad, weapon, this.config) * dt;
    this.damagePool += damage;

    while (enemies.length > 0 && enemies[0].distance <= range && this.damagePool >= enemies[0].hp) {
      this.damagePool -= enemies[0].hp;
      const enemy = enemies.shift();
      kills++;
      onKill(enemy);
    }

    return { kills, contacts, damage, squadAfter: squad };
  }
}
