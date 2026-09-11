/**
 * LaneController.js -- three lanes, and nothing but three lanes (spec 2).
 *
 * Holds the squad's lane index and the smoothed lateral position the whole
 * formation is drawn around.  Swipes and arrow keys move the ENTIRE squad; no
 * individual soldier is ever controlled.
 */
import { CONFIG } from '../core/Config.js';

export class LaneController {
  constructor (config = CONFIG) {
    this.config = config;
    this.laneCount = config.lanes.count;
    this.lane = 1;                 // 0 = LEFT, 1 = CENTER, 2 = RIGHT
    this.x = this.laneX(this.lane);
    this.targetX = this.x;
    this.lastMoveDirection = 0;
  }

  /**
   * World x of a lane centre.
   *
   * The squad runs towards +z with the camera behind it, so the camera's
   * right-hand direction is world -x: lane 0 (LEFT on screen for the player)
   * therefore sits at POSITIVE x.  Getting this backwards silently inverts
   * every swipe, so the mapping lives in exactly one place.
   */
  laneX (lane) {
    const middle = (this.laneCount - 1) / 2;
    return (middle - lane) * this.config.lanes.width;
  }

  /** Nearest lane index for a world x (used by enemies and debug tools). */
  laneAt (x) {
    const middle = (this.laneCount - 1) / 2;
    const lane = Math.round(middle - x / this.config.lanes.width);
    return Math.min(this.laneCount - 1, Math.max(0, lane));
  }

  move (direction) {
    const next = Math.min(this.laneCount - 1, Math.max(0, this.lane + Math.sign(direction)));
    if (next === this.lane) return false;
    this.lane = next;
    this.targetX = this.laneX(next);
    this.lastMoveDirection = Math.sign(direction);
    return true;
  }

  setLane (lane) {
    this.lane = Math.min(this.laneCount - 1, Math.max(0, Math.round(lane)));
    this.targetX = this.laneX(this.lane);
  }

  reset () {
    this.setLane(1);
    this.x = this.targetX;
  }

  update (dt) {
    const speed = this.config.lanes.switchSpeed;
    const delta = this.targetX - this.x;
    const step = speed * dt;
    if (Math.abs(delta) <= step) {
      this.x = this.targetX;
      this.lastMoveDirection = 0;
    } else {
      this.x += Math.sign(delta) * step;
    }
    return this.x;
  }

  /** How far through a lane change we are, for the formation lean. */
  get leanAmount () {
    const delta = this.targetX - this.x;
    return Math.max(-1, Math.min(1, delta / this.config.lanes.width));
  }
}
