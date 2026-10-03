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

/**
 * The single strongest call to action on a screen.
 *
 * It is glass like everything else, but lit: a brighter fill, a cyan rim and a
 * cyan glow underneath it. That is what separates it from a secondary action,
 * so the two never have to be told apart by colour alone.
 */
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
          styles.glow,
          {
            minHeight: size === 'large' ? 56 : MIN_TOUCH_TARGET,
            borderRadius: radius.pill,
            borderWidth: StyleSheet.hairlineWidth * 3,
            borderColor: colors.glassEdge,
            opacity: disabled ? 0.42 : 1,
            shadowColor: colors.accent,
          },
        ]}
      >
        <LinearGradient
          colors={[colors.glassStrong, colors.glass]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* The lit top edge, the same one the cards carry. */}
        <LinearGradient
          colors={['transparent', colors.glassEdge, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.topEdge}
          pointerEvents="none"
        />
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
            borderRadius: radius.pill,
            borderWidth: StyleSheet.hairlineWidth * 2,
            borderColor: colors.glassBorder,
            backgroundColor: colors.glass,
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
  },
  glow: {
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 8,
  },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
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
