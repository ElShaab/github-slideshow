import React, { memo, useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Line, Stop } from 'react-native-svg';
import type { TrendPoint } from '@getfit/shared';
import { useTheme } from '../theme';
import { Text } from './Text';

export interface ProgressChartProps {
  points: TrendPoint[];
  /** Unit appended to the value labels and the accessible summary. */
  unit?: string;
  precision?: number;
  height?: number;
  /** For these metrics a falling line is progress. */
  lowerIsBetter?: boolean;
  style?: StyleProp<ViewStyle>;
  label: string;
}

/**
 * A compact sparkline for a metric over time. Purely presentational: it plots
 * whatever the server measured and never extrapolates beyond the last point.
 */
export const ProgressChart = memo(function ProgressChart({
  points,
  unit = '',
  precision = 1,
  height = 120,
  lowerIsBetter = false,
  style,
  label,
}: ProgressChartProps): React.ReactElement {
  const { colors, spacing } = useTheme();

  const chart = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat series still needs a band to draw inside.
    const span = max - min || Math.max(1, Math.abs(max) * 0.1);
    const padded = { min: min - span * 0.2, max: max + span * 0.2 };
    const range = padded.max - padded.min;

    const width = 300;
    const inner = height - 24;
    const step = points.length > 1 ? width / (points.length - 1) : 0;

    const coords = points.map((point, index) => ({
      x: points.length === 1 ? width / 2 : index * step,
      y: 12 + inner - ((point.value - padded.min) / range) * inner,
      value: point.value,
    }));

    const line = coords
      .map((c, index) => (index === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`))
      .join(' ');
    const area = `${line} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;

    return { coords, line, area, width, min, max, first: values[0], last: values[values.length - 1] };
  }, [height, points]);

  if (!chart) {
    return (
      <View style={[{ height, justifyContent: 'center' }, style]}>
        <Text variant="caption" color="muted">
          Not enough data yet — complete an assessment to start this trend.
        </Text>
      </View>
    );
  }

  const change = chart.last - chart.first;
  const improving = lowerIsBetter ? change < 0 : change > 0;
  const changeLabel =
    points.length < 2
      ? 'First reading'
      : `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(precision)}${unit} since the first reading`;

  return (
    <View
      style={style}
      accessible
      accessibilityLabel={`${label}. ${points.length} readings from ${chart.first.toFixed(
        precision,
      )}${unit} to ${chart.last.toFixed(precision)}${unit}. ${changeLabel}.`}
    >
      <View style={styles.headerRow}>
        <Text variant="caption" color="muted">
          {chart.min.toFixed(precision)}
          {unit} – {chart.max.toFixed(precision)}
          {unit}
        </Text>
        {points.length > 1 ? (
          <Text
            variant="caption"
            style={{ color: change === 0 ? colors.textMuted : improving ? colors.success : colors.warning }}
          >
            {change > 0 ? '▲' : change < 0 ? '▼' : '■'} {Math.abs(change).toFixed(precision)}
            {unit}
          </Text>
        ) : null}
      </View>

      <Svg width="100%" height={height} viewBox={`0 0 ${chart.width} ${height}`} style={{ marginTop: spacing.sm }}>
        <Defs>
          <LinearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.accent} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        {[0.25, 0.5, 0.75].map((fraction) => (
          <Line
            key={fraction}
            x1={0}
            y1={height * fraction}
            x2={chart.width}
            y2={height * fraction}
            stroke={colors.chartGrid}
            strokeWidth={1}
          />
        ))}

        <Path d={chart.area} fill="url(#chartFill)" />
        <Path
          d={chart.line}
          stroke={colors.accent}
          strokeWidth={2.4}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {chart.coords.map((coord, index) => (
          <Circle
            key={index}
            cx={coord.x}
            cy={coord.y}
            r={index === chart.coords.length - 1 ? 5 : 3}
            fill={index === chart.coords.length - 1 ? colors.accent : colors.background}
            stroke={colors.accent}
            strokeWidth={2}
          />
        ))}
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
