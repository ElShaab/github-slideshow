import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  EXERCISE_BY_ID,
  formatMass,
  formatMinutes,
  formatVolume,
  type PersonalRecord,
  type UnitSystem,
} from '@getfit/shared';
import {
  ErrorState,
  GlassCard,
  LoadingScreen,
  MetricCard,
  PrimaryButton,
  Screen,
  Text,
} from '../../components';
import { workoutApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsProvider';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'WorkoutComplete'>;

/** The completion summary: duration, volume, personal records and what changed. */
export function WorkoutCompleteScreen({ route, navigation }: Props): React.ReactElement {
  const { colors, spacing, reduceMotion } = useTheme();
  const { units } = useUnits();
  const summary = useAsync(() => workoutApi.detail(route.params.summaryId), [route.params.summaryId]);
  const reveal = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      reveal.setValue(1);
      return;
    }
    const animation = Animated.timing(reveal, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, reveal]);

  if (summary.loading) return <LoadingScreen message="Saving your workout…" />;
  if (!summary.data?.workout) {
    return <ErrorState message={summary.error ?? undefined} onRetry={summary.reload} />;
  }

  const workout = summary.data.workout;
  const scale = reveal.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <Screen
      footer={
        <PrimaryButton
          label="Done"
          onPress={() => navigation.navigate('Main', { screen: 'Home' })}
        />
      }
    >
      <Animated.View style={{ opacity: reveal, transform: [{ scale }] }}>
        <View style={[styles.badge, { borderColor: colors.accent, backgroundColor: colors.accentSoft, marginTop: spacing.xxl }]}>
          <Text variant="display" color="accent">
            ✓
          </Text>
        </View>

        <Text variant="title" align="center" style={{ marginTop: spacing.xl }} accessibilityRole="header">
          Workout complete
        </Text>
        <Text variant="body" color="secondary" align="center" style={{ marginTop: spacing.sm }}>
          {workout.focus}
        </Text>

        <View style={[styles.grid, { marginTop: spacing.xxl, gap: spacing.sm }]}>
          <MetricCard
            label="Duration"
            value={formatMinutes(workout.durationSeconds)}
            style={styles.half}
          />
          <MetricCard label="Exercises" value={String(workout.exercises.length)} style={styles.half} />
          <MetricCard label="Sets" value={String(workout.totalSets)} style={styles.half} />
          <MetricCard
            label="Volume"
            value={formatVolume(workout.totalVolumeKg, units)}
            style={styles.half}
          />
        </View>

        {workout.cardioMinutes > 0 ? (
          <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.md }}>
            Plus {workout.cardioMinutes} minutes of cardio.
          </Text>
        ) : null}

        {workout.personalRecords.length > 0 ? (
          <GlassCard accented style={{ marginTop: spacing.xxl }}>
            <Text variant="micro" color="accent" uppercase>
              {workout.personalRecords.length === 1
                ? 'Personal record'
                : `${workout.personalRecords.length} personal records`}
            </Text>
            <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
              {workout.personalRecords.map((record, index) => (
                <RecordLine key={`${record.exerciseId}-${record.recordType}-${index}`} record={record} />
              ))}
            </View>
          </GlassCard>
        ) : null}

        <GlassCard style={{ marginTop: spacing.lg }} emphasis="soft">
          <Text variant="micro" color="muted" uppercase>
            What happens next
          </Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
            Your performance has been saved. The AI has already adjusted the weights,
            sets and reps for the next time each of these exercises comes up.
          </Text>
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}

const RECORD_COPY: Record<
  PersonalRecord['recordType'],
  (value: number, previous: number | null, units: UnitSystem) => string
> = {
  weight: (value, previous, units) =>
    previous
      ? `${formatMass(value, units)}  (+${formatMass(value - previous, units)})`
      : formatMass(value, units),
  reps: (value, previous) => (previous ? `${value} reps  (+${value - previous})` : `${value} reps`),
  estimated_1rm: (value, _previous, units) => `${formatMass(value, units)} estimated 1RM`,
  volume: (value, _previous, units) => `${formatVolume(value, units)} total volume`,
};

function RecordLine({ record }: { record: PersonalRecord }): React.ReactElement {
  const { units } = useUnits();
  const name = record.exerciseName ?? EXERCISE_BY_ID[record.exerciseId]?.name ?? record.exerciseId;
  return (
    <View style={styles.recordRow}>
      <Text variant="body" style={styles.flex} numberOfLines={1}>
        {name}
      </Text>
      <Text variant="bodyStrong" color="accent" tabular>
        {RECORD_COPY[record.recordType](record.value, record.previousValue, units)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { width: '48%', flexGrow: 1 },
  recordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  flex: { flex: 1 },
});
