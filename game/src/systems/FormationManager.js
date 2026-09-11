/**
 * FormationManager.js -- where each soldier stands (spec 5).
 *
 * The squad must READ as a group: a block spread across the lane, never a
 * single file.  Slots are laid out on a grid that is recomputed only when the
 * squad size changes, and the spacing shrinks as the squad grows so a
 * 300-strong squad still fits inside its lane without turning into a smear.
 */
import { CONFIG } from '../core/Config.js';

export class FormationManager {
  constructor (config = CONFIG) {
    this.config = config;
    this.slots = [];       // [{x, z, phase}]
    this.lastCount = -1;
    this.columns = 1;
    this.rows = 1;
    this.spacing = config.squad.minSpacing;
  }

  /**
   * Rebuilds the slot layout for `count` soldiers.
   * Deterministic: the same count always produces the same shape, so soldiers
   * do not jitter around when one dies.
   */
  build (count) {
    if (count === this.lastCount) return this.slots;
    this.lastCount = count;
    this.slots.length = 0;
    if (count <= 0) return this.slots;

    const { formationMaxWidth: width, formationMaxDepth: depth, minSpacing } = this.config.squad;

    // Spacing that spreads `count` soldiers over the available footprint,
    // clamped so small squads stay loose and big ones stay inside the lane.
    let spacing = Math.sqrt((width * depth) / count);
    spacing = Math.min(minSpacing, Math.max(0.17, spacing));
    let columns = Math.max(1, Math.min(26, Math.floor(width / spacing) + 1));
    let rows = Math.ceil(count / columns);
    if (rows * spacing > depth) {
      // Too deep: add columns (the formation bulges sideways a little) and
      // tighten up until it fits.
      columns = Math.max(columns, Math.ceil(count / Math.max(1, Math.floor(depth / spacing))));
      columns = Math.min(columns, 34);
      rows = Math.ceil(count / columns);
      spacing = Math.min(spacing, depth / Math.max(1, rows));
    }

    this.columns = columns;
    this.rows = rows;
    this.spacing = spacing;

    const rowWidth = (columns - 1) * spacing;
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / columns);
      const column = i % columns;
      // Offset alternate rows so the block looks organic rather than gridded.
      const stagger = (row % 2) * spacing * 0.5;
      const jitterX = (pseudoRandom(i * 2 + 1) - 0.5) * spacing * 0.35;
      const jitterZ = (pseudoRandom(i * 2 + 2) - 0.5) * spacing * 0.35;
      this.slots.push({
        x: -rowWidth / 2 + column * spacing + stagger + jitterX - (stagger ? spacing * 0.25 : 0),
        z: -row * spacing + jitterZ,
        phase: pseudoRandom(i * 7 + 3) * Math.PI * 2
      });
    }
    return this.slots;
  }

  get width () { return (this.columns - 1) * this.spacing; }
  get depth () { return (this.rows - 1) * this.spacing; }
}

/** Deterministic per-index noise so formations never shimmer between frames. */
function pseudoRandom (seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
