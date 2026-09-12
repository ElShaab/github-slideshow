/**
 * GateManager.js -- the gates themselves (spec 7, 8, 34).
 *
 * A gate row is three side-by-side frames, one per lane, each carrying a big
 * readable label (+25, x3, :2, or a weapon icon).  When the squad crosses the
 * row, the gate in the squad's lane is applied -- and only that one.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';
import { GateType, gateLabel } from '../core/GateMath.js';
import { makeLabelTexture } from '../art/GeometryKit.js';

const GATE_COLORS = {
  [GateType.PLUS]: 0x3fbf6f,
  [GateType.MULTIPLY]: 0x2f8fd8,
  [GateType.MINUS]: 0xd9534f,
  [GateType.DIVIDE]: 0xb4503f,
  [GateType.WEAPON]: 0xf0a92b
};

export class GateManager {
  constructor (scene, lanes, vfx, config = CONFIG) {
    this.scene = scene;
    this.lanes = lanes;
    this.vfx = vfx;
    this.config = config;
    this.rows = [];
    this._labelCache = new Map();
  }

  clear () {
    for (const row of this.rows) this._disposeRow(row);
    this.rows.length = 0;
  }

  _disposeRow (row) {
    this.scene.remove(row.group);
    row.group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        // The label texture belongs to `_labelCache` and is shared by every
        // row showing the same value -- disposing it here would throw away a
        // texture that is about to be used again, defeating the cache.
        child.material.dispose();
      }
    });
  }

  /** Releases the cached label textures. Only for tearing the game down. */
  dispose () {
    this.clear();
    for (const texture of this._labelCache.values()) texture.dispose();
    this._labelCache.clear();
  }

  _labelTexture (text, color) {
    const key = `${text}|${color}`;
    if (!this._labelCache.has(key)) {
      this._labelCache.set(key, makeLabelTexture(text, {
        width: 320, height: 160, color: '#ffffff', stroke: '#0d1b26',
        font: 'bold 118px system-ui, "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
      }));
    }
    return this._labelCache.get(key);
  }

  /** Builds the three frames of one gate row at world z. */
  spawnRow (section, worldZ) {
    const group = new THREE.Group();
    group.position.z = worldZ;
    const panels = [];

    section.gateRow.gates.forEach((gate, lane) => {
      const color = GATE_COLORS[gate.type] || 0x888888;
      const x = this.lanes.laneX(lane);
      const frameMaterial = new THREE.MeshLambertMaterial({ color });

      // Posts + lintel: a readable doorway silhouette.
      const post = new THREE.BoxGeometry(0.22, 3.1, 0.22);
      const left = new THREE.Mesh(post, frameMaterial);
      left.position.set(x - 1.45, 1.55, 0);
      const right = new THREE.Mesh(post, frameMaterial);
      right.position.set(x + 1.45, 1.55, 0);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.12, 0.34, 0.26), frameMaterial);
      lintel.position.set(x, 3.05, 0);

      // Translucent curtain the squad runs through.
      const curtain = new THREE.Mesh(
        new THREE.PlaneGeometry(2.9, 2.8),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false
        })
      );
      curtain.position.set(x, 1.5, 0);

      // The label, drawn on a canvas texture so the weapon icons work too.
      // The plane is turned to face back down the road: the camera looks along
      // +z, so an untouched plane would show the player its back face.
      const text = gateLabel(gate);
      const sprite = new THREE.Mesh(
        new THREE.PlaneGeometry(2.7, 1.35),
        new THREE.MeshBasicMaterial({
          map: this._labelTexture(text, color), transparent: true, depthWrite: false
        })
      );
      sprite.position.set(x, 2.05, -0.08);
      sprite.rotation.y = Math.PI;

      group.add(left, right, lintel, curtain, sprite);
      panels.push({ curtain, sprite, lane, gate, color });
    });

    this.scene.add(group);
    const row = { group, panels, section, worldZ, triggered: false, time: 0 };
    this.rows.push(row);
    return row;
  }

  /**
   * Advances gate animations and fires the callback when the squad crosses a
   * row. Returns the gate that was applied, if any.
   */
  update (dt, squadZ, onCross) {
    let applied = null;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const row = this.rows[i];
      row.time += dt;

      const distance = row.worldZ - squadZ;
      // Use the lane the squad is VISIBLY in, not the one the last swipe aimed
      // at: a swipe registers instantly but the formation takes ~0.3s to slide
      // across, and awarding a gate the squad never ran through reads as the
      // game cheating.
      const visibleLane = this.lanes.laneAt(this.lanes.x);
      for (const panel of row.panels) {
        const highlighted = panel.lane === visibleLane && distance < 42;
        const pulse = 0.24 + (highlighted ? 0.22 + Math.sin(row.time * 7) * 0.08 : 0);
        panel.curtain.material.opacity = pulse;
        panel.sprite.scale.setScalar(highlighted ? 1.12 : 1);
      }

      if (!row.triggered && distance <= 0) {
        row.triggered = true;
        const panel = row.panels[visibleLane];
        this.vfx.addBurst(this.lanes.x, 1.4, row.worldZ, 1.6, panel.color);
        applied = { gate: panel.gate, lane: visibleLane, row };
        if (onCross) onCross(applied);
      }

      // Recycle rows the squad has left well behind.
      if (distance < -30) {
        this._disposeRow(row);
        this.rows.splice(i, 1);
      }
    }
    return applied;
  }
}
