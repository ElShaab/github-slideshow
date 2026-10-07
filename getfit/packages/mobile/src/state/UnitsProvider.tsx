import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UnitSystem } from '@getfit/shared';

interface UnitsContextValue {
  units: UnitSystem;
  setUnits: (units: UnitSystem) => void;
}

const UNITS_STORAGE_KEY = 'getfit.units';

const UnitsContext = createContext<UnitsContextValue | null>(null);

/**
 * The three countries that never adopted the metric system, by locale.
 *
 * Guessing from the device beats defaulting everyone to metric and beats asking
 * on a screen of its own — an American opening the app should see pounds
 * without being interviewed about it first. It is only a starting value; the
 * toggle sits on the measurements screen and in Settings.
 */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

function deviceUnits(): UnitSystem {
  try {
    const locale =
      Platform.OS === 'ios'
        ? (NativeModules.SettingsManager?.settings?.AppleLocale as string | undefined) ??
          (NativeModules.SettingsManager?.settings?.AppleLanguages?.[0] as string | undefined)
        : (NativeModules.I18nManager?.localeIdentifier as string | undefined);

    const region = locale?.replace('-', '_').split('_')[1]?.slice(0, 2).toUpperCase();
    return region && IMPERIAL_REGIONS.has(region) ? 'imperial' : 'metric';
  } catch {
    // A device that will not say where it is gets the majority's units.
    return 'metric';
  }
}

export function UnitsProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [units, setUnitsState] = useState<UnitSystem>('metric');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      let stored: string | null = null;
      try {
        stored = await AsyncStorage.getItem(UNITS_STORAGE_KEY);
      } catch {
        // Unreadable storage is not a reason to fail to start.
      }
      if (cancelled) return;
      setUnitsState(stored === 'imperial' || stored === 'metric' ? stored : deviceUnits());
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setUnits = useCallback((next: UnitSystem) => {
    // Applied immediately: nothing stored changes, so there is nothing to undo
    // if the write fails, and a toggle that lags is a toggle that feels broken.
    setUnitsState(next);
    void AsyncStorage.setItem(UNITS_STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({ units, setUnits }), [units, setUnits]);

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

/**
 * The unit system to present in.
 *
 * Usable outside the provider — it falls back to metric rather than throwing,
 * because a missing provider should not take down a screen over a label.
 */
export function useUnits(): UnitsContextValue {
  return (
    useContext(UnitsContext) ?? { units: 'metric' as UnitSystem, setUnits: () => {} }
  );
}
