import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, type ThemeColors } from './palette';
import { durations, fontFamily, radius, spacing, typeScale } from './tokens';

export interface Theme {
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typeScale: typeof typeScale;
  fontFamily: typeof fontFamily;
  durations: typeof durations;
  /** True when the OS asks for reduced motion, or the user turned it on. */
  reduceMotion: boolean;
}

interface ThemeContextValue extends Theme {
  setReduceMotionOverride: (value: boolean) => void;
}

const MOTION_STORAGE_KEY = 'getfit.reduceMotion';

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * GetFit is a dark app.
 *
 * It used to offer a light palette and a "match system theme" switch. Turning
 * the phone to light gave a washed-out screen that nobody had designed: the
 * cards lost their contrast, and the hologram — which is drawn as light on a
 * dark stage — read as a blue smear on white. Shipping a second appearance
 * means designing and testing every screen twice, and the second one was never
 * finished. So there is one appearance, and it is the one the product was
 * drawn in.
 *
 * Reduce motion stays adjustable. That is an accessibility setting, not a
 * matter of taste.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [systemReduceMotion, setSystemReduceMotion] = useState(false);
  const [reduceMotionOverride, setReduceMotionOverrideState] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const storedMotion = await AsyncStorage.getItem(MOTION_STORAGE_KEY);
        if (cancelled) return;
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

  const setReduceMotionOverride = useCallback((value: boolean) => {
    setReduceMotionOverrideState(value);
    void AsyncStorage.setItem(MOTION_STORAGE_KEY, String(value)).catch(() => undefined);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: darkColors,
      spacing,
      radius,
      typeScale,
      fontFamily,
      durations,
      reduceMotion: systemReduceMotion || reduceMotionOverride,
      setReduceMotionOverride,
    }),
    [reduceMotionOverride, setReduceMotionOverride, systemReduceMotion],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
