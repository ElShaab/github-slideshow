import React, { memo, useCallback } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';
import { clampNumericInput } from '../utils/numeric';

export interface NumberFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  decimal?: boolean;
  style?: StyleProp<ViewStyle>;
  hint?: string;
}

/** A labelled numeric input with large increment/decrement targets. */
export const NumberField = memo(function NumberField({
  label,
  value,
  onChange,
  unit,
  placeholder,
  min = 0,
  max = 999,
  step = 1,
  decimal = false,
  style,
  hint,
}: NumberFieldProps): React.ReactElement {
  const { colors, spacing, radius } = useTheme();

  const nudge = useCallback(
    (delta: number) => {
      const current = Number.parseFloat(value);
      const base = Number.isFinite(current) ? current : min;
      const next = Math.min(max, Math.max(min, base + delta));
      onChange(decimal ? String(Math.round(next * 10) / 10) : String(Math.round(next)));
    },
    [decimal, max, min, onChange, value],
  );

  const sanitise = useCallback(
    (text: string) => {
      const cleaned = decimal ? text.replace(/[^0-9.]/g, '') : text.replace(/[^0-9]/g, '');
      onChange(cleaned);
    },
    [decimal, onChange],
  );

  const clampOnBlur = useCallback(() => {
    const clamped = clampNumericInput(value, min, max, decimal);
    if (clamped !== value) onChange(clamped);
  }, [decimal, max, min, onChange, value]);

  return (
    <View style={style}>
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>

      <View
        style={[
          styles.row,
          {
            marginTop: spacing.sm,
            borderRadius: radius.md,
            borderColor: colors.glassBorder,
            backgroundColor: colors.glass,
          },
        ]}
      >
        <Stepper label="−" onPress={() => nudge(-step)} accessibilityLabel={`Decrease ${label}`} />

        <View style={styles.inputWrap}>
          <TextInput
            value={value}
            onChangeText={sanitise}
            onBlur={clampOnBlur}
            keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            selectTextOnFocus
            accessibilityLabel={label}
            style={[styles.input, { color: colors.text }]}
          />
          {unit ? (
            <Text variant="body" color="muted" style={{ marginLeft: 4 }}>
              {unit}
            </Text>
          ) : null}
        </View>

        <Stepper label="+" onPress={() => nudge(step)} accessibilityLabel={`Increase ${label}`} />
      </View>

      {hint ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

function Stepper({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.stepper,
        { backgroundColor: pressed ? colors.accentSoft : 'transparent' },
      ]}
    >
      <Text variant="heading" color="secondary">
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    minHeight: 62,
  },
  stepper: {
    width: MIN_TOUCH_TARGET + 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  input: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    minWidth: 80,
    paddingVertical: 10,
  },
});
