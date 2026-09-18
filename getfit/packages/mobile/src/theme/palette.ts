/**
 * GetFit palette.
 *
 * Dark is the default surface. Cyan is the single accent — used for emphasis,
 * never as the only way to convey meaning (state always pairs colour with a
 * label or icon so the UI stays readable for colour-blind users).
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

export interface ThemeColors {
  /** Page background. */
  background: string;
  /** Secondary background used behind grouped content. */
  backgroundElevated: string;
  /** Glass surface fill. */
  glass: string;
  glassStrong: string;
  glassBorder: string;
  glassHighlight: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  accent: string;
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

export const darkColors: ThemeColors = {
  background: '#05070C',
  backgroundElevated: '#090D15',
  glass: 'rgba(255, 255, 255, 0.045)',
  glassStrong: 'rgba(255, 255, 255, 0.075)',
  glassBorder: 'rgba(255, 255, 255, 0.10)',
  glassHighlight: 'rgba(255, 255, 255, 0.16)',

  text: '#F5FAFF',
  textSecondary: 'rgba(228, 240, 252, 0.72)',
  textMuted: 'rgba(210, 226, 244, 0.46)',
  textInverse: '#05070C',

  accent: CYAN[400],
  accentSoft: 'rgba(34, 227, 242, 0.14)',
  accentStrong: CYAN[300],
  accentGlow: 'rgba(34, 227, 242, 0.34)',
  onAccent: '#02141A',

  success: '#4FE3A1',
  warning: '#FFC46B',
  danger: '#FF7A7A',

  divider: 'rgba(255, 255, 255, 0.07)',
  overlay: 'rgba(3, 6, 11, 0.86)',
  stage: 'rgba(10, 147, 172, 0.10)',
  blurTint: 'dark',
  statusBar: 'light',
  chartGrid: 'rgba(255, 255, 255, 0.07)',
  skeleton: 'rgba(255, 255, 255, 0.06)',
};

export const lightColors: ThemeColors = {
  background: '#F3F7FB',
  backgroundElevated: '#FFFFFF',
  glass: 'rgba(255, 255, 255, 0.70)',
  glassStrong: 'rgba(255, 255, 255, 0.88)',
  glassBorder: 'rgba(9, 30, 48, 0.09)',
  glassHighlight: 'rgba(255, 255, 255, 0.95)',

  text: '#0A1722',
  textSecondary: 'rgba(12, 30, 45, 0.70)',
  textMuted: 'rgba(12, 30, 45, 0.48)',
  textInverse: '#FFFFFF',

  accent: CYAN[600],
  accentSoft: 'rgba(10, 147, 172, 0.12)',
  accentStrong: CYAN[700],
  accentGlow: 'rgba(10, 147, 172, 0.22)',
  onAccent: '#FFFFFF',

  success: '#15916A',
  warning: '#A96B12',
  danger: '#C0392F',

  divider: 'rgba(9, 30, 48, 0.08)',
  overlay: 'rgba(243, 247, 251, 0.90)',
  stage: 'rgba(10, 147, 172, 0.07)',
  blurTint: 'light',
  statusBar: 'dark',
  chartGrid: 'rgba(9, 30, 48, 0.08)',
  skeleton: 'rgba(9, 30, 48, 0.06)',
};
