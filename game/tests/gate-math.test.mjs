import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGate, GateType, minimumInputFor, gateLabel, isValidGate } from '../src/core/GateMath.js';

test('spec: 25 / 2 = 12 (floor division, never 12.5)', () => {
  assert.equal(applyGate(25, { type: GateType.DIVIDE, value: 2 }), 12);
});

test('spec: 5 - 10 = 0 (never negative)', () => {
  assert.equal(applyGate(5, { type: GateType.MINUS, value: 10 }), 0);
});

test('spec: 10 x 3 = 30', () => {
  assert.equal(applyGate(10, { type: GateType.MULTIPLY, value: 3 }), 30);
});

test('spec: 20 + 25 = 45', () => {
  assert.equal(applyGate(20, { type: GateType.PLUS, value: 25 }), 45);
});

test('weapon gates never change the squad size', () => {
  assert.equal(applyGate(37, { type: GateType.WEAPON, stat: 'damage' }), 37);
});

test('squad is never negative and never fractional, over every gate', () => {
  const gates = [
    { type: GateType.PLUS, value: 25 },
    { type: GateType.MINUS, value: 999 },
    { type: GateType.MULTIPLY, value: 3 },
    { type: GateType.DIVIDE, value: 2 },
    { type: GateType.DIVIDE, value: 3 }
  ];
  for (let squad = 0; squad <= 200; squad++) {
    for (const gate of gates) {
      const result = applyGate(squad, gate);
      assert.ok(Number.isInteger(result), `fractional result ${result}`);
      assert.ok(result >= 0, `negative result ${result}`);
    }
  }
});

test('divide always floors', () => {
  for (const [value, divisor, expected] of [[25, 2, 12], [7, 2, 3], [1, 2, 0], [99, 3, 33], [100, 3, 33]]) {
    assert.equal(applyGate(value, { type: GateType.DIVIDE, value: divisor }), expected);
  }
});

test('applyGate rejects malformed input', () => {
  assert.throws(() => applyGate(-1, { type: GateType.PLUS, value: 1 }), RangeError);
  assert.throws(() => applyGate(1.5, { type: GateType.PLUS, value: 1 }), RangeError);
  assert.throws(() => applyGate(10, { type: 'NOPE', value: 1 }), RangeError);
  assert.throws(() => applyGate(10, { type: GateType.DIVIDE, value: 0 }), RangeError);
});

test('minimumInputFor is the exact inverse of applyGate', () => {
  const gates = [
    { type: GateType.PLUS, value: 25 },
    { type: GateType.MINUS, value: 7 },
    { type: GateType.MULTIPLY, value: 3 },
    { type: GateType.DIVIDE, value: 2 }
  ];
  for (const gate of gates) {
    for (let required = 0; required <= 120; required++) {
      const input = minimumInputFor(required, gate);
      assert.ok(Number.isInteger(input) && input >= 0);
      assert.ok(applyGate(input, gate) >= required,
        `${gate.type}(${gate.value}): input ${input} -> ${applyGate(input, gate)} < ${required}`);
      if (input > 0) {
        assert.ok(applyGate(input - 1, gate) < required,
          `${gate.type}(${gate.value}): ${input} is not minimal for ${required}`);
      }
    }
  }
});

test('gate labels are readable', () => {
  assert.equal(gateLabel({ type: GateType.PLUS, value: 25 }), '+25');
  assert.equal(gateLabel({ type: GateType.MULTIPLY, value: 3 }), '×3');
  assert.equal(gateLabel({ type: GateType.DIVIDE, value: 2 }), '÷2');
  assert.equal(gateLabel({ type: GateType.MINUS, value: 5 }), '−5');
  assert.equal(gateLabel({ type: GateType.WEAPON, stat: 'fireRate' }), '⚡');
});

test('gate validation rejects nonsense gates', () => {
  assert.equal(isValidGate({ type: GateType.MULTIPLY, value: 1 }), false);
  assert.equal(isValidGate({ type: GateType.DIVIDE, value: 1 }), false);
  assert.equal(isValidGate({ type: GateType.PLUS, value: 2.5 }), false);
  assert.equal(isValidGate({ type: GateType.WEAPON, stat: 'luck' }), false);
  assert.equal(isValidGate({ type: GateType.PLUS, value: 25 }), true);
});
