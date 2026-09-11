import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { ErrorState, Screen, Text } from '../../components';
import { ApiError } from '../../api/client';
import { programApi } from '../../api/endpoints';
import { useTheme } from '../../theme';

const PHASES = [
  'Choosing your split',
  'Selecting exercises',
  'Balancing weekly volume',
  'Setting starting weights',
  'Fitting your session length',
];

/** Builds the program on the server and narrates the steps while it runs. */
export function GeneratingProgramScreen({
  onComplete,
}: {
  onComplete: () => void;
}): React.ReactElement {
  const { colors, spacing, reduceMotion } = useTheme();
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, spin]);

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((current) => Math.min(current + 1, PHASES.length - 1));
    }, 800);
    return () => clearInterval(interval);
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPhase(0);

    void (async () => {
      const startedAt = Date.now();
      try {
        await programApi.generate();
        const elapsed = Date.now() - startedAt;
        const minimum = PHASES.length * 800;
        if (elapsed < minimum) {
          await new Promise((resolve) => setTimeout(resolve, minimum - elapsed));
        }
        if (!cancelled) onComplete();
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, onComplete]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (error) return <ErrorState message={error} onRetry={retry} />;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Screen scroll={false} contentStyle={styles.container}>
      <Animated.View
        style={[
          styles.ring,
          { borderColor: colors.glassBorder, borderTopColor: colors.accent, transform: [{ rotate }] },
        ]}
      />

      <Text variant="micro" color="accent" uppercase style={{ marginTop: spacing.xxxl }}>
        Building your program
      </Text>
      <Text variant="heading" align="center" style={{ marginTop: spacing.md }} accessibilityLiveRegion="polite">
        {PHASES[phase]}…
      </Text>
      <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.lg, maxWidth: 300 }}>
        Every session is built around your equipment, your goals and the exercises
        you chose.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ring: { width: 96, height: 96, borderRadius: 48, borderWidth: 3 },
});
