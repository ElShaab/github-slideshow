import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemeMode } from '@getfit/shared';
import { darkColors, lightColors, type ThemeColors } from './palette';
import { durations, fontFamily, radius, spacing, typeScale } from './tokens';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typeScale: typeof typeScale;
  fontFamily: typeof fontFamily;
  durations: typeof durations;
  isDark: boolean;
  /** True when the OS asks for reduced motion, or the user turned it on. */
  reduceMotion: boolean;
}

interface ThemeContextValue extends Theme {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  setReduceMotionOverride: (value: boolean) => void;
}

const THEME_STORAGE_KEY = 'getfit.themeMode';
const MOTION_STORAGE_KEY = 'getfit.reduceMotion';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const systemScheme = useColorScheme();
  // Dark is the product default, so an unset preference resolves to dark.
  const [mode, setModeState] = useState<ThemeMode>('dark');
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [reduceMotionOverride, setReduceMotionOverrideState] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [storedTheme, storedMotion] = await Promise.all([
          AsyncStorage.getItem(THEME_STORAGE_KEY),
          AsyncStorage.getItem(MOTION_STORAGE_KEY),
        ]);
        if (cancelled) return;
        if (storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'system') {
          setModeState(storedTheme);
        }
        if (storedMotion === 'true') setReduceMotionOverrideState(true);
      } catch {
        // A missing preference is not an error — the defaults already apply.
      }
    })();

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setSystemReduceMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setSystemReduceMotion(enabled);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(THEME_STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const setReduceMotionOverride = useCallback((value: boolean) => {
    setReduceMotionOverrideState(value);
    void AsyncStorage.setItem(MOTION_STORAGE_KEY, String(value)).catch(() => undefined);
  }, []);

  const isDark = mode === 'system' ? systemScheme !== 'light' : mode === 'dark';

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: isDark ? darkColors : lightColors,
      spacing,
      radius,
      typeScale,
      fontFamily,
      durations,
      isDark,
      reduceMotion: systemReduceMotion || reduceMotionOverride,
      mode,
      setMode,
      setReduceMotionOverride,
    }),
    [isDark, mode, reduceMotionOverride, setMode, setReduceMotionOverride, systemReduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
