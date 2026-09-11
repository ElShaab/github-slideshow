/**
 * CameraController.js -- elevated third-person chase camera (spec 3).
 *
 * Everything is configurable (distance, height, FOV, follow speed) and tuned
 * for READABILITY first: all three lanes always visible, gates legible while
 * still far away, and only a whisper of shake so the picture never smears.
 */
import * as THREE from '../../vendor/three.module.min.js';
import { CONFIG } from '../core/Config.js';

export class CameraController {
  constructor (camera, lanes, config = CONFIG) {
    this.camera = camera;
    this.lanes = lanes;
    this.config = config;
    this.shake = 0;
    this._target = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this.camera.fov = config.camera.fov;
    this.camera.updateProjectionMatrix();
    this.zoom = 1;
  }

  addShake (amount) {
    this.shake = Math.min(this.config.camera.maxShake, this.shake + amount);
  }

  /** Pulls back a little during boss fights so the boss fits in frame. */
  setZoom (zoom) {
    this.zoom = zoom;
  }

  snapTo (squadZ) {
    const cfg = this.config.camera;
    this.camera.position.set(this.lanes.x * cfg.lateralFollow, cfg.height, squadZ - cfg.distance);
    this._lookAt.set(this.lanes.x * cfg.lateralFollow, 1.2, squadZ + cfg.lookAhead);
    this.camera.lookAt(this._lookAt);
  }

  update (dt, squadZ) {
    const cfg = this.config.camera;
    const follow = 1 - Math.exp(-cfg.followSpeed * dt);   // frame-rate independent

    this._target.set(
      this.lanes.x * cfg.lateralFollow,
      cfg.height * this.zoom,
      squadZ - cfg.distance * this.zoom
    );
    this.camera.position.lerp(this._target, follow);

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * this.config.camera.shakeDamping);
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }

    this._lookAt.set(
      this.lanes.x * cfg.lateralFollow * 0.8,
      1.2,
      squadZ + cfg.lookAhead
    );
    this.camera.lookAt(this._lookAt);
  }
}
