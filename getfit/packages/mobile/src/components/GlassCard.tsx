import React, { memo } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme';

export interface GlassCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** `strong` reads as a raised surface; `soft` sits quietly in a list. */
  emphasis?: 'soft' | 'default' | 'strong';
  /** Adds a cyan edge and glow — reserve it for the focus of a screen. */
  accented?: boolean;
  padded?: boolean;
  intensity?: number;
}

/**
 * The glass surface every card in the app is built from: a blurred backdrop, a
 * translucent fill, a hairline border and a soft highlight along the top edge.
 */
export const GlassCard = memo(function GlassCard({
  children,
  style,
  contentStyle,
  emphasis = 'default',
  accented = false,
  padded = true,
  intensity,
}: GlassCardProps): React.ReactElement {
  const { colors, radius, spacing, isDark } = useTheme();

  const fill =
    emphasis === 'strong' ? colors.glassStrong : emphasis === 'soft' ? colors.glass : colors.glass;

  return (
    <View
      style={[
        styles.container,
        {
          borderRadius: radius.lg,
          borderColor: accented ? colors.accentGlow : colors.glassBorder,
          shadowColor: accented ? colors.accent : '#000',
          shadowOpacity: accented ? (isDark ? 0.45 : 0.22) : isDark ? 0.35 : 0.08,
          shadowRadius: accented ? 22 : 16,
          elevation: accented ? 8 : 3,
        },
        style,
      ]}
    >
      <BlurView
        intensity={intensity ?? (Platform.OS === 'android' ? 24 : emphasis === 'strong' ? 44 : 30)}
        tint={colors.blurTint}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
      <LinearGradient
        colors={[colors.glassHighlight, 'transparent']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.7 }}
        style={[StyleSheet.absoluteFill, { opacity: isDark ? 0.5 : 0.8 }]}
        pointerEvents="none"
      />
      <View style={[padded && { padding: spacing.xl }, contentStyle]}>{children}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 },
  },
});
