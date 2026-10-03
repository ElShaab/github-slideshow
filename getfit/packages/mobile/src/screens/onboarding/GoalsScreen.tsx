import React, { useCallback } from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GOAL_DESCRIPTIONS, GOAL_LABELS, type GoalType } from '@getfit/shared';
import { Choice, OnboardingHeader, PrimaryButton, Screen, Text } from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Goals'>;

const GOALS: GoalType[] = ['muscle_gain', 'fat_loss', 'recomposition', 'strength', 'general_fitness'];

/** Screen 6 — goals. Multiple selections are supported and tracked separately. */
export function GoalsScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, toggleGoal } = useOnboardingDraft();
  const isHome = draft.trainingLocation === 'home';

  const next = useCallback(() => navigation.navigate('Measurements'), [navigation]);

  return (
    <Screen
      footer={
        <PrimaryButton
          label="Next"
          onPress={next}
          disabled={draft.goals.length === 0}
          accessibilityHint={draft.goals.length === 0 ? 'Choose at least one goal' : undefined}
        />
      }
    >
      <OnboardingHeader
        title="What are you training for?"
        subtitle="Choose as many as you like — each one gets tracked on its own."
        step={stepNumber('goals', isHome)}
        total={totalSteps(isHome)}
        onBack={navigation.goBack}
      />

      <View style={{ marginTop: spacing.xxl, gap: spacing.md }}>
        {GOALS.map((goal) => (
          <Choice
            key={goal}
            multi
            label={GOAL_LABELS[goal]}
            description={GOAL_DESCRIPTIONS[goal]}
            selected={draft.goals.includes(goal)}
            onPress={() => toggleGoal(goal)}
          />
        ))}
      </View>

      {draft.goals.length > 1 ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xl }}>
          The AI balances all {draft.goals.length} goals when it builds your program.
        </Text>
      ) : null}
    </Screen>
  );
}
