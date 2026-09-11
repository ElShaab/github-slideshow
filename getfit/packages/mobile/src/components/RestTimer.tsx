import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import { formatDuration } from '@getfit/shared';
import { useTheme } from '../theme';
import { GlassButton, SecondaryButton } from './Buttons';
import { Text } from './Text';

export interface RestTimerProps {
  seconds: number;
  onComplete: () => void;
  onSkip: () => void;
  /** Label for what comes next, e.g. "Set 2 of 3". */
  nextLabel: string;
}

/**
 * Rest timer with a countdown ring. The countdown is derived from wall-clock
 * time rather than tick accumulation, so it stays accurate if the app is
 * backgrounded mid-rest.
 */
export const RestTimer = memo(function RestTimer({
  seconds,
  onComplete,
  onSkip,
  nextLabel,
}: RestTimerProps): React.ReactElement {
  const { colors, spacing, reduceMotion } = useTheme();
  const [remaining, setRemaining] = useState(seconds);
  const [extra, setExtra] = useState(0);
  const endsAt = useRef(Date.now() + seconds * 1000);
  const finished = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    endsAt.current = Date.now() + (seconds + extra) * 1000;
    finished.current = false;
    setRemaining(seconds + extra);
  }, [extra, seconds]);

  useEffect(() => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.round((endsAt.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !finished.current) {
        finished.current = true;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        onComplete();
      }
    }, 250);
    return () => clearInterval(interval);
  }, [onComplete]);

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  const total = seconds + extra;
  const progress = total > 0 ? 1 - remaining / total : 1;

  const ring = useMemo(() => {
    const size = 200;
    const strokeWidth = 8;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    return { size, strokeWidth, radius, circumference };
  }, []);

  const addTime = useCallback(() => {
    setExtra((current) => current + 30);
  }, []);

  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <View style={styles.container} accessible accessibilityLiveRegion="polite">
      <Text variant="micro" color="muted" uppercase>
        Rest
      </Text>

      <Animated.View style={[styles.ringWrapper, { marginTop: spacing.lg, opacity: glow }]}>
        <Svg width={ring.size} height={ring.size}>
          <Circle
            cx={ring.size / 2}
            cy={ring.size / 2}
            r={ring.radius}
            stroke={colors.glassBorder}
            strokeWidth={ring.strokeWidth}
            fill="none"
          />
          <Circle
            cx={ring.size / 2}
            cy={ring.size / 2}
            r={ring.radius}
            stroke={colors.accent}
            strokeWidth={ring.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={ring.circumference}
            strokeDashoffset={ring.circumference * progress}
            transform={`rotate(-90 ${ring.size / 2} ${ring.size / 2})`}
          />
        </Svg>

        <View style={styles.ringContent} pointerEvents="none">
          <Text variant="metricLarge" tabular accessibilityLabel={`${remaining} seconds remaining`}>
            {formatDuration(remaining)}
          </Text>
          <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
            {nextLabel}
          </Text>
        </View>
      </Animated.View>

      <View style={[styles.actions, { marginTop: spacing.xxl, gap: spacing.md }]}>
        <GlassButton label="+30s" onPress={addTime} accessibilityHint="Adds thirty seconds of rest" />
        <SecondaryButton
          label="Skip rest"
          onPress={onSkip}
          fullWidth={false}
          style={styles.skip}
          accessibilityHint="Starts the next set immediately"
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  ringWrapper: { alignItems: 'center', justifyContent: 'center' },
  ringContent: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  skip: { minWidth: 150 },
});
