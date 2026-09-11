/**
 * Rng.js -- small, fast, seedable PRNG (mulberry32).
 *
 * A seedable generator is mandatory here: the level generator, the level
 * simulator and the automated stress test must be able to reproduce any
 * candidate level exactly when a validation failure needs investigating.
 */
export class Rng {
  constructor (seed = Date.now() >>> 0) {
    this.seed = seed >>> 0;
    this._state = this.seed;
  }

  /** Float in [0, 1). */
  next () {
    this._state = (this._state + 0x6D2B79F5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range (min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int (min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  pick (array) {
    return array[this.int(0, array.length - 1)];
  }

  /** True with probability p. */
  chance (p) {
    return this.next() < p;
  }

  shuffle (array) {
    const out = array.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  reset (seed = this.seed) {
    this.seed = seed >>> 0;
    this._state = this.seed;
  }
}
