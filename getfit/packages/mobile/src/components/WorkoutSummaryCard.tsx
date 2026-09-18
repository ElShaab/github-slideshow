import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatMinutes, type CompletedWorkout } from '@getfit/shared';
import { useTheme } from '../theme';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

/** One finished session in the workout history list. */
export const WorkoutSummaryCard = memo(function WorkoutSummaryCard({
  workout,
  onPress,
  style,
}: {
  workout: CompletedWorkout;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { spacing } = useTheme();
  const date = new Date(workout.completedAt);
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const card = (
    <GlassCard style={style} padded={false} contentStyle={{ padding: spacing.lg }}>
      <View style={styles.headerRow}>
        <Text variant="subheading">{workout.focus}</Text>
        <Text variant="caption" color="muted">
          {dateLabel}
        </Text>
      </View>

      <View style={[styles.statsRow, { marginTop: spacing.md, gap: spacing.xl }]}>
        <Stat label="Duration" value={formatMinutes(workout.durationSeconds)} />
        <Stat label="Sets" value={String(workout.totalSets)} />
        <Stat label="Volume" value={`${Math.round(workout.totalVolumeKg).toLocaleString()} kg`} />
      </View>
    </GlassCard>
  );

  if (!onPress) return card;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${workout.focus} on ${dateLabel}, ${formatMinutes(
        workout.durationSeconds,
      )}, ${workout.totalSets} sets`}
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
    >
      {card}
    </Pressable>
  );
});

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View>
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>
      <Text variant="bodyStrong" tabular style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statsRow: { flexDirection: 'row' },
});
