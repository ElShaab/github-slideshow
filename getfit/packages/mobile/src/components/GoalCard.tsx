import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { GoalProgress } from '@getfit/shared';
import { useTheme } from '../theme';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

/** A single goal with its start, current and target values. */
export const GoalCard = memo(function GoalCard({
  goal,
  style,
}: {
  goal: GoalProgress;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { colors, spacing, radius, reduceMotion } = useTheme();
  const fill = useRef(new Animated.Value(reduceMotion ? goal.progressPercent : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      fill.setValue(goal.progressPercent);
      return;
    }
    const animation = Animated.timing(fill, {
      toValue: goal.progressPercent,
      duration: 800,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [fill, goal.progressPercent, reduceMotion]);

  const width = fill.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <GlassCard style={style}>
      <View style={styles.headerRow}>
        <Text variant="micro" color="accent" uppercase>
          {goal.label}
        </Text>
        <Text variant="caption" color="muted" tabular>
          {goal.progressPercent}%
        </Text>
      </View>

      <Text variant="heading" style={{ marginTop: spacing.sm }}>
        {goal.detail}
      </Text>

      <View
        style={[
          styles.track,
          { backgroundColor: colors.glassBorder, borderRadius: radius.pill, marginTop: spacing.lg },
        ]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${goal.label}: ${goal.detail}`}
        accessibilityValue={{ min: 0, max: 100, now: goal.progressPercent }}
      >
        <Animated.View
          style={[styles.fill, { width, backgroundColor: colors.accent, borderRadius: radius.pill }]}
        />
      </View>

      {goal.targetValue !== null && goal.startValue !== null ? (
        <View style={[styles.rangeRow, { marginTop: spacing.sm }]}>
          <Text variant="caption" color="muted" tabular>
            {goal.startValue}
            {goal.unit}
          </Text>
          <Text variant="caption" color="muted" tabular>
            Target {goal.targetValue}
            {goal.unit}
          </Text>
        </View>
      ) : null}
    </GlassCard>
  );
});

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: '100%' },
  rangeRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
