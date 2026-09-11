/**
 * VFXManager.js -- pooled, instanced effects (spec 40, 41).
 *
 * Three pools cover everything: tracers (thin stretched boxes), impact sparks
 * and pickup/gate bursts.  All three are instanced, so the effect budget costs
 * three draw calls no matter how busy the fight gets.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';

class InstancedPool {
  constructor (scene, geometry, material, capacity) {
    this.capacity = capacity;
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.items = [];
    this._matrix = new THREE.Matrix4();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._euler = new THREE.Euler();
  }

  spawn (item) {
    if (this.items.length >= this.capacity) this.items.shift();
    this.items.push(item);
  }

  clear () { this.items.length = 0; }

  dispose (scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class VFXManager {
  constructor (scene, config = CONFIG) {
    this.scene = scene;
    this.config = config;

    this.tracers = new InstancedPool(
      scene,
      new THREE.BoxGeometry(0.06, 0.06, 1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a3 }),
      config.render.maxProjectiles
    );
    this.sparks = new InstancedPool(
      scene,
      new THREE.TetrahedronGeometry(0.16, 0),
      new THREE.MeshBasicMaterial({ color: 0xff8b3d }),
      config.render.maxParticles
    );
    this.bursts = new InstancedPool(
      scene,
      new THREE.SphereGeometry(0.5, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x8ef2ff, transparent: true, opacity: 0.55 }),
      48
    );
  }

  /** A bullet streak from a soldier towards a target. */
  addTracer (from, to) {
    this.tracers.spawn({
      x: from.x, y: from.y, z: from.z,
      tx: to.x, ty: to.y, tz: to.z,
      life: 0.13, maxLife: 0.13
    });
  }

  /** Impact spray where an enemy died. */
  addImpact (x, y, z, count = 4, color = null) {
    for (let i = 0; i < count; i++) {
      this.sparks.spawn({
        x, y, z,
        vx: (Math.random() - 0.5) * 5,
        vy: 2 + Math.random() * 3.5,
        vz: (Math.random() - 0.5) * 5,
        spin: Math.random() * 8,
        life: 0.4 + Math.random() * 0.2,
        maxLife: 0.6
      });
    }
    if (color) this.sparks.mesh.material.color.setHex(color);
  }

  /** Expanding ring used by gates, pickups and boss deaths. */
  addBurst (x, y, z, scale = 1, color = 0x8ef2ff) {
    this.bursts.mesh.material.color.setHex(color);
    this.bursts.spawn({ x, y, z, scale, life: 0.45, maxLife: 0.45 });
  }

  update (dt) {
    this._updateTracers(dt);
    this._updateSparks(dt);
    this._updateBursts(dt);
  }

  _updateTracers (dt) {
    const pool = this.tracers;
    let index = 0;
    for (let i = pool.items.length - 1; i >= 0; i--) {
      const item = pool.items[i];
      item.life -= dt;
      if (item.life <= 0) { pool.items.splice(i, 1); continue; }
      const dx = item.tx - item.x;
      const dy = item.ty - item.y;
      const dz = item.tz - item.z;
      const length = Math.max(0.3, Math.hypot(dx, dy, dz));
      pool._position.set((item.x + item.tx) / 2, (item.y + item.ty) / 2, (item.z + item.tz) / 2);
      pool._quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(dx, dy, dz).normalize()
      );
      const fade = item.life / item.maxLife;
      pool._scale.set(fade, fade, length);
      pool._matrix.compose(pool._position, pool._quaternion, pool._scale);
      pool.mesh.setMatrixAt(index++, pool._matrix);
    }
    pool.mesh.count = index;
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  _updateSparks (dt) {
    const pool = this.sparks;
    let index = 0;
    for (let i = pool.items.length - 1; i >= 0; i--) {
      const item = pool.items[i];
      item.life -= dt;
      if (item.life <= 0) { pool.items.splice(i, 1); continue; }
      item.vy -= 14 * dt;
      item.x += item.vx * dt;
      item.y = Math.max(0.05, item.y + item.vy * dt);
      item.z += item.vz * dt;
      const fade = Math.max(0.05, item.life / item.maxLife);
      pool._position.set(item.x, item.y, item.z);
      pool._euler.set(item.spin * item.life, item.spin * item.life * 0.7, 0);
      pool._quaternion.setFromEuler(pool._euler);
      pool._scale.set(fade, fade, fade);
      pool._matrix.compose(pool._position, pool._quaternion, pool._scale);
      pool.mesh.setMatrixAt(index++, pool._matrix);
    }
    pool.mesh.count = index;
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  _updateBursts (dt) {
    const pool = this.bursts;
    let index = 0;
    for (let i = pool.items.length - 1; i >= 0; i--) {
      const item = pool.items[i];
      item.life -= dt;
      if (item.life <= 0) { pool.items.splice(i, 1); continue; }
      const t = 1 - item.life / item.maxLife;
      const scale = item.scale * (0.4 + t * 2.2);
      pool._position.set(item.x, item.y, item.z);
      pool._quaternion.identity();
      pool._scale.set(scale, scale * 0.6, scale);
      pool._matrix.compose(pool._position, pool._quaternion, pool._scale);
      pool.mesh.setMatrixAt(index++, pool._matrix);
    }
    pool.mesh.count = index;
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.mesh.material.opacity = 0.55;
  }

  clear () {
    this.tracers.clear();
    this.sparks.clear();
    this.bursts.clear();
  }

  dispose () {
    this.tracers.dispose(this.scene);
    this.sparks.dispose(this.scene);
    this.bursts.dispose(this.scene);
  }
}
