import React, { memo } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
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
 * The page shell: the blue field, the cyan blooms that light it, safe-area
 * handling and an optional pinned footer.
 *
 * The field is painted here and nowhere else, which is why every screen shares
 * one continuous gradient instead of each one owning a background colour.
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
  const { colors, spacing } = useTheme();
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

      {/* The field: azure, brightest at the top, deepening down the page. */}
      <LinearGradient
        colors={colors.backgroundGradient}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Two cyan blooms light the field from the top and the bottom corner.
          Nothing is read against them, which is why they can be this bright. */}
      <LinearGradient
        colors={colors.bloomTop}
        start={{ x: 0.05, y: 0 }}
        end={{ x: 0.95, y: 1 }}
        style={styles.bloomTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={colors.bloomBottom}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.bloomBottom}
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
              borderTopColor: colors.glassBorder,
            },
          ]}
        >
          {/* The footer floats on the field rather than covering it: blurred
              glass over the gradient, so the page reads as one pane. */}
          <BlurView
            intensity={Platform.OS === 'android' ? 24 : 40}
            tint={colors.blurTint}
            style={StyleSheet.absoluteFill}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
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
  detail,
  onRetry,
  fullScreen = true,
}: {
  message?: string;
  /**
   * What actually failed, for someone reporting it.
   *
   * Shown small and quietly beneath the message. It is not an explanation and
   * is not meant to be one — it is the difference between a report that says
   * "it broke" and one that can be acted on.
   */
  detail?: string | null;
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
      {detail ? (
        <Text
          variant="caption"
          color="muted"
          align="center"
          selectable
          style={{ marginTop: spacing.xl }}
        >
          {detail}
        </Text>
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
  bloomTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 460 },
  bloomBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 360 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
