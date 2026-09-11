/**
 * GateMath.js -- the exact arithmetic of gates (spec sections 9 and 56).
 *
 * These four operations are the contract between the UI, the gameplay and the
 * level simulator. They are pure functions with no dependencies so that the
 * automated tests can prove them directly.
 */

export const GateType = Object.freeze({
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  MULTIPLY: 'MULTIPLY',
  DIVIDE: 'DIVIDE',
  WEAPON: 'WEAPON'
});

export const WeaponStatKey = Object.freeze({
  FIRE_RATE: 'fireRate',
  DAMAGE: 'damage',
  RANGE: 'range',
  BULLETS: 'bullets',
  AREA: 'area'
});

export const WEAPON_STAT_ICONS = Object.freeze({
  fireRate: '⚡',  // lightning
  damage: '💥', // explosion
  range: '🎯',  // target
  bullets: '🔫', // gun
  area: '💣'     // bomb
});

export const WEAPON_STAT_LABELS = Object.freeze({
  fireRate: 'FIRE RATE',
  damage: 'DAMAGE',
  range: 'RANGE',
  bullets: 'MULTI-SHOT',
  area: 'AREA DAMAGE'
});

/**
 * Applies a gate to a squad count.
 * Guarantees: result is always a non-negative integer.
 *
 * @param {number} current  current squad size (integer >= 0)
 * @param {{type:string, value:number}} gate
 * @returns {number} new squad size
 */
export function applyGate (current, gate) {
  if (!Number.isInteger(current) || current < 0) {
    throw new RangeError(`applyGate: squad must be a non-negative integer, got ${current}`);
  }
  if (!gate || typeof gate.type !== 'string') {
    throw new TypeError('applyGate: gate must be an object with a type');
  }

  switch (gate.type) {
    case GateType.PLUS:
      return current + Math.trunc(gate.value);

    case GateType.MINUS:
      return Math.max(0, current - Math.trunc(gate.value));

    case GateType.MULTIPLY:
      return current * Math.trunc(gate.value);

    case GateType.DIVIDE: {
      const divisor = Math.trunc(gate.value);
      if (divisor <= 0) throw new RangeError('applyGate: divide gate needs a positive divisor');
      return Math.floor(current / divisor);
    }

    case GateType.WEAPON:
      return current; // weapon gates never change the squad size

    default:
      throw new RangeError(`applyGate: unknown gate type "${gate.type}"`);
  }
}

/**
 * Inverse of applyGate, used by the BACKWARD level generator: given the squad
 * size required after the gate, what is the smallest squad size required
 * before it?  Returns a non-negative integer, or null when the requirement is
 * unreachable through this gate (e.g. a divide gate can never raise a count).
 */
export function minimumInputFor (required, gate) {
  const need = Math.max(0, Math.ceil(required));
  // Nothing is required, so nothing is needed going in -- true for every gate
  // type, including MINUS (subtracting from zero still leaves zero).
  if (need === 0) return 0;

  switch (gate.type) {
    case GateType.PLUS:
      return Math.max(0, need - Math.trunc(gate.value));

    case GateType.MINUS:
      return need + Math.trunc(gate.value);

    case GateType.MULTIPLY: {
      const factor = Math.trunc(gate.value);
      if (factor <= 0) return null;
      return Math.ceil(need / factor);
    }

    case GateType.DIVIDE: {
      // floor(x / d) >= need  <=>  x >= need * d
      const divisor = Math.trunc(gate.value);
      if (divisor <= 0) return null;
      return need * divisor;
    }

    case GateType.WEAPON:
      return need;

    default:
      return null;
  }
}

/** Human-readable gate label, e.g. "+25", "x3", ":2", or a weapon icon. */
export function gateLabel (gate) {
  switch (gate.type) {
    case GateType.PLUS: return `+${Math.trunc(gate.value)}`;
    case GateType.MINUS: return `−${Math.trunc(gate.value)}`;
    case GateType.MULTIPLY: return `×${Math.trunc(gate.value)}`;
    case GateType.DIVIDE: return `÷${Math.trunc(gate.value)}`;
    case GateType.WEAPON: return WEAPON_STAT_ICONS[gate.stat] || '?';
    default: return '?';
  }
}

/** True when a gate is a valid, well-formed data object. */
export function isValidGate (gate) {
  if (!gate || typeof gate !== 'object') return false;
  switch (gate.type) {
    case GateType.PLUS:
    case GateType.MINUS:
      return Number.isInteger(gate.value) && gate.value > 0;
    case GateType.MULTIPLY:
      return Number.isInteger(gate.value) && gate.value >= 2;
    case GateType.DIVIDE:
      return Number.isInteger(gate.value) && gate.value >= 2;
    case GateType.WEAPON:
      return Object.values(WeaponStatKey).includes(gate.stat);
    default:
      return false;
  }
}
