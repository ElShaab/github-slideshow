import React, { memo, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';

interface BaseButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Defaults to the label; set when the label alone is not descriptive. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  size?: 'medium' | 'large';
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

function usePressAnimation(disabled: boolean, reduceMotion: boolean) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = useCallback(
    (value: number) => {
      if (reduceMotion || disabled) return;
      Animated.spring(scale, {
        toValue: value,
        useNativeDriver: true,
        speed: 40,
        bounciness: 4,
      }).start();
    },
    [disabled, reduceMotion, scale],
  );

  return {
    scale,
    onPressIn: () => animateTo(0.97),
    onPressOut: () => animateTo(1),
  };
}

/** The single strongest call to action on a screen. */
export const PrimaryButton = memo(function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  size = 'large',
  icon,
  fullWidth = true,
}: BaseButtonProps): React.ReactElement {
  const { colors, radius, spacing, reduceMotion } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressAnimation(disabled || loading, reduceMotion);
  const isInactive = disabled || loading;

  const handlePress = useCallback(() => {
    if (isInactive) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    onPress();
  }, [isInactive, onPress]);

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth && styles.fullWidth, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={isInactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isInactive, busy: loading }}
        style={[
          styles.base,
          {
            minHeight: size === 'large' ? 56 : MIN_TOUCH_TARGET,
            borderRadius: radius.md,
            opacity: disabled ? 0.42 : 1,
            shadowColor: colors.accent,
          },
        ]}
      >
        <LinearGradient
          colors={[colors.accentStrong, colors.accent]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.content, { gap: spacing.sm }]}>
          {loading ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <>
              {icon}
              <Text variant="subheading" color="onAccent" numberOfLines={1}>
                {label}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

/** A glass-backed secondary action. */
export const SecondaryButton = memo(function SecondaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  size = 'large',
  icon,
  fullWidth = true,
}: BaseButtonProps): React.ReactElement {
  const { colors, radius, spacing, reduceMotion } = useTheme();
  const { scale, onPressIn, onPressOut } = usePressAnimation(disabled || loading, reduceMotion);
  const isInactive = disabled || loading;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, fullWidth && styles.fullWidth, style]}>
      <Pressable
        onPress={isInactive ? undefined : onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={isInactive}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: isInactive, busy: loading }}
        style={[
          styles.base,
          {
            minHeight: size === 'large' ? 56 : MIN_TOUCH_TARGET,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.glassBorder,
            backgroundColor: colors.glassStrong,
            opacity: disabled ? 0.42 : 1,
          },
        ]}
      >
        <View style={[styles.content, { gap: spacing.sm }]}>
          {loading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              {icon}
              <Text variant="subheading" numberOfLines={1}>
                {label}
              </Text>
            </>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
});

/** A borderless action for tertiary choices such as "Skip" or "Back". */
export const GlassButton = memo(function GlassButton({
  label,
  onPress,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  icon,
  fullWidth = false,
}: BaseButtonProps): React.ReactElement {
  const { colors, radius, spacing } = useTheme();

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: MIN_TOUCH_TARGET,
          paddingHorizontal: spacing.xl,
          borderRadius: radius.pill,
          backgroundColor: pressed ? colors.glassStrong : 'transparent',
          opacity: disabled ? 0.4 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
    >
      <View style={[styles.content, { gap: spacing.sm }]}>
        {icon}
        <Text variant="bodyStrong" color="secondary">
          {label}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
});
