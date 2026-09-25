import React, { memo, useCallback, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Sits under the field — a hint, or why the value is being asked for. */
  hint?: string;
  /** Shown instead of the hint, and marks the field invalid to screen readers. */
  error?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The single text input in the app.
 *
 * A recessed glass well with a pill rim that lights up cyan on focus. Every
 * screen that takes typed text goes through here, so focus, error and
 * placeholder treatment cannot drift apart between one form and the next.
 */
export const TextField = memo(function TextField({
  label,
  hint,
  error,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextFieldProps): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  const [focused, setFocused] = useState(false);

  const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    (event) => {
      setFocused(true);
      onFocus?.(event);
    },
    [onFocus],
  );

  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (event) => {
      setFocused(false);
      onBlur?.(event);
    },
    [onBlur],
  );

  const borderColor = error
    ? colors.danger
    : focused
      ? colors.fieldBorderFocused
      : colors.fieldBorder;

  return (
    <View style={style}>
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>

      <TextInput
        accessibilityLabel={label}
        // The label is already rendered above, so this only has to carry the
        // things a sighted user reads from position and colour.
        aria-invalid={Boolean(error)}
        placeholderTextColor={colors.textMuted}
        {...rest}
        onFocus={handleFocus}
        onBlur={handleBlur}
        style={[
          styles.input,
          {
            marginTop: spacing.sm,
            borderRadius: radius.pill,
            paddingHorizontal: spacing.xl,
            borderColor,
            backgroundColor: colors.field,
            color: colors.text,
            shadowColor: colors.accent,
            shadowOpacity: focused ? 0.4 : 0,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 4 },
            elevation: focused ? 5 : 0,
          },
        ]}
      />

      {error ? (
        <Text variant="caption" color="danger" style={{ marginTop: spacing.xs }}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  input: {
    borderWidth: StyleSheet.hairlineWidth * 3,
    paddingVertical: 14,
    fontSize: 17,
    minHeight: 56,
  },
});
