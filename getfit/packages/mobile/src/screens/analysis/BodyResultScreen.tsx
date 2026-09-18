import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import {
  BODY_FAT_METHOD_COPY,
  formatPercent,
  formatRatio,
  formatWeight,
  type BodyAssessment,
} from '@getfit/shared';
import { GlassCard, HologramViewer, PrimaryButton, Screen, StatCard, Text } from '../../components';
import { useTheme } from '../../theme';

export interface BodyResultScreenProps {
  assessment: BodyAssessment;
  /** Previous assessment, when one exists, to show change. */
  previous?: BodyAssessment | null;
  onContinue: () => void;
  continueLabel: string;
  title?: string;
}

/**
 * The body result.
 *
 * Shows the stylised hologram beside the four headline metrics. Values come
 * straight from the stored assessment — nothing here is hardcoded, and no
 * future physique is shown or implied.
 */
export function BodyResultScreen({
  assessment,
  previous,
  onContinue,
  continueLabel,
  title = 'Your body',
}: BodyResultScreenProps): React.ReactElement {
  const { spacing, reduceMotion } = useTheme();
  const reveal = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      reveal.setValue(1);
      return;
    }
    const animation = Animated.timing(reveal, {
      toValue: 1,
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, reveal]);

  const translateY = reveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });

  // Always say how the number was produced, so a fallback estimate is never
  // mistaken for a tape measurement.
  const method = BODY_FAT_METHOD_COPY[assessment.method];

  const delta = (
    current: number | null,
    before: number | null | undefined,
    goodDirection: 'up' | 'down',
  ) =>
    current === null || before === null || before === undefined
      ? null
      : { value: Math.round((current - before) * 10) / 10, goodDirection };

  return (
    <Screen
      footer={<PrimaryButton label={continueLabel} onPress={onContinue} />}
      contentStyle={{ paddingBottom: spacing.xxl }}
    >
      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.lg }}>
        Body analysis complete
      </Text>
      <Text variant="title" style={{ marginTop: spacing.sm }} accessibilityRole="header">
        {title}
      </Text>

      <View style={styles.stage}>
        <HologramViewer data={assessment.hologramData} size={360} />
      </View>

      <Animated.View style={{ opacity: reveal, transform: [{ translateY }] }}>
        <Text variant="micro" color="muted" uppercase style={{ marginBottom: spacing.md }}>
          Body composition
        </Text>

        <View style={[styles.grid, { gap: spacing.md }]}>
          <StatCard
            label="BF"
            value={assessment.bodyFatPercent}
            unit="%"
            precision={1}
            style={styles.half}
            accented
            delta={delta(assessment.bodyFatPercent, previous?.bodyFatPercent, 'down')}
          />
          <StatCard
            label="Muscle"
            value={assessment.estimatedMuscleMassKg}
            unit="kg"
            precision={1}
            style={styles.half}
            delta={delta(assessment.estimatedMuscleMassKg, previous?.estimatedMuscleMassKg, 'up')}
          />
          <StatCard
            label="Waist / Body"
            value={assessment.waistBodyRatio}
            precision={2}
            style={styles.half}
            delta={delta(assessment.waistBodyRatio, previous?.waistBodyRatio, 'down')}
          />
          {/* Symmetry only exists when both sides were measured. An unmeasured
              body is shown as unmeasured, never as a perfect 100%. */}
          <StatCard
            label="Symmetry"
            value={assessment.symmetryPercent ?? '—'}
            unit={assessment.symmetryPercent === null ? undefined : '%'}
            precision={0}
            style={styles.half}
            delta={delta(assessment.symmetryPercent, previous?.symmetryPercent, 'up')}
          />
        </View>

        <GlassCard style={{ marginTop: spacing.lg }} emphasis="soft">
          <View style={styles.summaryRow}>
            <View>
              <Text variant="micro" color="muted" uppercase>
                Weight
              </Text>
              <Text variant="subheading" style={{ marginTop: 2 }} tabular>
                {formatWeight(assessment.weightKg)}
              </Text>
            </View>
            <View>
              <Text variant="micro" color="muted" uppercase>
                Lean mass
              </Text>
              <Text variant="subheading" style={{ marginTop: 2 }} tabular>
                {formatWeight(
                  Math.round(assessment.weightKg * (1 - assessment.bodyFatPercent / 100) * 10) / 10,
                )}
              </Text>
            </View>
            <View>
              <Text variant="micro" color="muted" uppercase>
                Assessment
              </Text>
              <Text variant="subheading" style={{ marginTop: 2 }} tabular>
                #{assessment.assessmentNumber}
              </Text>
            </View>
          </View>

          <View style={{ marginTop: spacing.lg }}>
            <Text variant="micro" color="accent" uppercase>
              {method.label} · {method.short}
            </Text>
            <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
              {formatPercent(assessment.bodyFatPercent)} body fat ·{' '}
              {formatRatio(assessment.waistBodyRatio)} waist-to-height. {method.detail}
            </Text>
            {assessment.symmetryPercent === null ? (
              <Text variant="caption" color="muted" style={{ marginTop: spacing.sm }}>
                Symmetry is unreported because neither arm nor thigh pair was
                measured. Measure both sides next week to get a balance score.
              </Text>
            ) : null}
          </View>
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', marginVertical: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  half: { width: '47.5%', flexGrow: 1 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
