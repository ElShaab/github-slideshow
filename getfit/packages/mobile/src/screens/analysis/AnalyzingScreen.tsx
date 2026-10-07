import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Line, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { BodyAssessment, BodyMeasurements } from '@getfit/shared';
import { ErrorState, Screen, Text } from '../../components';
import { ApiError } from '../../api/client';
import { assessmentApi } from '../../api/endpoints';
import { useTheme } from '../../theme';

/**
 * What the analysis is actually doing, named honestly. The work is a handful of
 * formulas and finishes in milliseconds; the sequence is a transition, not a
 * simulation of effort, so it is kept short.
 */
const PHASES = [
  'Checking your measurements',
  'Calculating body composition',
  'Building your figure',
];

/** How long the transition plays for, at most, once the request has returned. */
const PHASE_MS = 520;

export interface AnalyzingScreenProps {
  /** The tape readings the analysis is computed from. */
  measurements: BodyMeasurements;
  /** Optional progress photo. Stored privately; never analysed. */
  photoUri?: string | null;
  /** Weight override for a weekly reassessment. */
  weightKg?: number;
  mode: 'initial' | 'weekly';
  onComplete: (assessment: BodyAssessment) => void;
  onCancel?: () => void;
}

/**
 * The analysis sequence.
 *
 * The real request runs immediately; the phase narration plays alongside it and
 * the screen advances as soon as both the request and a short minimum run have
 * finished — so the wait is never padded beyond what the work takes.
 */
export function AnalyzingScreen({
  measurements,
  photoUri,
  weightKg,
  mode,
  onComplete,
  onCancel,
}: AnalyzingScreenProps): React.ReactElement {
  const { colors, spacing, reduceMotion } = useTheme();
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const scan = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      scan.setValue(0.5);
      pulse.setValue(0.5);
      return;
    }
    const scanLoop = Animated.loop(
      Animated.timing(scan, {
        toValue: 1,
        duration: 2200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    scanLoop.start();
    pulseLoop.start();
    return () => {
      scanLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, reduceMotion, scan]);

  // Advance the narration on a fixed cadence.
  useEffect(() => {
    const interval = setInterval(() => {
      setPhase((current) => Math.min(current + 1, PHASES.length - 1));
    }, PHASE_MS);
    return () => clearInterval(interval);
  }, [attempt]);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: reduceMotion ? 0 : 200,
      useNativeDriver: true,
    }).start();
  }, [fade, phase, reduceMotion]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setPhase(0);

    const run = async (): Promise<void> => {
      const startedAt = Date.now();
      try {
        const submission = { measurements, photoUri, weightKg };
        const response =
          mode === 'initial'
            ? await assessmentApi.runInitial(submission)
            : await assessmentApi.runWeekly(submission);

        // Let the sequence play out to at least the final phase, but no longer.
        const elapsed = Date.now() - startedAt;
        const minimum = PHASES.length * PHASE_MS;
        if (elapsed < minimum) {
          await new Promise((resolve) => setTimeout(resolve, minimum - elapsed));
        }
        if (cancelled) return;
        onComplete(response.assessment);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Something went wrong.');
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [attempt, measurements, mode, onComplete, photoUri, weightKg]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (error) {
    return <ErrorState message={error} onRetry={onCancel ? onCancel : retry} />;
  }

  const scanTranslate = scan.interpolate({ inputRange: [0, 1], outputRange: [-40, 300] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });

  return (
    <Screen scroll={false} contentStyle={styles.container}>
      <View style={styles.stage} accessible accessibilityLabel="Calculating your body composition">
        <Animated.View style={{ opacity: glow }}>
          <Svg width={260} height={300} viewBox="0 0 260 300">
            <Defs>
              <RadialGradient id="analysis-glow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={colors.accent} stopOpacity={0.3} />
                <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect x={0} y={0} width={260} height={300} fill="url(#analysis-glow)" />

            {/* Holographic grid the scan line travels across. */}
            {Array.from({ length: 9 }, (_unused, index) => (
              <Line
                key={`h-${index}`}
                x1={20}
                y1={30 + index * 30}
                x2={240}
                y2={30 + index * 30}
                stroke={colors.accent}
                strokeWidth={0.6}
                opacity={0.22}
              />
            ))}
            {Array.from({ length: 8 }, (_unused, index) => (
              <Line
                key={`v-${index}`}
                x1={20 + index * 31}
                y1={20}
                x2={20 + index * 31}
                y2={280}
                stroke={colors.accent}
                strokeWidth={0.6}
                opacity={0.16}
              />
            ))}

            {/* Particle field. */}
            {PARTICLES.map((particle, index) => (
              <Circle
                key={index}
                cx={particle.x}
                cy={particle.y}
                r={particle.r}
                fill={colors.accent}
                opacity={particle.o}
              />
            ))}
          </Svg>
        </Animated.View>

        {!reduceMotion ? (
          <Animated.View
            style={[
              styles.scanLine,
              { backgroundColor: colors.accent, transform: [{ translateY: scanTranslate }] },
            ]}
            pointerEvents="none"
          />
        ) : null}
      </View>

      <View style={styles.copy}>
        <Text variant="micro" color="accent" uppercase>
          Calculating
        </Text>
        <Animated.View style={{ opacity: fade, marginTop: spacing.lg }}>
          <Text variant="heading" align="center" accessibilityLiveRegion="polite">
            {PHASES[phase]}…
          </Text>
        </Animated.View>

        <View style={[styles.dots, { marginTop: spacing.xxl, gap: spacing.sm }]}>
          {PHASES.map((label, index) => (
            <View
              key={label}
              style={[
                styles.dot,
                {
                  backgroundColor: index <= phase ? colors.accent : colors.glassBorder,
                  width: index === phase ? 22 : 6,
                },
              ]}
            />
          ))}
        </View>
      </View>
    </Screen>
  );
}

/** A fixed particle field — deterministic so it never flickers on re-render. */
const PARTICLES = [
  { x: 48, y: 62, r: 1.6, o: 0.5 },
  { x: 96, y: 40, r: 1.1, o: 0.35 },
  { x: 150, y: 78, r: 1.8, o: 0.45 },
  { x: 200, y: 54, r: 1.2, o: 0.3 },
  { x: 68, y: 140, r: 1.4, o: 0.4 },
  { x: 128, y: 118, r: 2, o: 0.55 },
  { x: 188, y: 152, r: 1.3, o: 0.35 },
  { x: 42, y: 210, r: 1.7, o: 0.45 },
  { x: 112, y: 232, r: 1.2, o: 0.3 },
  { x: 172, y: 206, r: 1.6, o: 0.42 },
  { x: 222, y: 246, r: 1.1, o: 0.28 },
  { x: 80, y: 268, r: 1.5, o: 0.36 },
];

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stage: { height: 300, justifyContent: 'center', overflow: 'hidden' },
  scanLine: { position: 'absolute', left: 0, right: 0, height: 2, opacity: 0.85 },
  copy: { alignItems: 'center', marginTop: 40 },
  dots: { flexDirection: 'row', alignItems: 'center' },
  dot: { height: 6, borderRadius: 3 },
});
