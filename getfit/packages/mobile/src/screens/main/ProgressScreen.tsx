import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatWeight, type PersonalRecord } from '@getfit/shared';
import {
  EmptyState,
  ErrorState,
  GlassCard,
  GoalCard,
  HologramViewer,
  LoadingScreen,
  MetricCard,
  ProgressChart,
  Screen,
  SecondaryButton,
  SectionHeader,
  Text,
} from '../../components';
import { progressApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Tab = 'body' | 'strength' | 'training' | 'goals';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'body', label: 'Body' },
  { id: 'strength', label: 'Strength' },
  { id: 'training', label: 'Training' },
  { id: 'goals', label: 'Goals' },
];

/**
 * Progress — body trends, strength curves, training stats and goal tracking.
 * Every series is measured data read back from the server; nothing is invented.
 */
export function ProgressScreen(): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const navigation = useNavigation<Navigation>();
  const [tab, setTab] = useState<Tab>('body');
  const progress = useAsync(() => progressApi.overview(), []);

  useFocusEffect(
    useCallback(() => {
      progress.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (progress.loading && !progress.data) return <LoadingScreen message="Loading your progress…" />;
  if (!progress.data) return <ErrorState message={progress.error ?? undefined} onRetry={progress.reload} />;

  const { latestAssessment, trends, strength, training, goals, personalRecords } = progress.data;

  return (
    <Screen onRefresh={progress.reload} refreshing={progress.refreshing}>
      <Text variant="title" accessibilityRole="header">
        Progress
      </Text>

      {/* Tab bar */}
      <View
        style={[
          styles.tabs,
          { backgroundColor: colors.glass, borderColor: colors.glassBorder, borderRadius: radius.md, marginTop: spacing.lg },
        ]}
        accessibilityRole="tablist"
      >
        {TABS.map((entry) => {
          const active = tab === entry.id;
          return (
            <Pressable
              key={entry.id}
              onPress={() => setTab(entry.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={entry.label}
              style={[
                styles.tab,
                {
                  backgroundColor: active ? colors.accentSoft : 'transparent',
                  borderRadius: radius.sm,
                },
              ]}
            >
              <Text variant="caption" color={active ? 'accent' : 'muted'}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'body' ? (
        <View style={{ marginTop: spacing.xxl }}>
          {latestAssessment ? (
            <>
              <GlassCard padded={false} contentStyle={{ padding: spacing.lg, alignItems: 'center' }}>
                <HologramViewer data={latestAssessment.hologramData} size={300} />
                <Text variant="caption" color="muted" style={{ marginTop: spacing.md }}>
                  Assessment #{latestAssessment.assessmentNumber} ·{' '}
                  {new Date(latestAssessment.createdAt).toLocaleDateString()}
                </Text>
              </GlassCard>

              <View style={[styles.metricGrid, { marginTop: spacing.lg, gap: spacing.sm }]}>
                <MetricCard label="Weight" value={formatWeight(latestAssessment.weightKg)} style={styles.metricHalf} />
                <MetricCard
                  label="Body fat"
                  value={`${latestAssessment.bodyFatPercent.toFixed(1)}%`}
                  style={styles.metricHalf}
                />
                <MetricCard
                  label="Muscle"
                  value={formatWeight(latestAssessment.estimatedMuscleMassKg)}
                  style={styles.metricHalf}
                />
                <MetricCard
                  label="Symmetry"
                  value={
                    latestAssessment.symmetryPercent === null
                      ? 'Not measured'
                      : `${Math.round(latestAssessment.symmetryPercent)}%`
                  }
                  style={styles.metricHalf}
                />
              </View>
            </>
          ) : (
            <EmptyState
              title="No assessment yet"
              message="Your first body analysis will appear here."
            />
          )}

          <Trend title="Weight" points={trends.weightKg} unit=" kg" lowerIsBetter={false} />
          <Trend title="Body fat" points={trends.bodyFatPercent} unit="%" lowerIsBetter />
          <Trend title="Muscle mass" points={trends.muscleMassKg} unit=" kg" />
          <Trend title="Waist / body" points={trends.waistBodyRatio} unit="" precision={2} lowerIsBetter />
          {/* Every assessment carries a balance score now, so the empty state
              is about having no assessments rather than no limb measurements.
              A line that mixes estimated and measured weeks is still worth
              plotting: the step when someone first measures is real
              information, not noise. */}
          <Trend
            title="Symmetry"
            points={trends.symmetryPercent}
            unit="%"
            precision={0}
            emptyMessage="No assessments yet — your balance score appears after your first one."
          />

          <SecondaryButton
            label="View full history"
            onPress={() => navigation.navigate('History')}
            style={{ marginTop: spacing.xxl }}
          />
        </View>
      ) : null}

      {tab === 'strength' ? (
        <View style={{ marginTop: spacing.xxl }}>
          <SectionHeader title="Strength progression" />
          {strength.length === 0 ? (
            <EmptyState
              title="No lifts logged yet"
              message="Complete a workout and your strength curves start here."
            />
          ) : (
            <View style={{ gap: spacing.lg }}>
              {strength.map((entry) => (
                <GlassCard key={entry.exerciseId}>
                  <View style={styles.row}>
                    <Text variant="subheading" style={styles.flex} numberOfLines={1}>
                      {entry.exerciseName}
                    </Text>
                    <Text variant="caption" color="accent" tabular>
                      Best {entry.bestWeight} kg
                    </Text>
                  </View>
                  <ProgressChart
                    label={`${entry.exerciseName} weight over time`}
                    points={entry.points}
                    unit=" kg"
                    height={110}
                    style={{ marginTop: spacing.md }}
                  />
                  {entry.bestEstimated1rm > 0 ? (
                    <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
                      Estimated 1RM: {entry.bestEstimated1rm} kg
                    </Text>
                  ) : null}
                </GlassCard>
              ))}
            </View>
          )}

          <SectionHeader title="Personal records" style={{ marginTop: spacing.xxxl }} />
          {personalRecords.length === 0 ? (
            <EmptyState title="No records yet" message="Your PRs will appear here as you train." />
          ) : (
            <View style={{ gap: spacing.sm }}>
              {personalRecords.slice(0, 20).map((record) => (
                <RecordRow key={record.id ?? `${record.exerciseId}-${record.achievedAt}`} record={record} />
              ))}
            </View>
          )}
        </View>
      ) : null}

      {tab === 'training' ? (
        <View style={{ marginTop: spacing.xxl }}>
          <View style={[styles.metricGrid, { gap: spacing.sm }]}>
            <MetricCard
              label="Completion"
              value={`${training.completionRatePercent}%`}
              style={styles.metricHalf}
            />
            <MetricCard
              label="Workouts"
              value={String(training.workoutsCompleted)}
              style={styles.metricHalf}
            />
            <MetricCard label="Total sets" value={String(training.totalSets)} style={styles.metricHalf} />
            <MetricCard
              label="Streak"
              value={`${training.currentStreakDays} ${training.currentStreakDays === 1 ? 'day' : 'days'}`}
              style={styles.metricHalf}
            />
          </View>

          <GlassCard style={{ marginTop: spacing.lg }}>
            <Text variant="micro" color="muted" uppercase>
              Training volume per week
            </Text>
            <ProgressChart
              label="Weekly training volume"
              points={training.weeklyVolume}
              unit=" kg"
              precision={0}
              height={140}
              style={{ marginTop: spacing.sm }}
            />
          </GlassCard>

          <Text variant="caption" color="muted" style={{ marginTop: spacing.lg }}>
            {training.workoutsCompleted} of {training.workoutsScheduled} scheduled sessions
            completed.
          </Text>

          <SecondaryButton
            label="View completed workouts"
            onPress={() => navigation.navigate('History')}
            style={{ marginTop: spacing.xl }}
          />
        </View>
      ) : null}

      {tab === 'goals' ? (
        <View style={{ marginTop: spacing.xxl }}>
          {goals.length === 0 ? (
            <EmptyState title="No goals set" message="Choose your goals in Settings to track them here." />
          ) : (
            <View style={{ gap: spacing.lg }}>
              {goals.map((goal) => (
                <GoalCard key={goal.goalType} goal={goal} />
              ))}
            </View>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Trend({
  title,
  points,
  unit,
  precision = 1,
  lowerIsBetter = false,
  emptyMessage,
}: {
  title: string;
  points: Array<{ date: string; value: number }>;
  unit: string;
  precision?: number;
  lowerIsBetter?: boolean;
  emptyMessage?: string;
}): React.ReactElement {
  const { spacing } = useTheme();
  return (
    <GlassCard style={{ marginTop: spacing.lg }}>
      <Text variant="micro" color="muted" uppercase>
        {title}
      </Text>
      <ProgressChart
        label={`${title} over time`}
        points={points}
        unit={unit}
        precision={precision}
        lowerIsBetter={lowerIsBetter}
        emptyMessage={emptyMessage}
        style={{ marginTop: spacing.sm }}
      />
    </GlassCard>
  );
}

const RECORD_LABELS: Record<PersonalRecord['recordType'], string> = {
  weight: 'Heaviest weight',
  reps: 'Most reps',
  estimated_1rm: 'Estimated 1RM',
  volume: 'Best volume',
};

function RecordRow({ record }: { record: PersonalRecord }): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const unit = record.recordType === 'reps' ? ' reps' : ' kg';

  return (
    <View
      style={[
        styles.recordRow,
        {
          borderRadius: radius.md,
          backgroundColor: colors.glass,
          borderColor: colors.glassBorder,
          padding: spacing.lg,
        },
      ]}
      accessible
      accessibilityLabel={`${record.exerciseName ?? record.exerciseId}: ${RECORD_LABELS[record.recordType]} ${record.value}${unit}`}
    >
      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {record.exerciseName ?? record.exerciseId}
        </Text>
        <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
          {RECORD_LABELS[record.recordType]} ·{' '}
          {new Date(record.achievedAt).toLocaleDateString()}
        </Text>
      </View>
      <View style={styles.recordValue}>
        <Text variant="subheading" color="accent" tabular>
          {record.value}
          {unit}
        </Text>
        {record.previousValue !== null ? (
          <Text variant="caption" color="muted" tabular>
            was {record.previousValue}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', padding: 4, borderWidth: StyleSheet.hairlineWidth * 2 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: MIN_TOUCH_TARGET - 12 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metricHalf: { width: '48%', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  recordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  recordValue: { alignItems: 'flex-end' },
  flex: { flex: 1 },
});
