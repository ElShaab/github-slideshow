import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';

export interface ChoiceProps {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** Radio behaviour for single-select, checkbox for multi-select. */
  multi?: boolean;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

/**
 * The selectable row used throughout onboarding and settings. Selection is
 * signalled by a border, a fill and an explicit mark — never colour alone.
 */
export const Choice = memo(function Choice({
  label,
  description,
  selected,
  onPress,
  multi = false,
  style,
  disabled = false,
}: ChoiceProps): React.ReactElement {
  const { colors, spacing, radius } = useTheme();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      style={({ pressed }) => [
        styles.container,
        {
          borderRadius: radius.lg,
          padding: spacing.lg,
          borderColor: selected ? colors.accent : colors.glassBorder,
          backgroundColor: selected ? colors.accentSoft : colors.glass,
          shadowColor: colors.accent,
          shadowOpacity: selected ? 0.4 : 0,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: selected ? 6 : 0,
          opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={styles.textBlock}>
        <Text variant="subheading">{label}</Text>
        {description ? (
          <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          multi ? styles.checkbox : styles.radio,
          {
            borderColor: selected ? colors.accent : colors.glassBorder,
            backgroundColor: selected ? colors.accent : 'transparent',
          },
        ]}
      >
        {selected ? (
          <Text variant="caption" color="onAccent">
            {multi ? '✓' : '●'}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

/** Compact pill choice used for numeric options like training days. */
export const ChoicePill = memo(function ChoicePill({
  label,
  selected,
  onPress,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { colors, radius, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pill,
        {
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          borderColor: selected ? colors.accent : colors.glassBorder,
          backgroundColor: selected ? colors.accentSoft : colors.glass,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text variant="bodyStrong" color={selected ? 'accent' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
});

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null;
  onChange: (id: T) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A two-or-three-way switch inside a single glass well.
 *
 * Used where the options are short, mutually exclusive and better compared
 * side by side than stacked — sex, units, a time range. The selected segment
 * lifts out of the well with a cyan rim and cyan label; the well itself stays
 * recessed, which is what makes the lift visible. Each segment is a radio to
 * VoiceOver, so the selection is announced rather than inferred from colour.
 */
function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedProps<T>): React.ReactElement {
  const { colors, radius, spacing } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.segmentTrack,
        {
          borderRadius: radius.pill,
          borderColor: colors.fieldBorder,
          backgroundColor: colors.field,
          padding: spacing.xs,
          gap: spacing.xs,
        },
        style,
      ]}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.segment,
              {
                borderRadius: radius.pill,
                borderColor: selected ? colors.accent : 'transparent',
                shadowColor: colors.accent,
                shadowOpacity: selected ? 0.45 : 0,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 4 },
                elevation: selected ? 5 : 0,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            {selected ? (
              <LinearGradient
                colors={[colors.glassStrong, colors.glass]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
              />
            ) : null}
            <Text variant="subheading" color={selected ? 'accent' : 'secondary'} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// `memo` erases the generic, so the memoised component is cast back to the
// function's own type. Without this every caller infers `T` as `string` and
// loses the union that makes `onChange` typed.
export const Segmented = memo(SegmentedControl) as typeof SegmentedControl;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    minHeight: MIN_TOUCH_TARGET + 8,
  },
  textBlock: { flex: 1, paddingRight: 12 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentTrack: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: StyleSheet.hairlineWidth * 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
