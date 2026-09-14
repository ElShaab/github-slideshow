import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { Sex } from '@getfit/shared';
import { Choice, NumberField, OnboardingHeader, PrimaryButton, Screen, Text } from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Basics'>;

const SEX_OPTIONS: Array<{ id: Sex; label: string }> = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
];

/** Screen 1 — age and sex, merged per the spec. */
export function BasicsScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, update } = useOnboardingDraft();

  const age = Number.parseInt(draft.age, 10);
  const valid = useMemo(
    () => Number.isFinite(age) && age >= 13 && age <= 100 && draft.sex !== null,
    [age, draft.sex],
  );

  const next = useCallback(() => navigation.navigate('Level'), [navigation]);

  return (
    <Screen
      footer={
        <PrimaryButton
          label="Next"
          onPress={next}
          disabled={!valid}
          accessibilityHint={valid ? undefined : 'Enter your age and select your sex to continue'}
        />
      }
    >
      <OnboardingHeader
        title="About you"
        subtitle="These shape every estimate and every prescription the AI makes."
        step={stepNumber('basics', draft.trainingLocation === 'home')}
        total={totalSteps(draft.trainingLocation === 'home')}
        onBack={navigation.canGoBack() ? navigation.goBack : undefined}
      />

      <View style={{ marginTop: spacing.xxxl }}>
        <NumberField
          label="Age"
          value={draft.age}
          onChange={(value) => update({ age: value })}
          unit="years"
          min={13}
          max={100}
          placeholder="30"
          hint="Used for body-composition estimates and recovery."
        />
      </View>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxxl }}>
        Sex
      </Text>
      <View style={{ marginTop: spacing.sm, gap: spacing.md }}>
        {SEX_OPTIONS.map((option) => (
          <Choice
            key={option.id}
            label={option.label}
            selected={draft.sex === option.id}
            onPress={() => update({ sex: option.id })}
          />
        ))}
      </View>
    </Screen>
  );
}
