import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { massUnit, toDisplayMass, trim, type UnitSystem } from '@getfit/shared';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

export interface WorkoutSetCardProps {
  setNumber: number;
  totalSets: number;
  isWarmup: boolean;
  prescribedWeight: number | null;
  prescribedRepsMin: number;
  prescribedRepsMax: number;
  weight: string;
  reps: string;
  onWeightChange: (value: string) => void;
  onRepsChange: (value: string) => void;
  onComplete: () => void;
  /** Timed movements log seconds instead of reps. */
  isTimed?: boolean;
  /** Bodyweight movements hide the weight field entirely. */
  isBodyweight?: boolean;
  /** What `weight` is typed in. `prescribedWeight` is always kilograms. */
  units: UnitSystem;
}

/**
 * The adjustments a rack can actually make, in the user's own units.
 *
 * Metric gyms have 1.25 kg plates in pairs; imperial gyms have 2.5 lb ones.
 * Offering 1.25 lb steps to somebody with 2.5 lb plates is offering a weight
 * they cannot load.
 */
const STEP_OPTIONS: Record<UnitSystem, number[]> = {
  metric: [-2.5, -1.25, 1.25, 2.5],
  imperial: [-5, -2.5, 2.5, 5],
};

/**
 * The active set in a guided workout.
 *
 * The prescribed values are shown as guidance and the user is free to log
 * something different — both are sent to the server, which stores them
 * separately so the prescription is never overwritten.
 */
export const WorkoutSetCard = memo(function WorkoutSetCard({
  setNumber,
  totalSets,
  isWarmup,
  prescribedWeight,
  prescribedRepsMin,
  prescribedRepsMax,
  weight,
  reps,
  onWeightChange,
  onRepsChange,
  onComplete,
  isTimed = false,
  isBodyweight = false,
  units,
}: WorkoutSetCardProps): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const unit = massUnit(units);

  const adjustWeight = useCallback(
    (delta: number) => {
      const current = Number.parseFloat(weight);
      const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
      onWeightChange(String(Math.round(next * 100) / 100));
    },
    [onWeightChange, weight],
  );

  const showWeight = !isBodyweight || prescribedWeight !== null;
  const repLabel = isTimed ? 'Seconds' : 'Reps';

  return (
    <GlassCard accented emphasis="strong">
      <View style={styles.headerRow}>
        <Text variant="micro" color="accent" uppercase>
          {isWarmup ? 'Warm-up set' : `Set ${setNumber} of ${totalSets}`}
        </Text>
        <Text variant="micro" color="muted" uppercase>
          Target {prescribedRepsMin}–{prescribedRepsMax} {isTimed ? 'sec' : 'reps'}
          {prescribedWeight !== null
            ? ` @ ${trim(toDisplayMass(prescribedWeight, units))} ${unit}`
            : ''}
        </Text>
      </View>

      <View style={[styles.fields, { marginTop: spacing.xl, gap: spacing.lg }]}>
        {showWeight ? (
          <View style={styles.field}>
            <Text variant="micro" color="muted" uppercase>
              Weight ({unit})
            </Text>
            <TextInput
              value={weight}
              onChangeText={onWeightChange}
              keyboardType="decimal-pad"
              selectTextOnFocus
              accessibilityLabel={units === 'metric' ? 'Weight in kilograms' : 'Weight in pounds'}
              accessibilityHint="Change this if you lifted something different to the prescription"
              placeholder="0"
              placeholderTextColor={colors.textMuted}
              style={[
                styles.input,
                {
                  color: colors.text,
                  borderColor: colors.fieldBorder,
                  backgroundColor: colors.field,
                  borderRadius: radius.pill,
                },
              ]}
            />
            <View style={[styles.steppers, { marginTop: spacing.sm, gap: spacing.xs }]}>
              {STEP_OPTIONS[units].map((delta) => (
                <Pressable
                  key={delta}
                  onPress={() => adjustWeight(delta)}
                  accessibilityRole="button"
                  accessibilityLabel={`${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)} ${
                    units === 'metric' ? 'kilograms' : 'pounds'
                  }`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.stepper,
                    {
                      borderColor: colors.glassBorder,
                      backgroundColor: pressed ? colors.accentSoft : 'transparent',
                      borderRadius: radius.sm,
                    },
                  ]}
                >
                  <Text variant="caption" color="secondary">
                    {delta > 0 ? `+${delta}` : delta}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.field}>
          <Text variant="micro" color="muted" uppercase>
            {repLabel}
          </Text>
          <TextInput
            value={reps}
            onChangeText={onRepsChange}
            keyboardType="number-pad"
            selectTextOnFocus
            accessibilityLabel={repLabel}
            placeholder="0"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.fieldBorder,
                backgroundColor: colors.field,
                borderRadius: radius.pill,
              },
            ]}
          />
        </View>
      </View>

      <Pressable
        onPress={onComplete}
        accessibilityRole="button"
        accessibilityLabel="Set complete"
        accessibilityHint="Logs this set and starts your rest timer"
        style={({ pressed }) => [
          styles.complete,
          {
            marginTop: spacing.xl,
            borderRadius: radius.md,
            backgroundColor: pressed ? colors.accentStrong : colors.accent,
          },
        ]}
      >
        <Text variant="subheading" color="onAccent">
          ✓  Set complete
        </Text>
      </Pressable>
    </GlassCard>
  );
});

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fields: { flexDirection: 'row' },
  field: { flex: 1 },
  input: {
    marginTop: 6,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 26,
    fontWeight: '700',
    minHeight: 58,
  },
  steppers: { flexDirection: 'row' },
  stepper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  complete: {
    minHeight: MIN_TOUCH_TARGET + 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
