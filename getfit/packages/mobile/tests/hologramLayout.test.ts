/**
 * The figure stays inside its own box.
 *
 * Build 10's Home card showed a disembodied head in the bottom-right corner
 * and an empty space where the body should have been. The rendered frames are
 * 640x1280 PNGs; a React Native `<Image>` takes that as its intrinsic size,
 * and `StyleSheet.absoluteFill` — insets with no dimensions — did not override
 * it. The figure drew at 640x1280 *points* from the top-left of a box 137
 * points wide, so the card clipped everything but one corner of it.
 *
 * These assertions are about arithmetic rather than pixels, because the viewer
 * cannot be rendered outside Metro. What they pin down is the property that
 * was violated: whatever the box and whatever the artwork, the drawn figure
 * fits inside the box.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FRAME_ASPECT,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  containedBox,
  viewerBox,
} from '../src/components/hologram/layout';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../src/components/hologram/geometry';

describe('the viewer box', () => {
  test('is the height asked for', () => {
    assert.equal(viewerBox(240, VIEW_WIDTH, VIEW_HEIGHT).height, 240);
  });

  test('takes its width from the figure, not the caller', () => {
    // Callers size the hologram against the text beside it, which is a height.
    const box = viewerBox(240, VIEW_WIDTH, VIEW_HEIGHT);
    assert.equal(box.width, (240 * VIEW_WIDTH) / VIEW_HEIGHT);
    assert.ok(box.width < box.height, 'a standing figure is taller than it is wide');
  });

  test('scales', () => {
    const small = viewerBox(120, VIEW_WIDTH, VIEW_HEIGHT);
    const large = viewerBox(360, VIEW_WIDTH, VIEW_HEIGHT);
    assert.equal(large.width / small.width, 3);
  });
});

describe('the frame inside it', () => {
  test('is the shape of the files in assets/hologram', () => {
    // If a new render is a different shape, this is the line that says so.
    assert.equal(FRAME_WIDTH, 640);
    assert.equal(FRAME_HEIGHT, 1280);
    assert.equal(FRAME_ASPECT, 0.5);
  });

  test('fits inside the box at every size a screen asks for', () => {
    // Home asks for 240, the result screen for 360, Settings and History for
    // the small inline ones. None of them may paint outside their own box.
    for (const size of [64, 96, 120, 240, 340, 360, 420]) {
      const box = viewerBox(size, VIEW_WIDTH, VIEW_HEIGHT);
      const drawn = containedBox(box, FRAME_ASPECT);
      assert.ok(
        drawn.width <= box.width + 1e-9 && drawn.height <= box.height + 1e-9,
        `the figure spilled out of its box at size ${size}: ` +
          `${drawn.width}x${drawn.height} in ${box.width}x${box.height}`,
      );
    }
  });

  test('touches the box top and bottom, since the figure is the taller shape', () => {
    // The whole point of the hologram beside the stats is that it is as tall
    // as them. A figure letterboxed vertically would read as a shrunken badge.
    const box = viewerBox(240, VIEW_WIDTH, VIEW_HEIGHT);
    const drawn = containedBox(box, FRAME_ASPECT);
    assert.equal(drawn.height, 240);
    assert.ok(drawn.width < box.width, 'narrower than the box, so it centres');
  });

  test('would have been more than nine times its box, drawn at intrinsic size', () => {
    // The bug, stated as a number. 240 is what Home asks for; the PNG is 1280
    // points tall. Nothing about the old code brought those two together.
    const box = viewerBox(240, VIEW_WIDTH, VIEW_HEIGHT);
    assert.ok(FRAME_HEIGHT / box.height > 5);
    assert.ok(FRAME_WIDTH / box.width > 4);
  });

  test('letterboxes the other way round for a wide drawing', () => {
    const box = viewerBox(240, VIEW_WIDTH, VIEW_HEIGHT);
    const drawn = containedBox(box, 4);
    assert.equal(drawn.width, box.width);
    assert.ok(drawn.height < box.height);
  });

  test('draws nothing rather than guessing at a nonsense aspect', () => {
    const box = viewerBox(240, VIEW_WIDTH, VIEW_HEIGHT);
    assert.deepEqual(containedBox(box, 0), { width: 0, height: 0 });
    assert.deepEqual(containedBox(box, Number.NaN), { width: 0, height: 0 });
    assert.deepEqual(containedBox(box, -2), { width: 0, height: 0 });
  });
});
