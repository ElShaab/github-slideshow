import React, { memo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Text } from '../components';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';

/**
 * The bottom navigation: Home, Workouts, Progress. There is deliberately no
 * Profile tab — settings live behind the icon on Home.
 */
export const BottomNavigation = memo(function BottomNavigation({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps): React.ReactElement {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, spacing.sm),
          borderTopColor: colors.glassBorder,
          backgroundColor: 'transparent',
        },
      ]}
      accessibilityRole="tablist"
    >
      <BlurView
        intensity={Platform.OS === 'android' ? 24 : 40}
        tint={colors.blurTint}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />

      <View style={styles.row}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label = (options.title ?? route.name) as string;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name as never);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              style={styles.tab}
            >
              <TabIcon name={route.name} color={focused ? colors.accent : colors.textMuted} />
              {/* Selection is shown by the icon fill and the label weight, not colour alone. */}
              <Text
                variant="micro"
                color={focused ? 'accent' : 'muted'}
                style={{ marginTop: 4 }}
                uppercase
              >
                {label}
              </Text>
              {focused ? (
                <View style={[styles.indicator, { backgroundColor: colors.accent }]} />
              ) : (
                <View style={styles.indicatorSpacer} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

function TabIcon({ name, color }: { name: string; color: string }): React.ReactElement {
  const size = 24;

  if (name === 'Workouts') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Rect x={2} y={9} width={3} height={6} rx={1} stroke={color} strokeWidth={1.8} fill="none" />
        <Rect x={19} y={9} width={3} height={6} rx={1} stroke={color} strokeWidth={1.8} fill="none" />
        <Rect x={6} y={7} width={3} height={10} rx={1} stroke={color} strokeWidth={1.8} fill="none" />
        <Rect x={15} y={7} width={3} height={10} rx={1} stroke={color} strokeWidth={1.8} fill="none" />
        <Path d="M9 12h6" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </Svg>
    );
  }

  if (name === 'Progress') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M3 17l5-6 4 4 5-8"
          stroke={color}
          strokeWidth={1.9}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={17} cy={7} r={2} stroke={color} strokeWidth={1.8} fill="none" />
        <Path d="M3 21h18" stroke={color} strokeWidth={1.6} strokeLinecap="round" opacity={0.5} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 11l9-7 9 7v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        stroke={color}
        strokeWidth={1.8}
        fill="none"
        strokeLinejoin="round"
      />
      <Path d="M9 21v-6h6v6" stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row' },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  indicator: { width: 18, height: 2, borderRadius: 1, marginTop: 5 },
  indicatorSpacer: { width: 18, height: 2, marginTop: 5 },
});
