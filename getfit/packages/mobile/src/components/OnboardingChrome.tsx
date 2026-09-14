import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';

/** The step dots that run across the top of every onboarding screen. */
export const OnboardingProgress = memo(function OnboardingProgress({
  step,
  total,
}: {
  step: number;
  total: number;
}): React.ReactElement {
  const { colors, spacing, reduceMotion } = useTheme();
  const progress = useRef(new Animated.Value(step / total)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(step / total);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: step / total,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, step, total]);

  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${total}`}
      accessibilityValue={{ min: 0, max: total, now: step }}
    >
      <View style={[styles.track, { backgroundColor: colors.glassBorder, marginTop: spacing.md }]}>
        <Animated.View style={[styles.fill, { width, backgroundColor: colors.accent }]} />
      </View>
      <Text variant="micro" color="muted" uppercase style={{ marginTop: spacing.sm }}>
        Step {step} of {total}
      </Text>
    </View>
  );
});

/** Title block plus back control shared by every onboarding screen. */
export const OnboardingHeader = memo(function OnboardingHeader({
  title,
  subtitle,
  step,
  total,
  onBack,
}: {
  title: string;
  subtitle?: string;
  step: number;
  total: number;
  onBack?: () => void;
}): React.ReactElement {
  const { colors, spacing } = useTheme();

  return (
    <View>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          style={({ pressed }) => [
            styles.back,
            { borderColor: colors.glassBorder, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text variant="bodyStrong" color="secondary">
            ←
          </Text>
        </Pressable>
      ) : (
        <View style={styles.backSpacer} />
      )}

      <OnboardingProgress step={step} total={total} />

      <Text variant="title" style={{ marginTop: spacing.xxl }} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  track: { height: 4, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  back: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backSpacer: { height: MIN_TOUCH_TARGET },
});
