import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
          borderRadius: radius.md,
          padding: spacing.lg,
          borderColor: selected ? colors.accent : colors.glassBorder,
          backgroundColor: selected ? colors.accentSoft : colors.glass,
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
          borderRadius: radius.md,
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
});
