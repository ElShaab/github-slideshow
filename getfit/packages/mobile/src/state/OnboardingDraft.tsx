import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type {
  EquipmentId,
  GoalType,
  Sex,
  TrainingLevel,
  TrainingLocation,
} from '@getfit/shared';

export interface OnboardingDraft {
  age: string;
  sex: Sex | null;
  trainingLevel: TrainingLevel | null;
  trainingLocation: TrainingLocation | null;
  equipment: EquipmentId[];
  trainingDays: number | null;
  sessionDurationMinutes: number | null;
  goals: GoalType[];
  heightCm: string;
  weightKg: string;
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
  heightCm: '',
  weightKg: '',
  photoUri: null,
};

interface DraftContextValue {
  draft: OnboardingDraft;
  update: (patch: Partial<OnboardingDraft>) => void;
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
    () => ({ draft, update, reset: () => setDraft(EMPTY_DRAFT), toggleGoal, toggleEquipment }),
    [draft, toggleEquipment, toggleGoal, update],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useOnboardingDraft(): DraftContextValue {
  const context = useContext(DraftContext);
  if (!context) throw new Error('useOnboardingDraft must be used inside OnboardingDraftProvider');
  return context;
}
