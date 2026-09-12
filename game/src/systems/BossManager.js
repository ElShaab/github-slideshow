/**
 * BossManager.js -- stage bosses (spec 17).
 *
 * A boss is one big body that walks at the squad, soaks the squad's damage
 * pool and, on contact, takes `contactLoss` soldiers before being knocked back
 * to re-approach.  The escort archetypes (HORDE, COMBO) release an unavoidable
 * three-lane stream first, spawned through the normal EnemyManager so the
 * escort obeys exactly the same combat rules as any other wave.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';
import { buildBoss } from '../art/CharacterFactory.js';
import { escortLaneSpawns } from '../core/CombatModel.js';

/** Bosses are drawn larger than their archetype scale so they loom. */
const BOSS_SCALE_DIVISOR = 1.9;

export const BossPhase = Object.freeze({
  IDLE: 'IDLE',
  ESCORT: 'ESCORT',
  FIGHT: 'FIGHT',
  DEFEATED: 'DEFEATED'
});

export class BossManager {
  constructor (scene, lanes, enemies, vfx, config = CONFIG) {
    this.scene = scene;
    this.lanes = lanes;
    this.enemies = enemies;
    this.vfx = vfx;
    this.config = config;

    this.phase = BossPhase.IDLE;
    this.boss = null;
    this.model = null;
    this.hp = 0;
    this.maxHp = 1;
    this.z = 0;
    this.contacts = 0;
    this.escortSpawned = false;
    this.hitFlash = 0;
    this.time = 0;
  }

  get active () { return this.phase === BossPhase.ESCORT || this.phase === BossPhase.FIGHT; }

  /** Prepares the encounter; the escort (if any) is released immediately. */
  start (boss, squadZ) {
    this.boss = boss;
    this.hp = boss.hp;
    this.maxHp = boss.hp;
    this.contacts = 0;
    this.time = 0;
    this.z = squadZ + 62;
    this.escortSpawned = false;

    this.model = buildBoss(boss.type);
    // Grounding blob, same trick the squad uses.
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.renderOrder = -1;
    this.model.add(shadow);
    this.model.scale.setScalar(boss.scale / BOSS_SCALE_DIVISOR);
    this.model.position.set(0, 0, this.z);
    this.model.rotation.y = Math.PI;
    this.scene.add(this.model);

    if (boss.escort && boss.escort.count > 0) {
      this.phase = BossPhase.ESCORT;
      // The model resolves the escort as `count` enemies in whichever lane the
      // squad stands in, so EVERY lane carries the full count.  Splitting the
      // escort across the lanes instead would make the live fight far easier
      // than the stage was certified for -- the escort is meant to be the one
      // part of a boss that cannot be dodged.
      const spawns = escortLaneSpawns(boss, this.config.lanes.count);
      spawns.forEach((count, lane) => {
        this.enemies.spawnLane(lane, {
          count,
          hp: boss.escort.hp,
          speed: boss.escort.speed,
          spacing: boss.escort.spacing,
          squadZ,
          lead: 46,
          scale: 1.1
        });
      });
    } else {
      this.phase = BossPhase.FIGHT;
    }
  }

  /**
   * @returns {{contacts:number, defeated:boolean}} soldiers lost this frame
   *          come from `contacts` x boss.contactLoss.
   */
  update (dt, { squadZ, squadSize, weapon, dps }) {
    if (!this.active) return { contacts: 0, defeated: false, soldiersLost: 0 };
    this.time += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    // The boss hangs back while ANY enemies are still on the road -- its own
    // escort, or the tail of the last wave of the stage.  The squad's damage
    // output is a single pool: if the boss took damage at the same time as a
    // wave, the squad would effectively fire twice, and the encounter would be
    // easier than the stage the simulator certified.
    if (this.phase === BossPhase.ESCORT || this.enemies.totalAlive > 0) {
      this.z = Math.max(squadZ + 40, this.z - this.boss.speed * dt * 0.2);
      if (this.enemies.totalAlive === 0) this.phase = BossPhase.FIGHT;
      this._pose(squadZ);
      return { contacts: 0, defeated: false, soldiersLost: 0 };
    }

    // Approach.
    const closing = this.config.squad.forwardSpeed + this.boss.speed;
    this.z -= this.boss.speed * dt;

    // The squad's damage lands on the boss once it is inside weapon range.
    const distance = this.z - squadZ;
    let soldiersLost = 0;
    let contacts = 0;
    if (distance <= weapon.range && squadSize > 0) {
      this.hp -= dps * dt;
      this.hitFlash = 0.08;
      if (Math.random() < dt * 18) {
        this.vfx.addImpact(this.model.position.x, 1.4 * this.boss.scale / BOSS_SCALE_DIVISOR, this.z, 2);
      }
    }

    if (this.hp <= 0) {
      this.phase = BossPhase.DEFEATED;
      this.vfx.addBurst(this.model.position.x, 1.6, this.z, 3.4, 0xffd166);
      this.vfx.addImpact(this.model.position.x, 1.6, this.z, 14);
      return { contacts: 0, defeated: true, soldiersLost: 0 };
    }

    if (distance <= 0.4) {
      // Contact: soldiers are lost and the boss is thrown back to re-approach.
      contacts = 1;
      this.contacts++;
      soldiersLost = this.boss.contactLoss;
      this.z = squadZ + Math.min(this.config.bosses.approachDistance, weapon.range);
      this.vfx.addBurst(this.lanes.x, 1.0, squadZ + 1, 2.0, 0xff5f5f);
    }

    this._pose(squadZ);
    return { contacts, defeated: false, soldiersLost, closing };
  }

  _pose (squadZ) {
    if (!this.model) return;
    const stomp = Math.abs(Math.sin(this.time * 6)) * 0.18;
    this.model.position.set(
      this.model.position.x * 0.9 + this.lanes.x * 0.1,
      stomp,
      this.z
    );
    this.model.rotation.z = Math.sin(this.time * 6) * 0.05;
    const flash = this.hitFlash > 0 ? 1.06 : 1;
    this.model.scale.setScalar((this.boss.scale / BOSS_SCALE_DIVISOR) * flash);
  }

  clear () {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((child) => {
        if (child.isMesh) { child.geometry.dispose(); child.material.dispose(); }
      });
      this.model = null;
    }
    this.phase = BossPhase.IDLE;
    this.boss = null;
  }

  get healthFraction () {
    return this.maxHp > 0 ? Math.max(0, this.hp / this.maxHp) : 0;
  }
}
