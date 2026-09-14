import React, { useCallback } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TrainingLocation } from '@getfit/shared';
import { Choice, OnboardingHeader, PrimaryButton, Screen } from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Location'>;

const OPTIONS: Array<{ id: TrainingLocation; label: string; description: string }> = [
  {
    id: 'home',
    label: 'Home',
    description: 'You will pick exactly what equipment you own on the next screen.',
  },
  {
    id: 'gym',
    label: 'Gym',
    description: 'Full access to barbells, machines, cables and cardio equipment.',
  },
];

/** Screen 3 — where the user trains. Home routes on to equipment selection. */
export function LocationScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, update } = useOnboardingDraft();

  const next = useCallback(() => {
    if (draft.trainingLocation === 'home') navigation.navigate('Equipment');
    else navigation.navigate('Schedule');
  }, [draft.trainingLocation, navigation]);

  return (
    <Screen
      footer={<PrimaryButton label="Next" onPress={next} disabled={draft.trainingLocation === null} />}
    >
      <OnboardingHeader
        title="Where do you train?"
        subtitle="The AI only ever prescribes exercises you can actually perform."
        step={stepNumber('location', draft.trainingLocation === 'home')}
        total={totalSteps(draft.trainingLocation === 'home')}
        onBack={navigation.goBack}
      />

      <View style={{ marginTop: spacing.xxxl, gap: spacing.md }}>
        {OPTIONS.map((option) => (
          <Choice
            key={option.id}
            label={option.label}
            description={option.description}
            selected={draft.trainingLocation === option.id}
            onPress={() =>
              update({
                trainingLocation: option.id,
                // Switching to gym clears a home equipment list that no longer applies.
                equipment: option.id === 'gym' ? [] : draft.equipment,
              })
            }
          />
        ))}
      </View>
    </Screen>
  );
}
