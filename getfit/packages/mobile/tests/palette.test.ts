/**
 * The palette has to be readable, not just beautiful.
 *
 * Every surface in GetFit is translucent, so the colour behind a label is the
 * glass composited over whatever stop of the blue field happens to be there.
 * That makes contrast easy to lose by eye and impossible to eyeball from the
 * token values: `rgba(255,255,255,0.13)` tells you nothing about whether the
 * caption on top of it can be read on a phone in daylight.
 *
 * So these tests composite the real stack of layers and assert WCAG ratios on
 * the result, at the worst case — the brightest stop of the field in Deep, the
 * palest in Daylight. Body text must clear 4.5:1 and large text 3:1, per WCAG
 * 2.1 AA.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { contrastRatio, compositeStack } from '../src/theme/contrast';
import { darkColors, lightColors, type ThemeColors } from '../src/theme/palette';

const BODY_TEXT = 4.5;
const LARGE_TEXT = 3;

/**
 * The hardest background in a theme to read against: the stop of the field
 * closest in luminance to the text sitting on it.
 */
function worstStop(colors: ThemeColors): string {
  return colors.statusBar === 'light'
    ? // Light text: the brightest stop is the hardest.
      colors.backgroundGradient[0]
    : // Dark text: the palest stop is the hardest.
      colors.backgroundGradient[2];
}

/** Every surface a user reads text on, at its worst point on the field. */
function surfaces(colors: ThemeColors): Array<[string, string]> {
  const field = worstStop(colors);
  return [
    ['the field itself', field],
    ['a glass card', compositeStack(field, colors.glass)],
    ['a raised glass card', compositeStack(field, colors.glassStrong)],
    ['an input well', compositeStack(field, colors.field)],
    ['an input inside a card', compositeStack(field, colors.glass, colors.field)],
    ['a selected choice', compositeStack(field, colors.glass, colors.accentSoft)],
    ['a selected segment', compositeStack(field, colors.field, colors.glassStrong)],
    ['a segment inside a card', compositeStack(field, colors.glass, colors.field, colors.glassStrong)],
    ['floating chrome', compositeStack(field, colors.scrim)],
  ];
}

for (const [themeName, colors] of [
  ['Deep', darkColors],
  ['Daylight', lightColors],
] as const) {
  describe(`${themeName} theme`, () => {
    test('body text is readable on every surface', () => {
      for (const [where, background] of surfaces(colors)) {
        const ratio = contrastRatio(colors.text, background);
        assert.ok(
          ratio >= BODY_TEXT,
          `${themeName}: primary text on ${where} (${background}) is ${ratio.toFixed(2)}:1, needs ${BODY_TEXT}:1`,
        );
      }
    });

    test('secondary text is readable on every surface', () => {
      for (const [where, background] of surfaces(colors)) {
        const ratio = contrastRatio(colors.textSecondary, background);
        assert.ok(
          ratio >= BODY_TEXT,
          `${themeName}: secondary text on ${where} (${background}) is ${ratio.toFixed(2)}:1, needs ${BODY_TEXT}:1`,
        );
      }
    });

    test('muted text clears the large-text floor everywhere', () => {
      // Muted is reserved for eyebrows, captions and hints. It never carries
      // meaning on its own, but it still has to be legible.
      for (const [where, background] of surfaces(colors)) {
        const ratio = contrastRatio(colors.textMuted, background);
        assert.ok(
          ratio >= LARGE_TEXT,
          `${themeName}: muted text on ${where} (${background}) is ${ratio.toFixed(2)}:1, needs ${LARGE_TEXT}:1`,
        );
      }
    });

    test('accent text is readable wherever it is used', () => {
      // `accentText` exists precisely because `accent` — tuned for 2px rims and
      // fills — is too dim to read on glass. If that stops being true the split
      // is pointless, so this is the test that keeps it honest.
      for (const [where, background] of surfaces(colors)) {
        const ratio = contrastRatio(colors.accentText, background);
        assert.ok(
          ratio >= BODY_TEXT,
          `${themeName}: accent text on ${where} (${background}) is ${ratio.toFixed(2)}:1, needs ${BODY_TEXT}:1`,
        );
      }
    });

    test('a label on the accent fill is readable', () => {
      const ratio = contrastRatio(colors.onAccent, colors.accent);
      assert.ok(
        ratio >= BODY_TEXT,
        `${themeName}: onAccent over accent is ${ratio.toFixed(2)}:1, needs ${BODY_TEXT}:1`,
      );
    });

    test('borders and dividers are visible against the surfaces they edge', () => {
      // WCAG 1.4.11: a control boundary needs 3:1 against what is next to it.
      const field = worstStop(colors);
      const card = compositeStack(field, colors.glass);
      const edges: Array<[string, string, string]> = [
        ['the input rim', colors.fieldBorder, compositeStack(card, colors.field)],
        ['a focused input rim', colors.fieldBorderFocused, compositeStack(card, colors.field)],
        ['the accent rim', colors.accent, card],
      ];
      for (const [what, edge, background] of edges) {
        const ratio = contrastRatio(edge, background);
        assert.ok(
          ratio >= LARGE_TEXT,
          `${themeName}: ${what} is ${ratio.toFixed(2)}:1 against ${background}, needs ${LARGE_TEXT}:1`,
        );
      }
    });

    test('the flat background matches the field, so no seam shows', () => {
      // `background` paints the navigator root and anything a gradient cannot
      // reach. If it drifts away from the field, screen transitions flash a
      // different blue.
      const ratio = contrastRatio(colors.background, colors.backgroundGradient[1]);
      assert.ok(
        ratio <= 1.35,
        `${themeName}: flat background is ${ratio.toFixed(2)}:1 from the field's mid stop, which will show as a seam`,
      );
    });
  });
}

describe('the field', () => {
  test('runs light to dark in Deep and stays inside the blue family', () => {
    // A gradient that brightens downward fights the bloom and flattens the
    // page, and a stop that wanders off-hue stops reading as one surface.
    const [top, mid, bottom] = darkColors.backgroundGradient;
    const luminanceOf = (hex: string): number => contrastRatio('#FFFFFF', hex);
    assert.ok(luminanceOf(top) < luminanceOf(mid), 'the top stop should be the brightest');
    assert.ok(luminanceOf(mid) < luminanceOf(bottom), 'the bottom stop should be the deepest');

    for (const stop of [top, mid, bottom]) {
      const { r, g, b } = parseChannels(stop);
      assert.ok(b > g && g > r, `${stop} is not a blue`);
    }
  });
});

function parseChannels(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}
