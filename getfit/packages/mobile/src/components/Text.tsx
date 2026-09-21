import React, { memo } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme } from '../theme';
import type { TypeVariant } from '../theme/tokens';

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: 'primary' | 'secondary' | 'muted' | 'accent' | 'success' | 'danger' | 'warning' | 'inverse' | 'onAccent';
  align?: TextStyle['textAlign'];
  /** Renders the string uppercased with tracking — used for section eyebrows. */
  uppercase?: boolean;
  tabular?: boolean;
}

/**
 * The single text primitive. Everything renders through here so the type scale,
 * colour roles and Dynamic Type behaviour stay consistent across the app.
 */
export const Text = memo(function Text({
  variant = 'body',
  color = 'primary',
  align,
  uppercase,
  tabular,
  style,
  ...rest
}: TextProps): React.ReactElement {
  const { colors, typeScale } = useTheme();
  const scale = typeScale[variant];

  const colorValue = {
    primary: colors.text,
    secondary: colors.textSecondary,
    muted: colors.textMuted,
    accent: colors.accentText,
    success: colors.success,
    danger: colors.danger,
    warning: colors.warning,
    inverse: colors.textInverse,
    onAccent: colors.onAccent,
  }[color];

  return (
    <RNText
      // Dynamic Type is respected but capped so long labels cannot destroy
      // the layout at the largest accessibility sizes.
      maxFontSizeMultiplier={variant === 'metricLarge' || variant === 'metric' ? 1.3 : 1.6}
      {...rest}
      style={[
        {
          fontSize: scale.size,
          lineHeight: scale.lineHeight,
          fontWeight: scale.weight,
          letterSpacing: uppercase ? 1.4 : scale.letterSpacing,
          color: colorValue,
          textAlign: align,
          textTransform: uppercase ? 'uppercase' : undefined,
          fontVariant: tabular ? ['tabular-nums'] : undefined,
        },
        style,
      ]}
    />
  );
});
