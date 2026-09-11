/**
 * InputManager.js -- swipe on touch, arrow keys / A-D / mouse drag elsewhere.
 *
 * Swipes are intentionally forgiving: a short, quick horizontal flick counts,
 * and a long drag past the threshold fires as soon as the threshold is passed
 * rather than on release, which is what makes lane changes feel instant.
 */
export class InputManager {
  constructor (element, config) {
    this.element = element;
    this.config = config;
    this.enabled = true;
    this.handlers = { move: [], pause: [], debug: [] };

    this._pointerActive = false;
    this._startX = 0;
    this._startY = 0;
    this._consumed = false;
    this._startTime = 0;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    element.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    element.addEventListener('pointermove', this._onPointerMove, { passive: true });
    element.addEventListener('pointerup', this._onPointerUp, { passive: true });
    element.addEventListener('pointercancel', this._onPointerUp, { passive: true });
    window.addEventListener('keydown', this._onKeyDown);
    // Stop the page itself from panning/zooming under the player's thumb.
    element.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  }

  on (event, handler) {
    if (this.handlers[event]) this.handlers[event].push(handler);
    return this;
  }

  _emit (event, payload) {
    if (!this.enabled) return;
    for (const handler of this.handlers[event] || []) handler(payload);
  }

  _onPointerDown (event) {
    this._pointerActive = true;
    this._consumed = false;
    this._startX = event.clientX;
    this._startY = event.clientY;
    this._startTime = performance.now();
  }

  _onPointerMove (event) {
    if (!this._pointerActive || this._consumed) return;
    const dx = event.clientX - this._startX;
    const dy = event.clientY - this._startY;
    if (Math.abs(dx) < this.config.lanes.swipeThresholdPx) return;
    if (Math.abs(dx) < Math.abs(dy) * 0.8) return;  // that was a vertical drag
    this._consumed = true;
    this._emit('move', Math.sign(dx));
  }

  _onPointerUp (event) {
    if (!this._pointerActive) return;
    this._pointerActive = false;
    if (this._consumed) return;
    // A quick flick that never crossed the threshold still counts.
    const dx = event.clientX - this._startX;
    const elapsed = performance.now() - this._startTime;
    if (elapsed < 260 && Math.abs(dx) > this.config.lanes.swipeThresholdPx * 0.55) {
      this._emit('move', Math.sign(dx));
    }
  }

  _onKeyDown (event) {
    switch (event.key) {
      case 'ArrowLeft': case 'a': case 'A':
        this._emit('move', -1); break;
      case 'ArrowRight': case 'd': case 'D':
        this._emit('move', 1); break;
      case 'Escape': case 'p': case 'P':
        this._emit('pause'); break;
      case 'F2':
        this._emit('debug'); break;
      default: break;
    }
  }

  dispose () {
    this.element.removeEventListener('pointerdown', this._onPointerDown);
    this.element.removeEventListener('pointermove', this._onPointerMove);
    this.element.removeEventListener('pointerup', this._onPointerUp);
    this.element.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
  }
}
