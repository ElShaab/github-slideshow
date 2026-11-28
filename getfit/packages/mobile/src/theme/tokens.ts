import { Platform } from 'react-native';

/** 4pt spacing scale. Premium layouts lean on the larger end of it. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
  giant: 56,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 26,
  pill: 999,
} as const;

export const fontFamily = Platform.select({
  ios: {
    regular: 'System',
    medium: 'System',
    semibold: 'System',
    bold: 'System',
  },
  default: {
    regular: 'sans-serif',
    medium: 'sans-serif-medium',
    semibold: 'sans-serif-medium',
    bold: 'sans-serif',
  },
}) as Record<'regular' | 'medium' | 'semibold' | 'bold', string>;

/**
 * Type scale. Sizes are multiplied by the OS font scale at render time via
 * `useTypography`, so Dynamic Type keeps working without breaking layout.
 */
export const typeScale = {
  display: { size: 40, lineHeight: 46, weight: '700' as const, letterSpacing: -0.6 },
  title: { size: 28, lineHeight: 34, weight: '700' as const, letterSpacing: -0.4 },
  heading: { size: 22, lineHeight: 28, weight: '600' as const, letterSpacing: -0.2 },
  subheading: { size: 17, lineHeight: 23, weight: '600' as const, letterSpacing: 0 },
  body: { size: 15, lineHeight: 22, weight: '400' as const, letterSpacing: 0 },
  bodyStrong: { size: 15, lineHeight: 22, weight: '600' as const, letterSpacing: 0 },
  caption: { size: 13, lineHeight: 18, weight: '500' as const, letterSpacing: 0 },
  micro: { size: 11, lineHeight: 15, weight: '600' as const, letterSpacing: 0.8 },
  /** Large numerals used by stat cards and the rest timer. */
  metric: { size: 32, lineHeight: 36, weight: '700' as const, letterSpacing: -0.8 },
  metricLarge: { size: 52, lineHeight: 56, weight: '700' as const, letterSpacing: -1.4 },
} as const;

export type TypeVariant = keyof typeof typeScale;

/** Minimum hit area for every interactive element. */
export const MIN_TOUCH_TARGET = 48;

export const durations = {
  instant: 120,
  fast: 220,
  normal: 340,
  slow: 520,
  scan: 2400,
} as const;
