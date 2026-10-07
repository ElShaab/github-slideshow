/**
 * GetFit palette.
 *
 * The app is one continuous pane of electric blue glass: a saturated azure
 * field, a cyan bloom behind it, and frosted surfaces with a bright cyan rim
 * floating on top. Every colour in the product comes from here — no screen
 * hardcodes a hex value — so the whole app moves together.
 *
 * The blues are tuned, not sampled. A design comp can sit a white label on a
 * pale frosted panel and look wonderful; on a phone in daylight that is around
 * 3:1 and unreadable. So the field's brightest stop is held at a luminance
 * where white body text on a frosted card still clears 4.5:1, and the vivid
 * end of the blue lives in the bloom and the rim, where nothing has to be read.
 * `tests/palette.test.ts` asserts those ratios, so the look cannot drift back
 * into being pretty and illegible.
 *
 * Cyan is the single accent, and it is never the only carrier of meaning:
 * selected states pair it with a border, a fill and an explicit mark.
 */

export const CYAN = {
  50: '#E6FEFF',
  100: '#B9F8FF',
  200: '#7CF6FF',
  300: '#3EEBFB',
  400: '#22E3F2',
  500: '#0FB9D6',
  600: '#0A93AC',
  700: '#0A7186',
  800: '#0D5A69',
  900: '#0F4956',
} as const;

/** The azure field. 500 is the brightest stop content is ever read against. */
export const AZURE = {
  50: '#F2F8FE',
  100: '#DCEDFB',
  200: '#BBDCF6',
  300: '#8CC3EE',
  400: '#2F7FD0',
  500: '#0A4693',
  600: '#0A3B85',
  700: '#062A66',
  800: '#05224F',
  900: '#03152F',
} as const;

/** Three stops, light to dark, painted down the page behind everything. */
export type Gradient = readonly [string, string, string];

export interface ThemeColors {
  /** Flat page colour. Used where a gradient cannot go — navigator roots, the
   *  space behind a modal — so it must match the field's mid stop. */
  background: string;
  /** Secondary background used behind grouped content. */
  backgroundElevated: string;
  /** The field itself: the gradient every screen is painted on. */
  backgroundGradient: Gradient;
  /** Cyan bloom across the top of the page. */
  bloomTop: Gradient;
  /** The second, cooler bloom that lifts the bottom corner. */
  bloomBottom: Gradient;

  /** Glass surface fill. */
  glass: string;
  glassStrong: string;
  glassBorder: string;
  glassHighlight: string;
  /** The bright cyan-white rim on a focal surface. */
  glassEdge: string;
  /** Translucent tint for chrome that floats over the field — tab bar, footer. */
  scrim: string;

  /** Text input fill and rim. Inputs read as recessed wells in the glass. */
  field: string;
  fieldBorder: string;
  fieldBorderFocused: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  accent: string;
  /** The accent as *text*. Brighter than `accent`, which is tuned for strokes
   *  and fills; a cyan that looks right as a 2px rim is too dim to read. */
  accentText: string;
  accentSoft: string;
  accentStrong: string;
  accentGlow: string;
  onAccent: string;

  success: string;
  warning: string;
  danger: string;

  divider: string;
  overlay: string;
  /** Tint behind the hologram stage. */
  stage: string;
  /** Blur tint passed to expo-blur. */
  blurTint: 'dark' | 'light';
  /** Status bar content style. */
  statusBar: 'light' | 'dark';
  chartGrid: string;
  skeleton: string;
}

/** Deep: the product default — the comp's blue at night. */
export const darkColors: ThemeColors = {
  background: AZURE[600],
  backgroundElevated: '#0B3F8C',
  backgroundGradient: [AZURE[500], AZURE[600], AZURE[700]],
  bloomTop: ['rgba(60, 206, 232, 0.30)', 'rgba(34, 227, 242, 0.09)', 'transparent'],
  bloomBottom: ['transparent', 'rgba(34, 227, 242, 0.08)', 'rgba(70, 214, 236, 0.26)'],

  glass: 'rgba(255, 255, 255, 0.12)',
  glassStrong: 'rgba(255, 255, 255, 0.16)',
  glassBorder: 'rgba(196, 232, 255, 0.28)',
  glassHighlight: 'rgba(255, 255, 255, 0.24)',
  glassEdge: 'rgba(160, 248, 255, 0.85)',
  scrim: 'rgba(6, 42, 102, 0.72)',

  field: 'rgba(3, 21, 47, 0.24)',
  fieldBorder: 'rgba(216, 241, 255, 0.72)',
  fieldBorderFocused: CYAN[200],

  text: '#F2F8FF',
  textSecondary: 'rgba(230, 243, 255, 0.92)',
  textMuted: 'rgba(214, 232, 251, 0.78)',
  textInverse: AZURE[700],

  accent: CYAN[400],
  accentText: CYAN[100],
  accentSoft: 'rgba(10, 113, 134, 0.34)',
  accentStrong: CYAN[200],
  accentGlow: 'rgba(124, 246, 255, 0.55)',
  onAccent: '#04223A',

  success: '#6FF2C0',
  warning: '#FFD089',
  danger: '#FFA3A3',

  divider: 'rgba(196, 232, 255, 0.20)',
  overlay: 'rgba(4, 26, 62, 0.88)',
  stage: 'rgba(124, 246, 255, 0.10)',
  blurTint: 'dark',
  statusBar: 'light',
  chartGrid: 'rgba(196, 232, 255, 0.20)',
  skeleton: 'rgba(255, 255, 255, 0.12)',
};
