import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SESSION_DURATIONS, TRAINING_DAY_OPTIONS } from '@getfit/shared';
import { ChoicePill, OnboardingHeader, PrimaryButton, Screen, Text } from '../../components';
import { useOnboardingDraft } from '../../state/OnboardingDraft';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';
import { stepNumber, totalSteps } from './types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Schedule'>;

/** Screen 5 — training days and session length, merged per the spec. */
export function ScheduleScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { draft, update } = useOnboardingDraft();
  const isHome = draft.trainingLocation === 'home';

  const valid = draft.trainingDays !== null && draft.sessionDurationMinutes !== null;
  const next = useCallback(() => navigation.navigate('Goals'), [navigation]);

  return (
    <Screen footer={<PrimaryButton label="Next" onPress={next} disabled={!valid} />}>
      <OnboardingHeader
        title="Your schedule"
        subtitle="Every workout the AI builds will fit inside the session length you choose."
        step={stepNumber('schedule', isHome)}
        total={totalSteps(isHome)}
        onBack={navigation.goBack}
      />

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxxl }}>
        Training days per week
      </Text>
      <View style={[styles.grid, { marginTop: spacing.md, gap: spacing.sm }]}>
        {TRAINING_DAY_OPTIONS.map((days) => (
          <ChoicePill
            key={days}
            label={`${days} ${days === 1 ? 'day' : 'days'}`}
            selected={draft.trainingDays === days}
            onPress={() => update({ trainingDays: days })}
            style={styles.dayPill}
          />
        ))}
      </View>

      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.xxxl }}>
        Session length
      </Text>
      <View style={[styles.grid, { marginTop: spacing.md, gap: spacing.sm }]}>
        {SESSION_DURATIONS.map((duration) => (
          <ChoicePill
            key={duration}
            label={`${duration} min`}
            selected={draft.sessionDurationMinutes === duration}
            onPress={() => update({ sessionDurationMinutes: duration })}
            style={styles.durationPill}
          />
        ))}
      </View>

      {draft.trainingDays !== null && draft.trainingDays <= 3 ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xxl }}>
          With {draft.trainingDays} {draft.trainingDays === 1 ? 'day' : 'days'} a week the AI
          will build full-body sessions so nothing gets left behind.
        </Text>
      ) : null}
      {draft.trainingDays !== null && draft.trainingDays >= 4 ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xxl }}>
          At {draft.trainingDays} days a week every major muscle group gets trained at least
          twice.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayPill: { minWidth: '30%', flexGrow: 1 },
  durationPill: { minWidth: '22%', flexGrow: 1 },
});
