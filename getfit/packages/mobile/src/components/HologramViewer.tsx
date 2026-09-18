import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import type { HologramData } from '@getfit/shared';
import { useTheme } from '../theme';
import { buildGeometry, VIEW_HEIGHT, VIEW_WIDTH } from './hologram/geometry';

export interface HologramViewerProps {
  data: HologramData;
  /** Rendered height in points. Width follows the figure's aspect ratio. */
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** Slow continuous turn. Disabled automatically under reduced motion. */
  rotate?: boolean;
  /** The cyan scan sweep used during and just after analysis. */
  scan?: boolean;
  /** Screen-reader description; a sensible default is derived from the data. */
  accessibilityLabel?: string;
}

/**
 * HologramViewer
 *
 * Renders a stylised athletic hologram of the user's CURRENT estimated body
 * composition. It never displays the user's photograph and never projects a
 * future physique — the geometry comes entirely from the stored estimate.
 *
 * The renderer sits behind the HologramData contract, so a real 3D model can
 * replace this SVG implementation without touching any screen that uses it.
 * Layers are stacked as separate SVGs so every animation can run on the native
 * driver rather than re-rendering vector props each frame.
 */
export const HologramViewer = memo(function HologramViewer({
  data,
  size = 340,
  style,
  rotate = true,
  scan = false,
  accessibilityLabel,
}: HologramViewerProps): React.ReactElement {
  const { colors, reduceMotion } = useTheme();
  const geometry = useMemo(() => buildGeometry(data), [data]);

  const turn = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    if (reduceMotion || !rotate) {
      turn.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, rotate, turn]);

  useEffect(() => {
    if (reduceMotion || !scan) {
      sweep.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, scan, sweep]);

  useEffect(() => {
    if (reduceMotion) {
      breathe.setValue(0.6);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [breathe, reduceMotion]);

  // The turn is faked by squashing the figure horizontally through the
  // rotation — cheap, smooth on the native driver, and it reads as a slow orbit.
  const scaleX = turn.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [1, 0.42, 1, 0.42, 1],
  });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  const width = (size * VIEW_WIDTH) / VIEW_HEIGHT;
  const scanTranslate = sweep.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.15, size] });

  const accent = data.accentPalette?.[0] ?? colors.accent;
  const accentBright = data.accentPalette?.[2] ?? colors.accentStrong;

  const label =
    accessibilityLabel ??
    `Body hologram of your current estimated composition: ${Math.round(
      data.bodyFatNormalized * 100,
    )} percent relative body fat, ${Math.round(
      data.muscleNormalized * 100,
    )} percent relative muscle development.`;

  return (
    <View
      style={[{ width, height: size }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {/* Stage: the glow and floor the figure stands on. */}
      <Svg
        width={width}
        height={size}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Defs>
          <RadialGradient id="hg-stage" cx="50%" cy="45%" r="62%">
            <Stop offset="0%" stopColor={accent} stopOpacity={0.2} />
            <Stop offset="60%" stopColor={accent} stopOpacity={0.055} />
            <Stop offset="100%" stopColor={accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#hg-stage)" />
        <Ellipse cx={VIEW_WIDTH / 2} cy={VIEW_HEIGHT - 20} rx={74} ry={12} fill={accent} opacity={0.16} />
      </Svg>

      <Animated.View
        style={[StyleSheet.absoluteFill, { transform: [{ scaleX }] }]}
        pointerEvents="none"
      >
        {/* Outer bloom, gently pulsing. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glowOpacity }]}>
          <Svg width={width} height={size} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
            <Path d={geometry.torsoPath} stroke={accent} strokeWidth={7} fill="none" opacity={0.16} />
            <Path d={geometry.leftLegPath} stroke={accent} strokeWidth={6} fill="none" opacity={0.14} />
            <Path d={geometry.rightLegPath} stroke={accent} strokeWidth={6} fill="none" opacity={0.14} />
            <Path d={geometry.leftArmPath} stroke={accent} strokeWidth={6} fill="none" opacity={0.13} />
            <Path d={geometry.rightArmPath} stroke={accent} strokeWidth={6} fill="none" opacity={0.13} />
            <Circle
              cx={geometry.head.cx}
              cy={geometry.head.cy}
              r={geometry.head.r + 3}
              stroke={accent}
              strokeWidth={6}
              fill="none"
              opacity={0.13}
            />
          </Svg>
        </Animated.View>

        {/* The figure itself. */}
        <Svg
          width={width}
          height={size}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <SvgLinearGradient id="hg-body" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={accentBright} stopOpacity={0.3} />
              <Stop offset="45%" stopColor={accent} stopOpacity={0.2} />
              <Stop offset="100%" stopColor={accent} stopOpacity={0.1} />
            </SvgLinearGradient>
          </Defs>

          {/* Arms sit behind the torso so the shoulder line stays clean. */}
          <Path d={geometry.leftArmPath} fill="url(#hg-body)" stroke={accent} strokeWidth={1.1} strokeOpacity={0.6} />
          <Path d={geometry.rightArmPath} fill="url(#hg-body)" stroke={accent} strokeWidth={1.1} strokeOpacity={0.6} />
          <Path d={geometry.leftLegPath} fill="url(#hg-body)" stroke={accentBright} strokeWidth={1.3} strokeOpacity={0.75} />
          <Path d={geometry.rightLegPath} fill="url(#hg-body)" stroke={accentBright} strokeWidth={1.3} strokeOpacity={0.75} />
          <Path d={geometry.torsoPath} fill="url(#hg-body)" stroke={accentBright} strokeWidth={1.4} strokeOpacity={0.82} />
          <Circle
            cx={geometry.head.cx}
            cy={geometry.head.cy}
            r={geometry.head.r}
            fill="url(#hg-body)"
            stroke={accentBright}
            strokeWidth={1.4}
            strokeOpacity={0.82}
          />

          {/* Muscle plates, brightened by estimated development. */}
          {geometry.plates.map((plate, index) => (
            <Path
              key={`plate-${index}`}
              d={plate.d}
              fill={accentBright}
              opacity={0.06 + plate.intensity * 0.2}
              stroke={accentBright}
              strokeWidth={0.7}
              strokeOpacity={0.22 + plate.intensity * 0.3}
            />
          ))}

          {/* Wireframe contours wrapping the volume, plus vertical seams. */}
          {geometry.contours.map((contour, index) => (
            <Path
              key={`contour-${index}`}
              d={contour.d}
              stroke={accentBright}
              strokeWidth={0.9}
              fill="none"
              opacity={contour.opacity * 0.8}
            />
          ))}
          {geometry.seams.map((seam, index) => (
            <Path
              key={`seam-${index}`}
              d={seam}
              stroke={accent}
              strokeWidth={0.7}
              fill="none"
              opacity={0.32}
              strokeDasharray="3 5"
            />
          ))}
        </Svg>
      </Animated.View>

      {/* Scan sweep, shown only while an analysis is running. */}
      {scan && !reduceMotion ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.scanBeam,
            { height: size * 0.16, transform: [{ translateY: scanTranslate }] },
          ]}
        >
          <LinearGradient
            colors={['transparent', accentBright, 'transparent']}
            locations={[0, 0.5, 1]}
            style={[StyleSheet.absoluteFill, { opacity: 0.45 }]}
          />
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  scanBeam: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
});
