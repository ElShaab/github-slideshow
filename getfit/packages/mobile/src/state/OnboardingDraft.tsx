import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type {
  EquipmentId,
  GoalType,
  Sex,
  TrainingLevel,
  TrainingLocation,
  UnitSystem,
} from '@getfit/shared';
import {
  EMPTY_MEASUREMENTS,
  convertMeasurementsDraft,
  type MeasurementsDraft,
} from '../utils/measurements';
import { convertHeightText, convertMassText } from '../utils/units';

export interface OnboardingDraft {
  age: string;
  sex: Sex | null;
  trainingLevel: TrainingLevel | null;
  trainingLocation: TrainingLocation | null;
  equipment: EquipmentId[];
  trainingDays: number | null;
  sessionDurationMinutes: number | null;
  goals: GoalType[];
  /**
   * Height and weight as typed, in whatever units the user is reading — cm and
   * kg, or whole inches and pounds. Converted once, on submission. Named
   * without a unit because carrying `Cm` on a field that might hold inches is
   * how a 180 lb user ends up 180 kg.
   */
  height: string;
  weight: string;
  /** The units `height`, `weight` and `measurements` were typed in. */
  units: UnitSystem;
  /** Tape readings, held as text until they are submitted. */
  measurements: MeasurementsDraft;
  /** Optional progress photo. Never analysed. */
  photoUri: string | null;
}

const EMPTY_DRAFT: OnboardingDraft = {
  age: '',
  sex: null,
  trainingLevel: null,
  trainingLocation: null,
  equipment: [],
  trainingDays: null,
  sessionDurationMinutes: null,
  goals: [],
  height: '',
  weight: '',
  units: 'metric',
  measurements: EMPTY_MEASUREMENTS,
  photoUri: null,
};

interface DraftContextValue {
  draft: OnboardingDraft;
  update: (patch: Partial<OnboardingDraft>) => void;
  updateMeasurements: (patch: Partial<MeasurementsDraft>) => void;
  /** Switches units, re-expressing everything already typed. */
  setUnits: (units: UnitSystem) => void;
  reset: () => void;
  toggleGoal: (goal: GoalType) => void;
  toggleEquipment: (item: EquipmentId) => void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

/** Holds onboarding answers in memory until they are submitted together. */
export function OnboardingDraftProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);

  const update = useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateMeasurements = useCallback((patch: Partial<MeasurementsDraft>) => {
    setDraft((current) => ({ ...current, measurements: { ...current.measurements, ...patch } }));
  }, []);

  /**
   * Changing units must not change a single answer, only how it reads. Done in
   * one update so height, weight and the tape readings can never disagree about
   * which system they are in.
   */
  const setUnits = useCallback((units: UnitSystem) => {
    setDraft((current) => {
      if (current.units === units) return current;
      return {
        ...current,
        units,
        height: convertHeightText(current.height, current.units, units),
        weight: convertMassText(current.weight, current.units, units),
        measurements: convertMeasurementsDraft(current.measurements, current.units, units),
      };
    });
  }, []);

  const toggleGoal = useCallback((goal: GoalType) => {
    setDraft((current) => ({
      ...current,
      goals: current.goals.includes(goal)
        ? current.goals.filter((g) => g !== goal)
        : [...current.goals, goal],
    }));
  }, []);

  const toggleEquipment = useCallback((item: EquipmentId) => {
    setDraft((current) => ({
      ...current,
      equipment: current.equipment.includes(item)
        ? current.equipment.filter((e) => e !== item)
        : [...current.equipment, item],
    }));
  }, []);

  const value = useMemo<DraftContextValue>(
    () => ({
      draft,
      update,
      updateMeasurements,
      setUnits,
      reset: () => setDraft(EMPTY_DRAFT),
      toggleGoal,
      toggleEquipment,
    }),
    [draft, setUnits, toggleEquipment, toggleGoal, update, updateMeasurements],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useOnboardingDraft(): DraftContextValue {
  const context = useContext(DraftContext);
  if (!context) throw new Error('useOnboardingDraft must be used inside OnboardingDraftProvider');
  return context;
}
