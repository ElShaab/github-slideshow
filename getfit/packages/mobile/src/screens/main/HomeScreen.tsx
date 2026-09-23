import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatMass, formatPercent } from '@getfit/shared';
import {
  ErrorState,
  GlassCard,
  HologramViewer,
  LoadingScreen,
  MetricCard,
  PrimaryButton,
  Screen,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components';
import { homeApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import { useUnits } from '../../state/UnitsProvider';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * Home — deliberately minimal.
 *
 * Your body, today's session, and the assessment countdown. No feed, no extra
 * modules. Everything arrives in a single request that is cached for offline.
 */
export function HomeScreen(): React.ReactElement {
  const { colors, spacing } = useTheme();
  const { units } = useUnits();
  const navigation = useNavigation<Navigation>();
  const home = useAsync(() => homeApi.load(), []);

  // Refresh whenever the tab regains focus so a finished workout shows at once.
  useFocusEffect(
    useCallback(() => {
      home.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (home.loading && !home.data) return <LoadingScreen message="Loading your dashboard…" />;
  if (!home.data) return <ErrorState message={home.error ?? undefined} onRetry={home.reload} />;

  const { assessment, assessmentAvailability, today, profile, totals } = home.data;

  return (
    <Screen onRefresh={home.reload} refreshing={home.refreshing}>
      <View style={styles.topRow}>
        <View>
          <Text variant="micro" color="muted" uppercase>
            GetFit
          </Text>
          <Text variant="title" accessibilityRole="header">
            {greeting()}
          </Text>
        </View>

        <Pressable
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings and profile"
          hitSlop={10}
          style={({ pressed }) => [
            styles.settingsButton,
            { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text variant="subheading" color="secondary">
            ⚙
          </Text>
        </Pressable>
      </View>

      {home.offline ? (
        <Text variant="caption" color="warning" style={{ marginTop: spacing.md }}>
          Offline — showing your last saved data.
        </Text>
      ) : null}

      {/* YOUR BODY */}
      <SectionHeader title="Your body" style={{ marginTop: spacing.xxl }} />
      {assessment ? (
        <GlassCard padded={false} contentStyle={{ padding: spacing.lg }}>
          <View style={styles.bodyRow}>
            <HologramViewer data={assessment.hologramData} size={190} rotate />
            <View style={[styles.bodyStats, { gap: spacing.sm }]}>
              <MetricCard label="Weight" value={formatMass(assessment.weightKg, units)} />
              <MetricCard label="Body fat" value={formatPercent(assessment.bodyFatPercent)} />
              <MetricCard
                label="Muscle"
                value={formatMass(assessment.estimatedMuscleMassKg, units)}
              />
              <MetricCard
                label="Symmetry"
                value={
                  assessment.symmetryPercent === null
                    ? 'Not measured'
                    : `${Math.round(assessment.symmetryPercent)}%`
                }
              />
            </View>
          </View>
        </GlassCard>
      ) : (
        <GlassCard>
          <Text variant="body" color="secondary">
            Your first body analysis will appear here.
          </Text>
        </GlassCard>
      )}

      {/* TODAY */}
      <SectionHeader title="Today" style={{ marginTop: spacing.xxxl }} />
      {today ? (
        <GlassCard accented emphasis="strong">
          <View style={styles.todayHeader}>
            <View style={styles.flex}>
              <Text variant="heading">{today.focus}</Text>
              <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                {today.durationMinutes} min · {today.exerciseCount} exercises
                {today.cardio ? ` · ${today.cardio.minutes} min ${today.cardio.type}` : ''}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: spacing.lg, gap: spacing.xs }}>
            {today.preview.map((exercise) => (
              <View key={exercise.exerciseId} style={styles.previewRow}>
                <Text variant="body" color="secondary" numberOfLines={1} style={styles.flex}>
                  {exercise.name}
                </Text>
                <Text variant="caption" color="muted" tabular>
                  {exercise.sets} × {exercise.repsMin}–{exercise.repsMax}
                  {exercise.startingWeight ? ` · ${formatMass(exercise.startingWeight, units)}` : ''}
                </Text>
              </View>
            ))}
            {today.exerciseCount > today.preview.length ? (
              <Text variant="caption" color="muted">
                + {today.exerciseCount - today.preview.length} more
              </Text>
            ) : null}
          </View>

          <PrimaryButton
            label="Start workout"
            onPress={() =>
              navigation.navigate('GuidedWorkout', {
                workoutDayId: today.scheduled.programDayId,
                scheduledWorkoutId: today.scheduled.id,
              })
            }
            style={{ marginTop: spacing.xl }}
          />
        </GlassCard>
      ) : (
        <GlassCard>
          <Text variant="subheading">Rest day</Text>
          <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>
            Nothing scheduled right now. Your next session will appear here.
          </Text>
        </GlassCard>
      )}

      {/* PROGRESS */}
      <SectionHeader title="Progress" style={{ marginTop: spacing.xxxl }} />
      <GlassCard>
        <View style={styles.assessmentRow}>
          <View style={styles.flex}>
            {assessmentAvailability.available ? (
              <>
                <Text variant="subheading" color="accent">
                  Assessment ready
                </Text>
                <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                  Take this week’s photo to update your body composition.
                </Text>
              </>
            ) : (
              <>
                <Text variant="subheading">
                  Next assessment in {assessmentAvailability.daysRemaining}{' '}
                  {assessmentAvailability.daysRemaining === 1 ? 'day' : 'days'}
                </Text>
                <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
                  A new assessment unlocks exactly 7 days after your last one.
                </Text>
              </>
            )}
          </View>
        </View>

        {assessmentAvailability.available ? (
          <PrimaryButton
            label="Start assessment"
            onPress={() => navigation.navigate('WeeklyAssessment')}
            style={{ marginTop: spacing.lg }}
          />
        ) : null}

        <View style={[styles.totalsRow, { marginTop: spacing.lg, gap: spacing.md }]}>
          <MetricCard label="Workouts" value={String(totals.workouts)} style={styles.flex} />
          <MetricCard label="Sets logged" value={String(totals.sets)} style={styles.flex} />
        </View>

        <SecondaryButton
          label="View history"
          onPress={() => navigation.navigate('History')}
          style={{ marginTop: spacing.lg }}
        />
      </GlassCard>

      {profile ? (
        <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.xxl }}>
          {profile.trainingDays} days a week · {profile.sessionDurationMinutes} min sessions ·{' '}
          {profile.trainingLocation === 'home' ? 'Home' : 'Gym'}
        </Text>
      ) : null}
    </Screen>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  settingsButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyRow: { flexDirection: 'row', alignItems: 'center' },
  bodyStats: { flex: 1, marginLeft: 12 },
  todayHeader: { flexDirection: 'row', alignItems: 'center' },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  assessmentRow: { flexDirection: 'row', alignItems: 'center' },
  totalsRow: { flexDirection: 'row' },
  flex: { flex: 1 },
});
