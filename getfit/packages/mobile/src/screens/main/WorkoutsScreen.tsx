import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { EXERCISE_BY_ID, type ScheduledWorkout } from '@getfit/shared';
import {
  EmptyState,
  ErrorState,
  ExerciseCard,
  GlassCard,
  LoadingScreen,
  PrimaryButton,
  Screen,
  SectionHeader,
  Text,
  WorkoutSummaryCard,
} from '../../components';
import { programApi, workoutApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/** Workouts — today's session, the week ahead, and what has been completed. */
export function WorkoutsScreen(): React.ReactElement {
  const { colors, spacing } = useTheme();
  const navigation = useNavigation<Navigation>();

  const schedule = useAsync(() => programApi.schedule(), []);
  const today = useAsync(() => workoutApi.today(), []);

  useFocusEffect(
    useCallback(() => {
      schedule.reload();
      today.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if ((schedule.loading && !schedule.data) || (today.loading && !today.data)) {
    return <LoadingScreen message="Loading your week…" />;
  }
  if (!schedule.data) {
    return <ErrorState message={schedule.error ?? undefined} onRetry={schedule.reload} />;
  }

  const todaysWorkout = today.data?.workout ?? null;
  const upcoming = schedule.data.upcoming.filter(
    (slot) => slot.id !== todaysWorkout?.scheduled.id,
  );

  return (
    <Screen onRefresh={schedule.reload} refreshing={schedule.refreshing}>
      <Text variant="title" accessibilityRole="header">
        Workouts
      </Text>

      {/* TODAY'S WORKOUT */}
      <SectionHeader title="Today’s workout" style={{ marginTop: spacing.xxl }} />
      {todaysWorkout ? (
        <GlassCard accented emphasis="strong">
          <Text variant="heading">{todaysWorkout.day.focus}</Text>
          <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
            {todaysWorkout.day.durationMinutes} min ·{' '}
            {todaysWorkout.day.exercises.length} exercises
            {todaysWorkout.day.cardio
              ? ` · ${todaysWorkout.day.cardio.minutes} min ${todaysWorkout.day.cardio.type}`
              : ''}
          </Text>

          <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
            {todaysWorkout.day.exercises.map((entry, index) => {
              const exercise = entry.exercise ?? EXERCISE_BY_ID[entry.exerciseId];
              if (!exercise) return null;
              return (
                <ExerciseCard
                  key={entry.id ?? entry.exerciseId}
                  exercise={exercise}
                  index={index}
                  sets={entry.sets}
                  repsMin={entry.repsMin}
                  repsMax={entry.repsMax}
                  weight={entry.startingWeight}
                  onPress={() =>
                    navigation.navigate('ExerciseDetail', { exerciseId: entry.exerciseId })
                  }
                />
              );
            })}
          </View>

          <PrimaryButton
            label="Start workout"
            onPress={() =>
              navigation.navigate('GuidedWorkout', {
                workoutDayId: todaysWorkout.scheduled.programDayId,
                scheduledWorkoutId: todaysWorkout.scheduled.id,
              })
            }
            style={{ marginTop: spacing.xl }}
          />
        </GlassCard>
      ) : (
        <GlassCard>
          <Text variant="subheading">Nothing scheduled today</Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>
            Rest is part of the program. Your next session is below.
          </Text>
        </GlassCard>
      )}

      {/* WEEKLY SCHEDULE */}
      <SectionHeader title="Weekly schedule" style={{ marginTop: spacing.xxxl }} />
      {schedule.data.week.length === 0 ? (
        <EmptyState title="No schedule yet" message="Your week will appear once your program is built." />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {schedule.data.week.map((slot) => (
            <ScheduleRow key={slot.id} slot={slot} />
          ))}
        </View>
      )}

      {/* UPCOMING */}
      {upcoming.length > 0 ? (
        <>
          <SectionHeader title="Upcoming" style={{ marginTop: spacing.xxxl }} />
          <View style={{ gap: spacing.sm }}>
            {upcoming.map((slot) => (
              <GlassCard key={slot.id} padded={false} contentStyle={{ padding: spacing.lg }}>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text variant="subheading">{slot.focus}</Text>
                    <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                      {formatDate(slot.scheduledDate)} · {slot.durationMinutes} min
                    </Text>
                  </View>
                  {slot.status === 'rescheduled' ? (
                    <Text variant="caption" style={{ color: colors.warning }}>
                      Moved
                    </Text>
                  ) : null}
                </View>
              </GlassCard>
            ))}
          </View>
        </>
      ) : null}

      {/* COMPLETED */}
      <SectionHeader title="Completed" style={{ marginTop: spacing.xxxl }} />
      {schedule.data.completed.length === 0 ? (
        <EmptyState
          title="No finished workouts yet"
          message="Your completed sessions will collect here."
        />
      ) : (
        <View style={{ gap: spacing.sm }}>
          {schedule.data.completed.slice(0, 10).map((workout) => (
            <WorkoutSummaryCard key={workout.id} workout={workout} />
          ))}
        </View>
      )}
    </Screen>
  );
}

function ScheduleRow({ slot }: { slot: ScheduledWorkout }): React.ReactElement {
  const { colors, spacing, radius } = useTheme();

  const statusLabel = {
    completed: 'Completed',
    missed: 'Missed',
    rescheduled: 'Moved',
    scheduled: 'Scheduled',
  }[slot.status];

  const statusColor = {
    completed: colors.success,
    missed: colors.warning,
    rescheduled: colors.accent,
    scheduled: colors.textMuted,
  }[slot.status];

  return (
    <View
      style={[
        styles.scheduleRow,
        {
          borderRadius: radius.md,
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          padding: spacing.lg,
        },
      ]}
      accessible
      accessibilityLabel={`${slot.focus} on ${formatDate(slot.scheduledDate)}. ${statusLabel}.`}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong">{slot.focus}</Text>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {formatDate(slot.scheduledDate)}
        </Text>
      </View>
      {/* Status is text, not a colour swatch, so it reads without colour. */}
      <Text variant="caption" style={{ color: statusColor }}>
        {statusLabel}
      </Text>
    </View>
  );
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  flex: { flex: 1 },
});
