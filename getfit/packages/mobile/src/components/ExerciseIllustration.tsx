import React, { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Path, Rect, G } from 'react-native-svg';
import { useTheme } from '../theme';

export interface ExerciseIllustrationProps {
  /** Illustration key from the exercise library. */
  illustration: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

/**
 * Vector exercise demonstrations.
 *
 * Illustrations are the default demo format: they are tiny, render instantly
 * offline, and follow the theme. Each library exercise carries an illustration
 * key, and movements that share a pattern share a drawing.
 */
export const ExerciseIllustration = memo(function ExerciseIllustration({
  illustration,
  size = 96,
  style,
  accessibilityLabel,
}: ExerciseIllustrationProps): React.ReactElement {
  const { colors } = useTheme();
  const stroke = colors.accent;
  const muted = colors.textMuted;
  const draw = FIGURES[illustration] ?? FIGURES.generic;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Exercise demonstration'}
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {draw(stroke, muted)}
      </Svg>
    </View>
  );
});

type Figure = (stroke: string, muted: string) => React.ReactElement;

/** Shared body parts so every figure stays visually consistent. */
const head = (cx: number, cy: number, stroke: string, r = 6) => (
  <Circle cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={2.4} fill="none" />
);

const limb = (points: string, stroke: string, width = 2.6) => (
  <Path d={points} stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
);

const bar = (x1: number, y1: number, x2: number, y2: number, muted: string) => (
  <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={muted} strokeWidth={3.4} strokeLinecap="round" />
);

const plate = (cx: number, cy: number, muted: string, r = 7) => (
  <Circle cx={cx} cy={cy} r={r} stroke={muted} strokeWidth={2.6} fill="none" />
);

const ground = (muted: string) => (
  <Line x1={10} y1={92} x2={90} y2={92} stroke={muted} strokeWidth={1.6} strokeDasharray="4 4" />
);

