import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

export interface StatCardProps {
  label: string;
  value: number | string;
  unit?: string;
  /** Decimal places used while counting up to a numeric value. */
  precision?: number;
  caption?: string;
  /** Direction of change since the previous reading, when one exists. */
  delta?: { value: number; goodDirection: 'up' | 'down' } | null;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  accented?: boolean;
}

/** Counts a number up on first appearance — the app's signature stat reveal. */
function useCountUp(target: number, precision: number, enabled: boolean): string {
  const animated = useRef(new Animated.Value(enabled ? 0 : target)).current;
  const [display, setDisplay] = useState(() => (enabled ? '0' : target.toFixed(precision)));

  useEffect(() => {
    if (!enabled) {
      setDisplay(target.toFixed(precision));
      return;
    }
    animated.setValue(0);
    const listener = animated.addListener(({ value }) => {
      setDisplay(value.toFixed(precision));
    });
    const animation = Animated.timing(animated, {
      toValue: target,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animation.stop();
      animated.removeListener(listener);
    };
  }, [animated, enabled, precision, target]);

  return display;
}

export const StatCard = memo(function StatCard({
  label,
  value,
  unit,
  precision = 1,
  caption,
  delta,
  style,
  compact = false,
  accented = false,
}: StatCardProps): React.ReactElement {
  const { colors, spacing, reduceMotion } = useTheme();
  const isNumeric = typeof value === 'number';
  const counted = useCountUp(isNumeric ? value : 0, precision, isNumeric && !reduceMotion);
  const shown = isNumeric ? counted : value;

  // Change is expressed with an arrow and a word, never by colour alone.
  const improving = delta
    ? delta.goodDirection === 'up'
      ? delta.value > 0
      : delta.value < 0
    : null;

  return (
    <GlassCard
      style={style}
      accented={accented}
      contentStyle={{ padding: compact ? spacing.lg : spacing.xl }}
      padded={false}
    >
      <Text variant="micro" color="muted" uppercase accessibilityElementsHidden>
        {label}
      </Text>
      <View
        style={[styles.valueRow, { marginTop: spacing.sm }]}
        accessible
        accessibilityLabel={`${label}: ${shown}${unit ? ` ${unit}` : ''}`}
      >
        <Text variant={compact ? 'heading' : 'metric'} tabular>
          {shown}
        </Text>
        {unit ? (
          <Text variant="caption" color="muted" style={{ marginLeft: spacing.xs, marginBottom: 4 }}>
            {unit}
          </Text>
        ) : null}
      </View>

      {delta && delta.value !== 0 ? (
        <View style={[styles.deltaRow, { marginTop: spacing.xs }]}>
          <Text
            variant="caption"
            style={{ color: improving ? colors.success : colors.warning }}
            accessibilityLabel={`${improving ? 'Improved' : 'Moved away from target'} by ${Math.abs(
              delta.value,
            ).toFixed(precision)}${unit ?? ''}`}
          >
            {delta.value > 0 ? '▲' : '▼'} {Math.abs(delta.value).toFixed(precision)}
            {unit ? ` ${unit}` : ''}
          </Text>
        </View>
      ) : null}

      {caption ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {caption}
        </Text>
      ) : null}
    </GlassCard>
  );
});

/** A tight label/value pair used inside larger cards. */
export const MetricCard = memo(function MetricCard({
  label,
  value,
  unit,
  style,
}: {
  label: string;
  value: string;
  unit?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { spacing, colors, radius } = useTheme();
  return (
    <View
      style={[
        {
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          borderRadius: radius.md,
          backgroundColor: colors.glass,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.glassBorder,
        },
        style,
      ]}
      accessible
      accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}`}
    >
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>
      <View style={[styles.valueRow, { marginTop: spacing.xxs }]}>
        <Text variant="subheading" tabular>
          {value}
        </Text>
        {unit ? (
          <Text variant="caption" color="muted" style={{ marginLeft: 3 }}>
            {unit}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  valueRow: { flexDirection: 'row', alignItems: 'flex-end' },
  deltaRow: { flexDirection: 'row', alignItems: 'center' },
});
