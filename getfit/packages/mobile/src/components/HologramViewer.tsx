import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, {
  ClipPath,
  Defs,
  Ellipse,
  FeGaussianBlur,
  Filter,
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
import { Hologram3D } from './Hologram3D';
import { frameFor } from './hologram/frameSources';

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
  /**
   * Set false to draw the flat figure even where GL is available. Used by the
   * small inline holograms, where a second GL surface costs more than the
   * depth is worth at that size.
   */
  volumetric?: boolean;
}

/**
 * HologramViewer
 *
 * Renders a stylised anatomical hologram of the user's CURRENT estimated body
 * composition. It never displays the user's photograph and never projects a
 * future physique — the geometry comes entirely from the stored estimate.
 *
 * The stack, bottom to top: the stage, the outer bloom, the muscle body with
 * its bellies and fibres, the scanned-surface point cloud clipped to it, and
 * finally the subcutaneous layer laid over the lot. Fat goes on top and stays
 * translucent, which is why the anatomy reads through it at every band.
 *
 * The renderer sits behind the HologramData contract, so a real 3D model can
 * replace this SVG implementation without touching any screen that uses it.
 */
export const HologramViewer = memo(function HologramViewer({
  data,
  size = 340,
  style,
  rotate = true,
  scan = false,
  accessibilityLabel,
  volumetric = true,
}: HologramViewerProps): React.ReactElement {
  const { colors, reduceMotion } = useTheme();
  const geometry = useMemo(() => buildGeometry(data), [data]);

  // A device that cannot give us a GL context still gets a figure. The flat
  // renderer lofts from the same widths, so the fallback is the same body seen
  // flat rather than a different one.
  const [glFailed, setGlFailed] = useState(false);
  const onGlFailure = useCallback((error: unknown) => {
    if (__DEV__) console.warn('Hologram fell back to the flat renderer', error);
    setGlFailed(true);
  }, []);

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
  const muscleBody = [
    geometry.muscle.leftArmPath,
    geometry.muscle.rightArmPath,
    geometry.muscle.leftLegPath,
    geometry.muscle.rightLegPath,
    geometry.muscle.torsoPath,
    geometry.muscle.neckPath,
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

  // A rendered frame for this band, when one exists. It is the anatomy as it
  // was actually modelled rather than as this app approximates it, so it wins
  // — but only for the bands it was rendered at. See `frameFor`.
  const frame = frameFor(data.bodyFatBand);
  if (frame !== null) {
    return (
      <View
        style={[{ width, height: size }, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
      >
        {/* Behind the figure: the same stage glow the drawn one stands on, so
            a rendered band and a procedural one share a background. */}
        <Svg
          width={width}
          height={size}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient id="hg-frame-stage" cx="50%" cy="45%" r="62%">
              <Stop offset="0%" stopColor={accent} stopOpacity={0.2} />
              <Stop offset="60%" stopColor={accent} stopOpacity={0.055} />
              <Stop offset="100%" stopColor={accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#hg-frame-stage)" />
          <Ellipse
            cx={VIEW_WIDTH / 2}
            cy={VIEW_HEIGHT - 16}
            rx={80}
            ry={12}
            fill={accent}
            opacity={0.16}
          />
        </Svg>

        <Image
          source={frame}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessible={false}
        />
      </View>
    );
  }

  if (volumetric && !glFailed) {
    return (
      <View
        style={[{ width, height: size }, style]}
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
      >
        <Hologram3D
          data={data}
          size={size}
          width={width}
          rotate={rotate && !reduceMotion}
          onFailure={onGlFailure}
        />
      </View>
    );
  }

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
        <Ellipse cx={VIEW_WIDTH / 2} cy={VIEW_HEIGHT - 16} rx={80} ry={12} fill={accent} opacity={0.16} />
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
            <Defs>
              <Filter id="hg-bloom" x="-30%" y="-15%" width="160%" height="130%">
                <FeGaussianBlur stdDeviation={5} />
              </Filter>
            </Defs>
            <G filter="url(#hg-bloom)">
              {outerBody.map((d, index) => (
                <Path
                  key={`bloom-${index}`}
                  d={d}
                  stroke={bloom}
                  strokeWidth={4 + geometry.fatLayer.thickness * 0.6}
                  fill="none"
                  opacity={0.34}
                />
              ))}
              <Path d={geometry.headPath} stroke={accentBright} strokeWidth={5} fill="none" opacity={0.4} />
            </G>
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
              <Stop offset="0%" stopColor={accentBright} stopOpacity={0.34} />
              <Stop offset="45%" stopColor={accent} stopOpacity={0.22} />
              <Stop offset="100%" stopColor={accent} stopOpacity={0.12} />
            </SvgLinearGradient>
            <SvgLinearGradient id="hg-head" x1="0.2" y1="0" x2="0.8" y2="1">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.9} />
              <Stop offset="45%" stopColor={accentBright} stopOpacity={0.62} />
              <Stop offset="100%" stopColor={accent} stopOpacity={0.38} />
            </SvgLinearGradient>
            {/* The point cloud is scattered over the whole frame and clipped
                to the body, which is simpler and more accurate than testing
                each dot against a dozen curves. */}
            <ClipPath id="hg-skin">
              {muscleBody.map((d, index) => (
                <Path key={`clip-${index}`} d={d} />
              ))}
              <Path d={geometry.headPath} />
            </ClipPath>
          </Defs>

          {/*
            The muscle body, drawn in full at every band.

            Fat is translucent in both references — the heavier figure is the
            same body seen through more, not a blank shell — so this is the
            bottom layer and the fat goes over it, rather than the other way
            around. Arms sit behind the torso so the shoulder line stays clean.
          */}
          {muscleBody.map((d, index) => (
            <Path
              key={`muscle-${index}`}
              d={d}
              fill="url(#hg-body)"
              stroke={accentBright}
              strokeWidth={1.1}
              strokeOpacity={0.62}
            />
          ))}

          {/* Muscle bellies: each group filled at its own development. */}
          {geometry.bellies.map((belly, index) => (
            <Path
              key={`belly-${index}`}
              d={belly.d}
              fill={accentBright}
              opacity={0.05 + belly.intensity * 0.22}
              stroke={accentBright}
              strokeWidth={0.6}
              strokeOpacity={0.2 + belly.intensity * 0.34}
            />
          ))}

          {/* Fibre, running the way each muscle pulls. */}
          {geometry.fibres.map((fibre, index) => (
            <Path
              key={`fibre-${index}`}
              d={fibre.d}
              stroke={accentBright}
              strokeWidth={0.55}
              fill="none"
              opacity={fibre.opacity}
              strokeLinecap="round"
            />
          ))}

          {/* The scanned surface: a point cloud clipped to the body. */}
          <G clipPath="url(#hg-skin)">
            <Path d={geometry.stipple.d} fill="#FFFFFF" opacity={geometry.stipple.opacity} />
          </G>

          {/* Contour rings wrapping the volume. */}
          {geometry.contours.map((contour, index) => (
            <Path
              key={`contour-${index}`}
              d={contour.d}
              stroke={accentBright}
              strokeWidth={0.8}
              fill="none"
              opacity={contour.opacity}
            />
          ))}

          {/* The head is the brightest thing in the frame, as in both renders. */}
          <Path
            d={geometry.headPath}
            fill="url(#hg-head)"
            stroke="#FFFFFF"
            strokeWidth={1.3}
            strokeOpacity={0.7}
          />
          {geometry.facePaths.map((d, index) => (
            <Path
              key={`face-${index}`}
              d={d}
              stroke={accentBright}
              strokeWidth={0.6}
              fill="none"
              opacity={0.5}
              strokeLinecap="round"
            />
          ))}

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
