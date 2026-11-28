/**
 * Which rendered frame a body is drawn with.
 *
 * The frames are renders of one model at a few body compositions. Picking the
 * nearest one regardless of how far away it is would quietly draw somebody
 * else's body — a 50% figure rendered at 30% is not an approximation, it is a
 * different person. So the selection has a tolerance, and outside it the app
 * falls back to a figure built from the user's own measurements.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FRAME_TOLERANCE,
  RENDERED_BANDS,
  nearestRenderedBand,
} from '../src/components/hologram/frames';

describe('choosing a rendered frame', () => {
  test('a band with a frame gets it', () => {
    for (const band of RENDERED_BANDS) {
      assert.equal(nearestRenderedBand(band), band, `band ${band} has a render but did not use it`);
    }
  });

  test('a band near a frame gets the nearest one', () => {
    const [lean] = RENDERED_BANDS;
    assert.notEqual(nearestRenderedBand(lean + 1), null);
    assert.notEqual(nearestRenderedBand(lean - 1), null);
  });

  test('a band far from every frame gets none', () => {
    // The procedural figure is a worse drawing of the right body. That is the
    // better trade, and this is the assertion that keeps it.
    const bands = RENDERED_BANDS;
    const farBelow = Math.min(...bands) - FRAME_TOLERANCE - 5;
    const farAbove = Math.max(...bands) + FRAME_TOLERANCE + 5;
    assert.equal(nearestRenderedBand(farBelow), null, `${farBelow}% should not borrow a render`);
    assert.equal(nearestRenderedBand(farAbove), null, `${farAbove}% should not borrow a render`);
  });

  test('the tolerance is the boundary, exactly', () => {
    const highest = Math.max(...RENDERED_BANDS);
    assert.notEqual(nearestRenderedBand(highest + FRAME_TOLERANCE), null);
    assert.equal(nearestRenderedBand(highest + FRAME_TOLERANCE + 1), null);
  });

  test('an assessment with no band gets no frame', () => {
    // Version 1 payloads predate banding. They still have to draw.
    assert.equal(nearestRenderedBand(undefined), null);
  });

  test('every rendered band is a real band', () => {
    for (const band of RENDERED_BANDS) {
      assert.equal(band % 5, 0, `${band} is not a 5-point band`);
    }
  });
});
