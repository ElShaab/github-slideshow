/**
 * SquadManager.js -- the squad on screen (spec 4, 5, 6).
 *
 * Draws up to `maxRendered` soldiers with ONE InstancedMesh (the whole squad
 * is a single draw call) and animates them procedurally: a run bob, a forward
 * lean and a lean into lane changes.  Squad SIZE is owned by RunState; this
 * class only mirrors it, which is why a squad of 5,000 is still cheap -- the
 * extra soldiers exist in the maths, not in the scene graph.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';
import { FormationManager } from './FormationManager.js';
import { buildSoldierGeometry } from '../art/CharacterFactory.js';
import { toonMaterial } from '../art/GeometryKit.js';

export class SquadManager {
  constructor (scene, laneController, config = CONFIG) {
    this.scene = scene;
    this.lanes = laneController;
    this.config = config;
    this.formation = new FormationManager(config);

    this.count = 0;
    this.z = 0;
    this.runTime = 0;
    this.weaponTier = 0;
    this.colors = null;
    this.mesh = null;
    this._matrix = new THREE.Matrix4();
    this._quaternion = new THREE.Quaternion();
    this._position = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._tightness = 1;
    this._euler = new THREE.Euler();
    this._firingFlash = 0;
  }

  /** Builds (or rebuilds) the instanced soldier mesh for a skin / weapon tier. */
  setAppearance (colors, weaponTier = 0) {
    if (this.mesh && this.colors === colors && this.weaponTier === weaponTier) return;
    this.colors = colors;
    this.weaponTier = weaponTier;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
    }
    const geometry = buildSoldierGeometry(colors, weaponTier);
    const material = toonMaterial();
    this._ensureShadow();
    this.mesh = new THREE.InstancedMesh(geometry, material, this.config.squad.maxRendered);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }

  /**
   * A single soft blob under the formation.  One transparent plane grounds the
   * whole squad far more cheaply than real shadow mapping, which is not worth
   * its cost on a phone for a top-down-ish camera.
   */
  _ensureShadow () {
    if (this.shadow) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(0,0,0,0.5)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.015;
    this.shadow.renderOrder = -1;
    this.scene.add(this.shadow);
  }

  setCount (count) {
    this.count = Math.max(0, Math.trunc(count));
  }

  /** Called when the squad takes a hit, for a quick flinch. */
  flinch () {
    this._firingFlash = 0.18;
  }

  get rendered () {
    return Math.min(this.count, this.config.squad.maxRendered);
  }

  /** World position of the formation's front-centre -- where enemies land. */
  get frontZ () { return this.z; }

  update (dt) {
    if (!this.mesh) return;
    this.runTime += dt;
    this._firingFlash = Math.max(0, this._firingFlash - dt);

    const rendered = this.rendered;
    const slots = this.formation.build(rendered);
    this.mesh.count = rendered;
    if (rendered === 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      return;
    }

    const lean = this.lanes.leanAmount;
    // As the formation tightens, soldiers shrink a little so a large squad
    // stays a readable crowd instead of merging into one dark mass.
    const tightness = Math.min(1, Math.max(0.68,
      this.formation.spacing / this.config.squad.minSpacing));
    this._scale.set(tightness, tightness, tightness);
    const flinch = this._firingFlash > 0 ? Math.sin(this._firingFlash * 40) * 0.05 : 0;
    // Compress the run cycle a little for big squads so it reads as a crowd
    // rather than a single marching animation.
    const cycle = 13.5;

    for (let i = 0; i < rendered; i++) {
      const slot = slots[i];
      const phase = slot.phase + this.runTime * cycle;
      const bob = Math.abs(Math.sin(phase)) * 0.12;
      const roll = Math.sin(phase) * 0.06;

      this._position.set(
        this.lanes.x + slot.x,
        bob + flinch,
        this.z + slot.z
      );
      this._euler.set(-0.06 - bob * 0.3, lean * 0.22, roll - lean * 0.28);
      this._quaternion.setFromEuler(this._euler);
      this._matrix.compose(this._position, this._quaternion, this._scale);
      this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    if (this.shadow) {
      this.shadow.visible = rendered > 0;
      this.shadow.position.set(this.lanes.x, 0.015, this.z - this.formation.depth / 2);
      this.shadow.scale.set(
        this.formation.width + 1.6,
        this.formation.depth + 1.6,
        1
      );
    }
  }

  /** A muzzle origin for the weapon system's tracers. */
  sampleFiringPosition (target, index = 0) {
    const slots = this.formation.slots;
    if (!slots.length) {
      target.set(this.lanes.x, 0.65, this.z);
      return target;
    }
    const slot = slots[index % slots.length];
    target.set(this.lanes.x + slot.x + 0.26, 0.66, this.z + slot.z + 0.4);
    return target;
  }

  dispose () {
    if (this.shadow) {
      this.scene.remove(this.shadow);
      this.shadow.geometry.dispose();
      this.shadow.material.map.dispose();
      this.shadow.material.dispose();
      this.shadow = null;
    }
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh = null;
  }
}
