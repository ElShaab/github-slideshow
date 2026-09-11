import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { formatPercent, formatRatio, formatWeight, type BodyAssessment } from '@getfit/shared';
import {
  EmptyState,
  ErrorState,
  GlassCard,
  HologramViewer,
  LoadingScreen,
  MetricCard,
  Screen,
  SectionHeader,
  Text,
  WorkoutSummaryCard,
} from '../../components';
import { assessmentApi, workoutApi } from '../../api/endpoints';
import { useAsync } from '../../state/useAsync';
import { useTheme } from '../../theme';
import { MIN_TOUCH_TARGET } from '../../theme/tokens';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'History'>;

/**
 * History — every weekly assessment and every completed workout.
 *
 * Each week shows its own hologram and numbers. The original photos are never
 * displayed here, and no week-to-week morph animation is produced.
 */
export function HistoryScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const assessments = useAsync(() => assessmentApi.history(), []);
  const workouts = useAsync(() => workoutApi.history(), []);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (assessments.loading && !assessments.data) return <LoadingScreen message="Loading history…" />;
  if (!assessments.data) {
    return <ErrorState message={assessments.error ?? undefined} onRetry={assessments.reload} />;
  }

  const list = assessments.data.assessments;

  return (
    <Screen onRefresh={assessments.reload} refreshing={assessments.refreshing}>
      <Text variant="title" accessibilityRole="header">
        History
      </Text>
      <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
        Every assessment you have taken, newest first.
      </Text>

      <SectionHeader title="Weekly assessments" style={{ marginTop: spacing.xxl }} />
      {list.length === 0 ? (
        <EmptyState
          title="No assessments yet"
          message="Your first body analysis will show up here."
        />
      ) : (
        <View style={{ gap: spacing.md }}>
          {list.map((assessment, index) => (
            <AssessmentEntry
              key={assessment.id}
              assessment={assessment}
              previous={list[index + 1] ?? null}
              expanded={expanded === assessment.id}
              onToggle={() => setExpanded(expanded === assessment.id ? null : assessment.id)}
            />
          ))}
        </View>
      )}

      <SectionHeader title="Completed workouts" style={{ marginTop: spacing.xxxl }} />
      {workouts.data?.workouts.length ? (
        <View style={{ gap: spacing.sm }}>
          {workouts.data.workouts.map((workout) => (
            <WorkoutSummaryCard
              key={workout.id}
              workout={workout}
              onPress={() => navigation.navigate('WorkoutComplete', { summaryId: workout.id })}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          title="No workouts yet"
          message="Finished sessions will be listed here with their volume and PRs."
        />
      )}
    </Screen>
  );
}

function AssessmentEntry({
  assessment,
  previous,
  expanded,
  onToggle,
}: {
  assessment: BodyAssessment;
  previous: BodyAssessment | null;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { colors, spacing } = useTheme();
  const date = new Date(assessment.createdAt);

  const change = (current: number, before: number | undefined, lowerIsBetter: boolean) => {
    if (before === undefined) return null;
    const delta = Math.round((current - before) * 10) / 10;
    if (delta === 0) return null;
    const improving = lowerIsBetter ? delta < 0 : delta > 0;
    return { delta, improving };
  };

  const bodyFatChange = change(assessment.bodyFatPercent, previous?.bodyFatPercent, true);

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`Assessment ${assessment.assessmentNumber} from ${date.toLocaleDateString()}. ${formatPercent(
        assessment.bodyFatPercent,
      )} body fat, ${formatWeight(assessment.estimatedMuscleMassKg)} muscle.`}
      accessibilityHint={expanded ? 'Collapses this week' : 'Expands this week'}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, minHeight: MIN_TOUCH_TARGET }]}
    >
      <GlassCard padded={false} contentStyle={{ padding: spacing.lg }}>
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text variant="micro" color="accent" uppercase>
              Assessment #{assessment.assessmentNumber}
            </Text>
            <Text variant="subheading" style={{ marginTop: 2 }}>
              {date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </View>
          <Text variant="body" color="muted">
            {expanded ? '⌃' : '⌄'}
          </Text>
        </View>

        <View style={[styles.quickStats, { marginTop: spacing.md, gap: spacing.lg }]}>
          <Quick label="Weight" value={formatWeight(assessment.weightKg)} />
          <Quick label="BF" value={formatPercent(assessment.bodyFatPercent)} />
          <Quick label="Muscle" value={formatWeight(assessment.estimatedMuscleMassKg)} />
        </View>

        {bodyFatChange ? (
          <Text
            variant="caption"
            style={{
              marginTop: spacing.sm,
              color: bodyFatChange.improving ? colors.success : colors.warning,
            }}
          >
            {bodyFatChange.delta > 0 ? '▲' : '▼'} {Math.abs(bodyFatChange.delta).toFixed(1)}% body
            fat vs. the week before
          </Text>
        ) : null}

        {expanded ? (
          <View style={{ marginTop: spacing.lg }}>
            {/* Each week renders its own hologram — never a morph between weeks. */}
            <View style={styles.hologramStage}>
              <HologramViewer data={assessment.hologramData} size={260} rotate={false} />
            </View>

            <View style={[styles.metricGrid, { marginTop: spacing.lg, gap: spacing.sm }]}>
              <MetricCard
                label="Body fat"
                value={formatPercent(assessment.bodyFatPercent)}
                style={styles.metricHalf}
              />
              <MetricCard
                label="Muscle mass"
                value={formatWeight(assessment.estimatedMuscleMassKg)}
                style={styles.metricHalf}
              />
              <MetricCard
                label="Waist / body"
                value={formatRatio(assessment.waistBodyRatio)}
                style={styles.metricHalf}
              />
              <MetricCard
                label="Symmetry"
                value={`${Math.round(assessment.symmetryPercent)}%`}
                style={styles.metricHalf}
              />
            </View>

            <Text variant="caption" color="muted" style={{ marginTop: spacing.md }}>
              Your photo for this week is stored privately and is never shown here.
            </Text>
          </View>
        ) : null}
      </GlassCard>
    </Pressable>
  );
}

function Quick({ label, value }: { label: string; value: string }): React.ReactElement {
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
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  quickStats: { flexDirection: 'row' },
  hologramStage: { alignItems: 'center' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  metricHalf: { width: '48%', flexGrow: 1 },
  flex: { flex: 1 },
});
