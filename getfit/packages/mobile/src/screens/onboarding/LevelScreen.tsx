import React, { useCallback } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LEVEL_DESCRIPTIONS, LEVEL_LABELS, type TrainingLevel } from '@getfit/shared';
import { Choice, OnboardingHeader, PrimaryButton, Screen } from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Level'>;

const LEVELS: TrainingLevel[] = ['beginner', 'intermediate', 'advanced'];

/** Screen 2 — training level. Drives volume, difficulty and starting weights. */
export function LevelScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, update } = useOnboardingDraft();
  const next = useCallback(() => navigation.navigate('Location'), [navigation]);

  return (
    <Screen
      footer={<PrimaryButton label="Next" onPress={next} disabled={draft.trainingLevel === null} />}
    >
      <OnboardingHeader
        title="Training level"
        subtitle="This sets your starting loads, weekly volume and exercise difficulty."
        step={stepNumber('level', draft.trainingLocation === 'home')}
        total={totalSteps(draft.trainingLocation === 'home')}
        onBack={navigation.goBack}
      />

      <View style={{ marginTop: spacing.xxxl, gap: spacing.md }}>
        {LEVELS.map((level) => (
          <Choice
            key={level}
            label={LEVEL_LABELS[level]}
            description={LEVEL_DESCRIPTIONS[level]}
            selected={draft.trainingLevel === level}
            onPress={() => update({ trainingLevel: level })}
          />
        ))}
      </View>
    </Screen>
  );
}
