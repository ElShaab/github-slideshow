/**
 * WeaponSystem.js -- automatic soldier fire (spec 11, 14, 16).
 *
 * The player never aims.  Each frame the squad's whole damage output is poured
 * into the lane it occupies via LaneEngagement -- the same maths the level
 * simulator runs offline -- and the visuals (tracers, muzzle flashes, impacts)
 * are hung off the result.  Bullets are the presentation of the damage, not a
 * second, competing source of truth.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';
import { LaneEngagement } from '../core/LaneEngagement.js';
import { squadDps } from '../core/CombatModel.js';

export class WeaponSystem {
  constructor ({ squad, enemies, vfx, lanes, audio, config = CONFIG }) {
    this.squad = squad;
    this.enemies = enemies;
    this.vfx = vfx;
    this.lanes = lanes;
    this.audio = audio;
    this.config = config;
    this.engagement = new LaneEngagement(config);

    this.fireCooldown = 0;
    this.killsThisFrame = 0;
    this.contactsThisFrame = 0;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._tracerIndex = 0;
  }

  reset () {
    this.engagement.reset();
    this.fireCooldown = 0;
  }

  /**
   * @returns {{kills:number, contacts:number, squadAfter:number}}
   */
  update (dt, { squadSize, weapon, squadZ }) {
    this.killsThisFrame = 0;
    this.contactsThisFrame = 0;
    if (squadSize <= 0) return { kills: 0, contacts: 0, squadAfter: 0 };

    const lane = this.lanes.lane;
    const queue = this.enemies.engagedList(lane, squadZ);

    const result = this.engagement.step({
      dt,
      squadSize,
      weapon,
      enemies: queue,
      onKill: (enemy) => {
        this.enemies.kill(enemy);
        this.vfx.addImpact(enemy.x, 0.7 * enemy.scale, enemy.z, 3);
        this.killsThisFrame++;
      },
      onPassed: (enemy) => {
        // Ran past in another lane: no corpse, no cost.
        this.enemies.consume(enemy);
      },
      onContact: (enemy) => {
        this.enemies.consume(enemy);
        this.squad.flinch();
        this.vfx.addImpact(enemy.x, 0.6, enemy.z, 5);
        this.contactsThisFrame++;
      }
    });

    this._spawnVisuals(dt, { squadSize, weapon, squadZ, queue, result });
    return { kills: result.kills, contacts: result.contacts, squadAfter: result.squadAfter };
  }

  /**
   * Tracer/muzzle cadence follows the weapon's fire rate so an upgrade is
   * visible as well as felt, but the number of tracers is capped -- 300
   * soldiers do not need 300 bullets on screen to read as "a lot of fire".
   */
  _spawnVisuals (dt, { squadSize, weapon, squadZ, queue, result }) {
    if (!queue.length) return;
    const target = queue.find((enemy) => enemy.distance > 0 && enemy.distance <= weapon.range);
    if (!target) return;

    this.fireCooldown -= dt;
    const interval = 1 / Math.max(1, weapon.fireRate * 2);
    if (this.fireCooldown > 0) return;
    this.fireCooldown = interval;

    const shooters = Math.min(6, Math.max(1, Math.round(Math.sqrt(this.squad.rendered))));
    const bullets = Math.max(1, Math.min(4, Math.round(weapon.bullets)));
    for (let i = 0; i < shooters; i++) {
      this.squad.sampleFiringPosition(this._from, this._tracerIndex++);
      for (let b = 0; b < bullets; b++) {
        this._to.set(
          target.x + (Math.random() - 0.5) * 0.5 * b,
          0.6,
          target.z
        );
        this.vfx.addTracer(this._from, this._to);
      }
    }
    if (this.audio) this.audio.play('shoot', { rate: 0.9 + Math.random() * 0.2 });
  }

  /** Current damage output, surfaced by the debug overlay. */
  dps (squadSize, weapon) {
    return squadDps(squadSize, weapon, this.config);
  }
}
