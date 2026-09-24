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
 * The glass surface every card in the app is built from.
 *
 * Five layers, bottom to top: a blurred backdrop, a translucent fill, a
 * diagonal sheen, a bright line along the top edge, and the border. The lit
 * top edge is what makes a card read as a physical pane catching the light
 * rather than a rectangle with a lower opacity — it is the whole effect.
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
  const { colors, radius, spacing } = useTheme();

  const fill = emphasis === 'strong' ? colors.glassStrong : colors.glass;

  return (
    <View
      style={[
        styles.container,
        {
          borderRadius: radius.xl,
          borderColor: accented ? colors.glassEdge : colors.glassBorder,
          shadowColor: accented ? colors.accent : '#01122B',
          shadowOpacity: accented ? 0.55 : 0.4,
          shadowRadius: accented ? 26 : 18,
          elevation: accented ? 10 : 4,
        },
        style,
      ]}
    >
      <BlurView
        intensity={intensity ?? (Platform.OS === 'android' ? 24 : emphasis === 'strong' ? 48 : 34)}
        tint={colors.blurTint}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />

      {/* The sheen: light falling across the pane from the top left. */}
      <LinearGradient
        colors={[colors.glassHighlight, 'transparent']}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.85, y: 0.75 }}
        style={[StyleSheet.absoluteFill, { opacity: emphasis === 'soft' ? 0.5 : 0.85 }]}
        pointerEvents="none"
      />

      {/* The lit top edge, brighter in the middle where the light lands. */}
      <LinearGradient
        colors={['transparent', accented ? colors.glassEdge : colors.glassHighlight, 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.topEdge}
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
    shadowOffset: { width: 0, height: 10 },
  },
  topEdge: { position: 'absolute', top: 0, left: 0, right: 0, height: 1 },
});
