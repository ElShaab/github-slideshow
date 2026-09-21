import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
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
  // The green fringe. Version 1 payloads have no fourth entry, so they fall
  // back to the body colour, which draws a rim that simply is not green.
  const fatColor = data.accentPalette?.[3] ?? accent;
  // Once the layer is more than a rim it is what the halo is made of, so the
  // bloom turns green — the difference you notice between the two references
  // before you have looked at either silhouette.
  const bloom = geometry.adiposity > 0.5 ? fatColor : accent;
  const outerBody = [
    geometry.leftArmPath,
    geometry.rightArmPath,
    geometry.leftLegPath,
    geometry.rightLegPath,
    geometry.torsoPath,
  ];

  const label =
    accessibilityLabel ??
    (data.bodyFatBand !== undefined
      ? `Body hologram of your current estimate: drawn at about ${data.bodyFatBand} percent body fat, ` +
        `with ${Math.round(data.muscleNormalized * 100)} percent relative muscle development.`
      : `Body hologram of your current estimated composition: ${Math.round(
          data.bodyFatNormalized * 100,
        )} percent relative body fat, ${Math.round(
          data.muscleNormalized * 100,
        )} percent relative muscle development.`);

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
        {/* Outer bloom, gently pulsing. It takes the layer's colour, so the
            halo around a heavy figure is green and a lean one's is cyan —
            the difference between the two reference renders at a glance. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: glowOpacity }]}>
          <Svg width={width} height={size} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
            <Path
              d={geometry.torsoPath}
              stroke={bloom}
              strokeWidth={7 + geometry.fatLayer.thickness}
              fill="none"
              opacity={0.16}
            />
            <Path d={geometry.leftLegPath} stroke={bloom} strokeWidth={6} fill="none" opacity={0.14} />
            <Path d={geometry.rightLegPath} stroke={bloom} strokeWidth={6} fill="none" opacity={0.14} />
            <Path d={geometry.leftArmPath} stroke={bloom} strokeWidth={6} fill="none" opacity={0.13} />
            <Path d={geometry.rightArmPath} stroke={bloom} strokeWidth={6} fill="none" opacity={0.13} />
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

          {/*
            The muscle body, drawn in full at every band.

            Fat is translucent in both references — the heavier figure is the
            same body seen through more, not a blank shell — so this is the
            bottom layer and the fat goes over it, rather than the other way
            around. Arms sit behind the torso so the shoulder line stays clean.
          */}
          <Path d={geometry.muscle.leftArmPath} fill="url(#hg-body)" stroke={accent} strokeWidth={1.1} strokeOpacity={0.6} />
          <Path d={geometry.muscle.rightArmPath} fill="url(#hg-body)" stroke={accent} strokeWidth={1.1} strokeOpacity={0.6} />
          <Path d={geometry.muscle.leftLegPath} fill="url(#hg-body)" stroke={accentBright} strokeWidth={1.3} strokeOpacity={0.75} />
          <Path d={geometry.muscle.rightLegPath} fill="url(#hg-body)" stroke={accentBright} strokeWidth={1.3} strokeOpacity={0.75} />
          <Path d={geometry.muscle.torsoPath} fill="url(#hg-body)" stroke={accentBright} strokeWidth={1.4} strokeOpacity={0.82} />
          <Circle
            cx={geometry.head.cx}
            cy={geometry.head.cy}
            r={geometry.muscle.headRadius}
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

          {/* Muscle fibre, visible only while there is little covering it. */}
          {geometry.striations.map((line, index) => (
            <Path
              key={`striation-${index}`}
              d={line.d}
              stroke={accentBright}
              strokeWidth={0.6}
              fill="none"
              opacity={line.opacity}
              strokeLinecap="round"
            />
          ))}

          {/* Soft folds, which only a covering layer can make. */}
          {geometry.softBands.map((band, index) => (
            <Path
              key={`band-${index}`}
              d={band.d}
              stroke={fatColor}
              strokeWidth={2.2}
              fill="none"
              opacity={band.opacity}
              strokeLinecap="round"
            />
          ))}

          {/*
            The subcutaneous layer, laid over the finished muscle body.

            The fill is translucent, so what is underneath reads through it
            rather than being replaced by it; the stroke adds the brighter edge
            where the layer is seen side-on, which is the green fringe in both
            references. On a lean figure the outer outline sits almost on the
            muscle one and this is a hairline; on a heavy one the gap between
            them is the whole layer.
          */}
          {/* The ring: fat with nothing but background behind it. Each path
              carries the outer body and its muscle counterpart as two
              subpaths, so the even-odd rule leaves only the gap filled. */}
          <G opacity={geometry.fatLayer.ring}>
            {geometry.fatRingPaths.map((d, index) => (
              <Path key={`fat-ring-${index}`} d={d} fill={fatColor} fillRule="evenodd" />
            ))}
          </G>

          {/* The wash: a light tint over everything, muscle included, which is
              what makes the layer read as something you see through. */}
          <G opacity={geometry.fatLayer.wash}>
            {outerBody.map((d, index) => (
              <Path key={`fat-wash-${index}`} d={d} fill={fatColor} />
            ))}
            <Circle
              cx={geometry.head.cx}
              cy={geometry.head.cy}
              r={geometry.head.r}
              fill={fatColor}
            />
          </G>

          <G opacity={geometry.fatLayer.rim}>
            {outerBody.map((d, index) => (
              <Path
                key={`fat-rim-${index}`}
                d={d}
                fill="none"
                stroke={fatColor}
                strokeWidth={1.4}
                strokeLinejoin="round"
              />
            ))}
          </G>

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