const FIGURES: Record<string, Figure> = {
  generic: (s, m) => (
    <G>
      {head(50, 22, s)}
      {limb('M50 28 L50 58', s)}
      {limb('M50 36 L34 48 M50 36 L66 48', s)}
      {limb('M50 58 L38 84 M50 58 L62 84', s)}
      {ground(m)}
    </G>
  ),
  barbell_press: (s, m) => (
    <G>
      {limb('M22 72 L78 72', m, 3)}
      {head(36, 60, s, 5)}
      {limb('M42 62 L68 62', s)}
      {limb('M48 62 L48 44 M60 62 L60 44', s)}
      {bar(36, 42, 78, 42, m)}
      {plate(40, 42, m)}
      {plate(74, 42, m)}
      {ground(m)}
    </G>
  ),
  incline_press: (s, m) => (
    <G>
      {limb('M20 80 L66 52', m, 3)}
      {head(32, 56, s, 5)}
      {limb('M38 60 L58 50', s)}
      {limb('M44 58 L46 38 M54 53 L56 38', s)}
      {bar(34, 36, 72, 36, m)}
      {plate(38, 36, m)}
      {plate(68, 36, m)}
      {ground(m)}
    </G>
  ),
  dumbbell_press: (s, m) => (
    <G>
      {limb('M22 72 L78 72', m, 3)}
      {head(36, 60, s, 5)}
      {limb('M42 62 L66 62', s)}
      {limb('M48 62 L46 46 M60 62 L62 46', s)}
      {bar(38, 44, 54, 44, m)}
      {bar(56, 44, 72, 44, m)}
      {ground(m)}
    </G>
  ),
  pushup: (s, m) => (
    <G>
      {head(26, 56, s, 5)}
      {limb('M32 58 L74 46', s)}
      {limb('M36 58 L36 78 M70 48 L70 78', s)}
      {limb('M74 46 L86 76', s)}
      {ground(m)}
    </G>
  ),
  fly: (s, m) => (
    <G>
      {limb('M22 74 L78 74', m, 3)}
      {head(34, 62, s, 5)}
      {limb('M40 64 L64 64', s)}
      {limb('M46 64 L28 48 M58 64 L76 48', s)}
      {bar(20, 44, 34, 44, m)}
      {bar(70, 44, 84, 44, m)}
      {ground(m)}
    </G>
  ),
  dip: (s, m) => (
    <G>
      {limb('M26 26 L26 78 M74 26 L74 78', m, 3)}
      {head(50, 32, s, 5)}
      {limb('M50 38 L50 62', s)}
      {limb('M50 42 L32 40 M50 42 L68 40', s)}
      {limb('M50 62 L42 80 M50 62 L58 78', s)}
    </G>
  ),
  pullup: (s, m) => (
    <G>
      {bar(18, 20, 82, 20, m)}
      {head(50, 36, s, 5)}
      {limb('M50 42 L50 68', s)}
      {limb('M50 44 L36 22 M50 44 L64 22', s)}
      {limb('M50 68 L42 86 M50 68 L58 86', s)}
    </G>
  ),
  pulldown: (s, m) => (
    <G>
      {bar(24, 22, 76, 22, m)}
      {limb('M50 22 L50 34', m, 2)}
      {head(50, 46, s, 5)}
      {limb('M50 52 L50 72', s)}
      {limb('M50 54 L34 34 M50 54 L66 34', s)}
      {limb('M50 72 L38 84 M50 72 L62 84', s)}
    </G>
  ),
  row_barbell: (s, m) => (
    <G>
      {head(30, 34, s, 5)}
      {limb('M36 38 L66 52', s)}
      {limb('M66 52 L68 82', s)}
      {limb('M44 42 L44 62', s)}
      {bar(30, 62, 60, 62, m)}
      {plate(33, 62, m, 6)}
      {plate(57, 62, m, 6)}
      {ground(m)}
    </G>
  ),
  row_dumbbell: (s, m) => (
    <G>
      {limb('M18 72 L62 72', m, 3)}
      {head(28, 44, s, 5)}
      {limb('M34 48 L64 48', s)}
      {limb('M44 50 L44 66', s)}
      {bar(36, 66, 52, 66, m)}
      {limb('M64 48 L74 72', s)}
      {ground(m)}
    </G>
  ),
  row_cable: (s, m) => (
    <G>
      {limb('M16 78 L60 78', m, 3)}
      {head(40, 40, s, 5)}
      {limb('M40 46 L40 70', s)}
      {limb('M40 50 L70 54', s)}
      {bar(68, 48, 74, 60, m)}
      {limb('M40 70 L66 74', s)}
      {ground(m)}
    </G>
  ),
  deadlift: (s, m) => (
    <G>
      {head(38, 30, s, 5)}
      {limb('M42 34 L54 54', s)}
      {limb('M48 40 L48 70', s)}
      {limb('M54 54 L52 78', s)}
      {bar(26, 70, 70, 70, m)}
      {plate(31, 70, m, 9)}
      {plate(65, 70, m, 9)}
      {ground(m)}
    </G>
  ),
  shrug: (s, m) => (
    <G>
      {head(50, 26, s, 5)}
      {limb('M50 32 L50 60', s)}
      {limb('M36 38 L64 38', s)}
      {limb('M38 38 L38 58 M62 38 L62 58', s)}
      {bar(30, 60, 70, 60, m)}
      {plate(34, 60, m, 6)}
      {plate(66, 60, m, 6)}
      {limb('M50 60 L42 86 M50 60 L58 86', s)}
    </G>
  ),
  overhead_press: (s, m) => (
    <G>
      {head(50, 44, s, 5)}
      {limb('M50 50 L50 72', s)}
      {limb('M50 52 L36 34 M50 52 L64 34', s)}
      {bar(28, 30, 72, 30, m)}
      {plate(32, 30, m, 6)}
      {plate(68, 30, m, 6)}
      {limb('M50 72 L42 88 M50 72 L58 88', s)}
      {ground(m)}
    </G>
  ),
  lateral_raise: (s, m) => (
    <G>
      {head(50, 26, s, 5)}
      {limb('M50 32 L50 62', s)}
      {limb('M50 38 L26 40 M50 38 L74 40', s)}
      {bar(18, 40, 30, 40, m)}
      {bar(70, 40, 82, 40, m)}
      {limb('M50 62 L42 88 M50 62 L58 88', s)}
      {ground(m)}
    </G>
  ),
  front_raise: (s, m) => (
    <G>
      {head(38, 26, s, 5)}
      {limb('M38 32 L38 62', s)}
      {limb('M38 38 L70 36', s)}
      {bar(64, 32, 78, 40, m)}
      {limb('M38 62 L30 88 M38 62 L46 88', s)}
      {ground(m)}
    </G>
  ),
  rear_delt: (s, m) => (
    <G>
      {head(32, 38, s, 5)}
      {limb('M38 42 L64 50', s)}
      {limb('M46 46 L26 34 M52 48 L70 30', s)}
      {bar(18, 32, 30, 36, m)}
      {bar(66, 26, 78, 32, m)}
      {limb('M64 50 L70 82', s)}
      {ground(m)}
    </G>
  ),
  face_pull: (s, m) => (
    <G>
      {bar(80, 24, 88, 40, m)}
      {limb('M50 34 L80 32', m, 2)}
      {head(42, 40, s, 5)}
      {limb('M42 46 L42 70', s)}
      {limb('M42 48 L58 34 M42 48 L58 44', s)}
      {limb('M42 70 L34 88 M42 70 L50 88', s)}
      {ground(m)}
    </G>
  ),
  curl: (s, m) => (
    <G>
      {head(50, 24, s, 5)}
      {limb('M50 30 L50 62', s)}
      {limb('M50 38 L38 52 L48 42 M50 38 L62 52 L52 42', s)}
      {bar(38, 40, 62, 40, m)}
      {plate(41, 40, m, 5)}
      {plate(59, 40, m, 5)}
      {limb('M50 62 L42 88 M50 62 L58 88', s)}
      {ground(m)}
    </G>
  ),
  hammer_curl: (s, m) => (
    <G>
      {head(50, 24, s, 5)}
      {limb('M50 30 L50 62', s)}
      {limb('M50 38 L36 50 L40 40 M50 38 L64 50 L60 40', s)}
      {bar(36, 36, 44, 44, m)}
      {bar(56, 36, 64, 44, m)}
      {limb('M50 62 L42 88 M50 62 L58 88', s)}
      {ground(m)}
    </G>
  ),
  pushdown: (s, m) => (
    <G>
      {bar(24, 18, 76, 18, m)}
      {limb('M50 18 L50 34', m, 2)}
      {head(50, 34, s, 5)}
      {limb('M50 40 L50 66', s)}
      {limb('M50 44 L40 56 M50 44 L60 56', s)}
      {bar(38, 58, 62, 58, m)}
      {limb('M50 66 L42 88 M50 66 L58 88', s)}
    </G>
  ),
  overhead_extension: (s, m) => (
    <G>
      {head(50, 40, s, 5)}
      {limb('M50 46 L50 70', s)}
      {limb('M50 48 L42 30 L56 22 M50 48 L58 30 L56 22', s)}
      {bar(46, 18, 64, 22, m)}
      {limb('M50 70 L42 88 M50 70 L58 88', s)}
      {ground(m)}
    </G>
  ),
  skullcrusher: (s, m) => (
    <G>
      {limb('M20 70 L80 70', m, 3)}
      {head(32, 58, s, 5)}
      {limb('M38 60 L64 60', s)}
      {limb('M46 60 L40 44 M58 60 L52 44', s)}
      {bar(34, 42, 58, 42, m)}
      {ground(m)}
    </G>
  ),
  wrist_curl: (s, m) => (
    <G>
      {limb('M18 62 L62 62', m, 3)}
      {limb('M30 56 L58 56 L68 50', s)}
      {bar(62, 46, 76, 54, m)}
      {ground(m)}
    </G>
  ),
  carry: (s, m) => (
    <G>
      {head(50, 22, s, 5)}
      {limb('M50 28 L50 62', s)}
      {limb('M50 34 L34 34 M50 34 L66 34', s)}
      {limb('M34 34 L34 56 M66 34 L66 56', s)}
      {bar(26, 58, 42, 58, m)}
      {bar(58, 58, 74, 58, m)}
      {limb('M50 62 L42 88 M50 62 L58 88', s)}
      {ground(m)}
    </G>
  ),
  squat: (s, m) => (
    <G>
      {head(50, 28, s, 5)}
      {limb('M50 34 L50 54', s)}
      {bar(28, 38, 72, 38, m)}
      {plate(32, 38, m, 7)}
      {plate(68, 38, m, 7)}
      {limb('M50 54 L36 66 L38 86 M50 54 L64 66 L62 86', s)}
      {ground(m)}
    </G>
  ),
  front_squat: (s, m) => (
    <G>
      {head(50, 28, s, 5)}
      {limb('M50 34 L50 54', s)}
      {bar(30, 42, 70, 42, m)}
      {limb('M50 40 L38 42 M50 40 L62 42', s)}
      {limb('M50 54 L36 66 L38 86 M50 54 L64 66 L62 86', s)}
      {ground(m)}
    </G>
  ),
  leg_press: (s, m) => (
    <G>
      {limb('M14 76 L54 76', m, 3)}
      {head(24, 64, s, 5)}
      {limb('M30 66 L52 62', s)}
      {limb('M52 62 L70 44', s)}
      {bar(64, 32, 84, 52, m)}
      {ground(m)}
    </G>
  ),
  lunge: (s, m) => (
    <G>
      {head(46, 24, s, 5)}
      {limb('M46 30 L46 54', s)}
      {limb('M46 54 L70 66 L70 86', s)}
      {limb('M46 54 L28 74 L34 86', s)}
      {bar(34, 38, 44, 38, m)}
      {bar(48, 38, 58, 38, m)}
      {ground(m)}
    </G>
  ),
  split_squat: (s, m) => (
    <G>
      {limb('M66 66 L88 66', m, 3)}
      {head(40, 24, s, 5)}
      {limb('M40 30 L40 54', s)}
      {limb('M40 54 L40 74 L40 86', s)}
      {limb('M40 54 L66 62', s)}
      {bar(28, 38, 38, 38, m)}
      {ground(m)}
    </G>
  ),
  step_up: (s, m) => (
    <G>
      {limb('M58 66 L86 66 L86 90 L58 90 Z', m, 2)}
      {head(38, 22, s, 5)}
      {limb('M38 28 L38 52', s)}
      {limb('M38 52 L58 62', s)}
      {limb('M38 52 L34 86', s)}
      {ground(m)}
    </G>
  ),
  leg_extension: (s, m) => (
    <G>
      {limb('M20 50 L20 78 L52 78', m, 3)}
      {head(24, 40, s, 5)}
      {limb('M24 46 L24 62', s)}
      {limb('M24 62 L48 62 L72 50', s)}
      {bar(68, 44, 80, 56, m)}
      {ground(m)}
    </G>
  ),
  leg_curl: (s, m) => (
    <G>
      {limb('M16 68 L64 68', m, 3)}
      {head(24, 62, s, 5)}
      {limb('M30 64 L58 64', s)}
      {limb('M58 64 L76 50', s)}
      {bar(70, 44, 82, 54, m)}
      {ground(m)}
    </G>
  ),
  rdl: (s, m) => (
    <G>
      {head(34, 30, s, 5)}
      {limb('M38 34 L58 50', s)}
      {limb('M58 50 L58 82', s)}
      {limb('M46 40 L46 62', s)}
      {bar(30, 62, 62, 62, m)}
      {plate(34, 62, m, 6)}
      {plate(58, 62, m, 6)}
      {ground(m)}
    </G>
  ),
  good_morning: (s, m) => (
    <G>
      {head(30, 36, s, 5)}
      {limb('M34 40 L58 52', s)}
      {limb('M58 52 L58 84', s)}
      {bar(30, 30, 54, 42, m)}
      {ground(m)}
    </G>
  ),
  hip_thrust: (s, m) => (
    <G>
      {limb('M12 44 L40 44', m, 3)}
      {head(20, 38, s, 5)}
      {limb('M26 42 L54 52', s)}
      {limb('M54 52 L70 70 L70 88', s)}
      {bar(44, 46, 66, 46, m)}
      {plate(48, 46, m, 6)}
      {ground(m)}
    </G>
  ),
  glute_bridge: (s, m) => (
    <G>
      {head(20, 70, s, 5)}
      {limb('M26 72 L52 58', s)}
      {limb('M52 58 L70 76 L70 88', s)}
      {ground(m)}
    </G>
  ),
  kickback: (s, m) => (
    <G>
      {limb('M16 48 L44 48', m, 3)}
      {head(22, 42, s, 5)}
      {limb('M28 46 L56 52', s)}
      {limb('M56 52 L54 74', s)}
      {limb('M56 52 L80 40', s)}
      {ground(m)}
    </G>
  ),
  abduction: (s, m) => (
    <G>
      {head(50, 30, s, 5)}
      {limb('M50 36 L50 58', s)}
      {limb('M50 58 L28 78 M50 58 L72 78', s)}
      {bar(22, 78, 34, 78, m)}
      {bar(66, 78, 78, 78, m)}
      {ground(m)}
    </G>
  ),
  calf_raise: (s, m) => (
    <G>
      {head(50, 24, s, 5)}
      {limb('M50 30 L50 60', s)}
      {limb('M50 60 L44 80 M50 60 L56 80', s)}
      {limb('M38 82 L62 82', m, 3)}
      {limb('M44 80 L44 74 M56 80 L56 74', s, 2)}
      {ground(m)}
    </G>
  ),
  crunch: (s, m) => (
    <G>
      {head(30, 56, s, 5)}
      {limb('M34 60 L52 66', s)}
      {limb('M52 66 L66 52 L78 66', s)}
      {ground(m)}
    </G>
  ),
  leg_raise: (s, m) => (
    <G>
      {head(22, 68, s, 5)}
      {limb('M28 70 L52 70', s)}
      {limb('M52 70 L66 46 L78 40', s)}
      {ground(m)}
    </G>
  ),
  plank: (s, m) => (
    <G>
      {head(24, 54, s, 5)}
      {limb('M30 56 L76 66', s)}
      {limb('M30 56 L28 72 L38 72', s)}
      {limb('M76 66 L82 84', s)}
      {ground(m)}
    </G>
  ),
  ab_wheel: (s, m) => (
    <G>
      {head(28, 48, s, 5)}
      {limb('M34 52 L64 66', s)}
      {limb('M34 52 L58 40', s)}
      {plate(64, 40, m, 9)}
      {limb('M64 66 L72 84', s)}
      {ground(m)}
    </G>
  ),
  twist: (s, m) => (
    <G>
      {head(36, 40, s, 5)}
      {limb('M36 46 L44 66', s)}
      {limb('M40 52 L64 46', s)}
      {plate(70, 44, m, 6)}
      {limb('M44 66 L68 72 M44 66 L38 84', s)}
      {ground(m)}
    </G>
  ),
  swing: (s, m) => (
    <G>
      {head(50, 24, s, 5)}
      {limb('M50 30 L50 56', s)}
      {limb('M50 36 L60 48', s)}
      {plate(64, 54, m, 8)}
      {limb('M50 56 L40 80 M50 56 L60 80', s)}
      {ground(m)}
    </G>
  ),
  cardio_walk: (s, m) => (
    <G>
      {head(46, 22, s, 5)}
      {limb('M46 28 L46 54', s)}
      {limb('M46 34 L34 46 M46 34 L60 44', s)}
      {limb('M46 54 L34 80 M46 54 L62 78', s)}
      <Path d="M12 90 L88 74" stroke={m} strokeWidth={2} strokeDasharray="5 4" />
    </G>
  ),
  cardio_bike: (s, m) => (
    <G>
      {plate(28, 74, m, 12)}
      {plate(72, 74, m, 12)}
      {limb('M28 74 L50 54 L72 74 M50 54 L50 66', m, 2)}
      {head(52, 34, s, 5)}
      {limb('M52 40 L50 54 M52 44 L66 50', s)}
    </G>
  ),
  cardio_row: (s, m) => (
    <G>
      {limb('M14 78 L86 78', m, 3)}
      {head(34, 44, s, 5)}
      {limb('M36 50 L46 66', s)}
      {limb('M38 52 L64 54', s)}
      {limb('M46 66 L70 70', s)}
      {bar(62, 48, 68, 60, m)}
    </G>
  ),
  cardio_jump: (s, m) => (
    <G>
      {head(50, 26, s, 5)}
      {limb('M50 32 L50 58', s)}
      {limb('M50 38 L34 46 M50 38 L66 46', s)}
      {limb('M50 58 L42 78 M50 58 L58 78', s)}
      <Path d="M34 46 C10 60 10 90 50 88 C90 90 90 60 66 46" stroke={m} strokeWidth={1.8} fill="none" />
    </G>
  ),
  cardio_elliptical: (s, m) => (
    <G>
      {head(50, 26, s, 5)}
      {limb('M50 32 L50 58', s)}
      {limb('M50 36 L32 40 M50 36 L68 40', s)}
      {limb('M50 58 L36 74 M50 58 L64 74', s)}
      <Rect x={28} y={74} width={44} height={10} rx={5} stroke={m} strokeWidth={2} fill="none" />
    </G>
  ),
};

export const ILLUSTRATION_KEYS = Object.keys(FIGURES);
