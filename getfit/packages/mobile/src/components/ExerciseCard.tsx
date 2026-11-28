import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatMass, formatRepRange, type Exercise } from '@getfit/shared';
import { useTheme } from '../theme';
import { useUnits } from '../state/UnitsProvider';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { ExerciseIllustration } from './ExerciseIllustration';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

export interface ExerciseCardProps {
  exercise: Exercise;
  sets?: number;
  repsMin?: number;
  repsMax?: number;
  weight?: number | null;
  /** Rendered as a numbered step inside a workout. */
  index?: number;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Shows a completed tick and dims the row. */
  completed?: boolean;
  trailing?: React.ReactNode;
}

/** A single exercise in a workout list or the exercise library. */
export const ExerciseCard = memo(function ExerciseCard({
  exercise,
  sets,
  repsMin,
  repsMax,
  weight,
  index,
  onPress,
  style,
  completed = false,
  trailing,
}: ExerciseCardProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const { units } = useUnits();

  const prescription = [
    sets !== undefined && repsMin !== undefined && repsMax !== undefined
      ? `${sets} × ${formatRepRange(repsMin, repsMax)}`
      : null,
    weight !== undefined && weight !== null ? formatMass(weight, units) : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const summary = `${exercise.name}. ${exercise.primaryMuscle}. ${prescription || exercise.instructions}${
    completed ? '. Completed.' : ''
  }`;

  const body = (
    <GlassCard
      style={[completed && { opacity: 0.62 }, style]}
      padded={false}
      contentStyle={{ padding: spacing.lg }}
      emphasis={completed ? 'soft' : 'default'}
    >
      <View style={[styles.row, { gap: spacing.lg }]}>
        <View
          style={[
            styles.thumb,
            { backgroundColor: colors.stage, borderColor: colors.glassBorder },
          ]}
        >
          <ExerciseIllustration illustration={exercise.illustration} size={52} accessibilityLabel="" />
        </View>

        <View style={styles.flex}>
          <View style={styles.titleRow}>
            {index !== undefined ? (
              <Text variant="caption" color="accent" style={{ marginRight: spacing.xs }} tabular>
                {index + 1}.
              </Text>
            ) : null}
            <Text variant="subheading" numberOfLines={2} style={styles.flex}>
              {exercise.name}
            </Text>
            {completed ? (
              <Text variant="caption" style={{ color: colors.success, marginLeft: spacing.sm }}>
                ✓ Done
              </Text>
            ) : null}
          </View>

          <Text variant="caption" color="muted" uppercase style={{ marginTop: 2 }}>
            {exercise.primaryMuscle}
            {exercise.isCompound ? ' · Compound' : ' · Isolation'}
          </Text>

          {prescription ? (
            <Text variant="bodyStrong" color="accent" style={{ marginTop: spacing.xs }} tabular>
              {prescription}
            </Text>
          ) : null}
        </View>

        {trailing}
      </View>
    </GlassCard>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityHint="Opens the exercise demonstration and instructions"
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1, minHeight: MIN_TOUCH_TARGET }]}
    >
      {body}
    </Pressable>
  );
});

/** A selectable option on the Exercise Preferences screen. */
export const ExerciseSelectionCard = memo(function ExerciseSelectionCard({
  exercise,
  selected,
  disabled,
  onToggle,
  onInfo,
}: {
  exercise: Exercise;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
  onInfo: () => void;
}): React.ReactElement {
  const { colors, spacing, radius } = useTheme();

  return (
    <Pressable
      onPress={disabled && !selected ? undefined : onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: disabled && !selected }}
      accessibilityLabel={`${exercise.name}, ${exercise.primaryMuscle}`}
      accessibilityHint={
        disabled && !selected
          ? 'You have already selected three exercises for this muscle'
          : selected
            ? 'Double tap to remove this exercise'
            : 'Double tap to select this exercise'
      }
      style={({ pressed }) => [
        styles.selection,
        {
          borderRadius: radius.md,
          borderColor: selected ? colors.accent : colors.glassBorder,
          backgroundColor: selected ? colors.accentSoft : colors.glass,
          opacity: disabled && !selected ? 0.4 : pressed ? 0.85 : 1,
          padding: spacing.md,
          gap: spacing.md,
        },
      ]}
    >
      <View
        style={[
          styles.selectionThumb,
          { backgroundColor: colors.stage, borderColor: colors.glassBorder },
        ]}
      >
        <ExerciseIllustration illustration={exercise.illustration} size={40} accessibilityLabel="" />
      </View>

      <View style={styles.flex}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {exercise.name}
        </Text>
        <Text variant="caption" color="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {exercise.isCompound ? 'Compound' : 'Isolation'} · {exercise.difficulty}
        </Text>
      </View>

      {/* Selection is shown with a mark as well as colour. */}
      <View
        style={[
          styles.checkbox,
          {
            borderColor: selected ? colors.accent : colors.glassBorder,
            backgroundColor: selected ? colors.accent : 'transparent',
          },
        ]}
      >
        {selected ? (
          <Text variant="caption" color="onAccent">
            ✓
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={onInfo}
        accessibilityRole="button"
        accessibilityLabel={`How to do ${exercise.name}`}
        hitSlop={12}
        style={[styles.info, { borderColor: colors.glassBorder }]}
      >
        <Text variant="caption" color="muted">
          ?
        </Text>
      </Pressable>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selection: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    minHeight: MIN_TOUCH_TARGET + 16,
  },
  selectionThumb: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
