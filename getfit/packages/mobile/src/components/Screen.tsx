import React, { memo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { PrimaryButton } from './Buttons';
import { Text } from './Text';

export interface ScreenProps {
  children: React.ReactNode;
  /** Scrollable by default; set false for screens that manage their own layout. */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pinned footer that sits above the safe area. */
  footer?: React.ReactNode;
  padded?: boolean;
}

/**
 * The page shell: themed background, the ambient cyan wash behind everything,
 * safe-area handling and an optional pinned footer.
 */
export const Screen = memo(function Screen({
  children,
  scroll = true,
  contentStyle,
  onRefresh,
  refreshing = false,
  footer,
  padded = true,
}: ScreenProps): React.ReactElement {
  const { colors, spacing, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const padding = {
    paddingHorizontal: padded ? spacing.xl : 0,
    paddingTop: insets.top + spacing.md,
    paddingBottom: spacing.xxxl + (footer ? 0 : insets.bottom),
  };

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[padding, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padding, contentStyle]}>{children}</View>
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.statusBar} />

      {/* Ambient wash: a soft cyan bloom behind the whole page. */}
      <LinearGradient
        colors={
          isDark
            ? ['rgba(34,227,242,0.16)', 'rgba(10,147,172,0.05)', 'transparent']
            : ['rgba(10,147,172,0.14)', 'rgba(10,147,172,0.04)', 'transparent']
        }
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 0.6 }}
        style={styles.wash}
        pointerEvents="none"
      />

      {body}

      {footer ? (
        <View
          style={[
            styles.footer,
            {
              paddingHorizontal: spacing.xl,
              paddingTop: spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
              backgroundColor: colors.background,
              borderTopColor: colors.divider,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
});

/** Full-screen loading state. */
export const LoadingScreen = memo(function LoadingScreen({
  message = 'Loading…',
}: {
  message?: string;
}): React.ReactElement {
  const { colors, spacing } = useTheme();
  return (
    <Screen scroll={false} contentStyle={styles.centered}>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text variant="body" color="muted" style={{ marginTop: spacing.lg }}>
        {message}
      </Text>
    </Screen>
  );
});

/**
 * The single error surface used everywhere. Raw errors and stack traces are
 * never shown — only a plain message and a way to retry.
 */
export const ErrorState = memo(function ErrorState({
  message = 'Something went wrong.',
  onRetry,
  fullScreen = true,
}: {
  message?: string;
  onRetry?: () => void;
  fullScreen?: boolean;
}): React.ReactElement {
  const { spacing } = useTheme();

  const content = (
    <View style={styles.centered} accessibilityLiveRegion="polite">
      <Text variant="heading" align="center">
        {message}
      </Text>
      {onRetry ? (
        <PrimaryButton
          label="Try again"
          onPress={onRetry}
          fullWidth={false}
          style={{ marginTop: spacing.xl, minWidth: 200 }}
        />
      ) : null}
    </View>
  );

  if (!fullScreen) return content;
  return (
    <Screen scroll={false} contentStyle={styles.centered}>
      {content}
    </Screen>
  );
});

/** An inline empty state for lists with nothing in them yet. */
export const EmptyState = memo(function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}): React.ReactElement {
  const { spacing } = useTheme();
  return (
    <View style={{ paddingVertical: spacing.xxxl, alignItems: 'center' }}>
      <Text variant="subheading" align="center">
        {title}
      </Text>
      <Text variant="body" color="muted" align="center" style={{ marginTop: spacing.sm }}>
        {message}
      </Text>
    </View>
  );
});

/** Section heading used across Home, Progress and Settings. */
export const SectionHeader = memo(function SectionHeader({
  title,
  action,
  style,
}: {
  title: string;
  action?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { spacing } = useTheme();
  return (
    <View style={[styles.sectionHeader, { marginBottom: spacing.md }, style]}>
      <Text variant="micro" color="muted" uppercase accessibilityRole="header">
        {title}
      </Text>
      {action}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
