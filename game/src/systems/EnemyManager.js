/**
 * EnemyManager.js -- enemy waves, pooling and instanced rendering (spec 10-13).
 *
 * Enemies RUN at the squad and never shoot.  They live in per-lane queues
 * ordered front-to-back, which is exactly the order the combat model consumes
 * them in, so the live fight and the simulated fight see the same enemy at the
 * same moment.
 *
 * Every enemy is one instance of a shared geometry: a 300-strong wave is a
 * single draw call, and dead enemies return to a pool instead of being
 * allocated again.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';
import { buildEnemyGeometry } from '../art/CharacterFactory.js';
import { toonMaterial } from '../art/GeometryKit.js';

const DEATH_TIME = 0.45;
const DESPAWN_BEHIND = 10;   // metres behind the squad before an enemy is retired

export class EnemyManager {
  constructor (scene, laneController, config = CONFIG) {
    this.scene = scene;
    this.lanes = laneController;
    this.config = config;

    /** @type {Array<Array<object>>} live enemies per lane, nearest first */
    this.laneQueues = Array.from({ length: config.lanes.count }, () => []);
    /** enemies playing their death animation */
    this.dying = [];
    this.pool = [];
    this.time = 0;

    const geometry = buildEnemyGeometry();
    this.mesh = new THREE.InstancedMesh(geometry, toonMaterial(), config.render.maxEnemiesRendered);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    this._matrix = new THREE.Matrix4();
    this._quaternion = new THREE.Quaternion();
    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._euler = new THREE.Euler();
  }

  get totalAlive () {
    let total = 0;
    for (const queue of this.laneQueues) total += queue.length;
    return total;
  }

  _acquire () {
    return this.pool.pop() || {
      lane: 0, x: 0, z: 0, hp: 1, speed: 0, phase: 0, scale: 1, dying: 0
    };
  }

  /**
   * Spawns one lane of a wave.  Enemies are placed `spacing` metres apart
   * starting `lead` metres ahead of the squad, which reproduces the arrival
   * cadence the combat model assumes.
   */
  spawnLane (lane, { count, hp, speed, spacing, squadZ, lead, scale = 1 }) {
    const queue = this.laneQueues[lane];
    for (let i = 0; i < count; i++) {
      const enemy = this._acquire();
      enemy.lane = lane;
      enemy.hp = hp;
      enemy.speed = speed;
      enemy.scale = scale;
      enemy.dying = 0;
      enemy.phase = Math.random() * Math.PI * 2;
      enemy.z = squadZ + lead + i * spacing;
      enemy.x = this.lanes.laneX(lane) + (Math.random() - 0.5) * this.config.enemies.laneJitter;
      queue.push(enemy);
    }
    // Nearest first: the order the combat model consumes them in.
    queue.sort((a, b) => a.z - b.z);
  }

  /** Distance-from-squad view of a lane, consumed by the weapon system. */
  engagedList (lane, squadZ) {
    const queue = this.laneQueues[lane];
    for (const enemy of queue) enemy.distance = enemy.z - squadZ;
    return queue;
  }

  /** Starts the death animation and returns the enemy to the pool afterwards. */
  kill (enemy) {
    enemy.dying = DEATH_TIME;
    this.dying.push(enemy);
  }

  /** Removes an enemy that reached the squad -- no corpse, it is absorbed. */
  consume (enemy) {
    this.pool.push(enemy);
  }

  clear () {
    for (const queue of this.laneQueues) {
      for (const enemy of queue) this.pool.push(enemy);
      queue.length = 0;
    }
    this.dying.length = 0;
  }

  update (dt, squadZ) {
    this.time += dt;

    // Advance the runners, and retire the ones that have run past the squad.
    // Enemies in a lane the squad dodged would otherwise pile up forever --
    // they never reach anyone, so nothing would ever remove them.
    // The engaged lane is resolved by the weapon system before this runs, so
    // an enemy is only culled here after it has already been counted as a
    // contact (or was never in the squad's lane to begin with).
    for (const queue of this.laneQueues) {
      let survivors = 0;
      for (let i = 0; i < queue.length; i++) {
        const enemy = queue[i];
        enemy.z -= enemy.speed * dt;
        if (enemy.z < squadZ - DESPAWN_BEHIND) {
          this.pool.push(enemy);
          continue;
        }
        queue[survivors++] = enemy;
      }
      queue.length = survivors;
    }

    // Death animations.
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const enemy = this.dying[i];
      enemy.dying -= dt;
      enemy.z -= enemy.speed * dt * 0.25;
      if (enemy.dying <= 0) {
        this.dying.splice(i, 1);
        this.pool.push(enemy);
      }
    }

    this._render(squadZ);
  }

  _render (squadZ) {
    let index = 0;
    const limit = this.config.render.maxEnemiesRendered;
    const drawDistance = this.config.render.drawDistance;

    for (const queue of this.laneQueues) {
      for (const enemy of queue) {
        if (index >= limit) break;
        const ahead = enemy.z - squadZ;
        if (ahead > drawDistance || ahead < -14) continue;
        const phase = enemy.phase + this.time * 15;
        const bob = Math.abs(Math.sin(phase)) * 0.13;
        this._position.set(enemy.x, bob, enemy.z);
        this._euler.set(0.1 + bob * 0.4, Math.PI + Math.sin(phase) * 0.08, Math.sin(phase) * 0.09);
        this._quaternion.setFromEuler(this._euler);
        this._scale.set(enemy.scale, enemy.scale, enemy.scale);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.mesh.setMatrixAt(index++, this._matrix);
      }
    }

    for (const enemy of this.dying) {
      if (index >= limit) break;
      const t = 1 - enemy.dying / DEATH_TIME;
      const scale = enemy.scale * Math.max(0.01, 1 - t);
      this._position.set(enemy.x, 0.1 * (1 - t), enemy.z);
      this._euler.set(-t * 1.4, Math.PI, t * 0.9);
      this._quaternion.setFromEuler(this._euler);
      this._scale.set(scale, scale, scale);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.mesh.setMatrixAt(index++, this._matrix);
    }

    this.mesh.count = index;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose () {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
