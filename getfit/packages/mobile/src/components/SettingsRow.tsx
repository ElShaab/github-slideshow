import React, { memo } from 'react';
import { Pressable, StyleSheet, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { MIN_TOUCH_TARGET } from '../theme/tokens';
import { Text } from './Text';

export interface SettingsRowProps {
  label: string;
  value?: string;
  description?: string;
  onPress?: () => void;
  /** Renders a switch instead of a value and chevron. */
  toggle?: { value: boolean; onChange: (value: boolean) => void };
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  last?: boolean;
}

/** A single row inside a settings group. */
export const SettingsRow = memo(function SettingsRow({
  label,
  value,
  description,
  onPress,
  toggle,
  destructive = false,
  style,
  last = false,
}: SettingsRowProps): React.ReactElement {
  const { colors, spacing } = useTheme();

  const content = (
    <View
      style={[
        styles.row,
        {
          paddingVertical: spacing.lg,
          paddingHorizontal: spacing.xl,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: colors.divider,
        },
        style,
      ]}
    >
      <View style={styles.labelBlock}>
        <Text variant="body" color={destructive ? 'danger' : 'primary'}>
          {label}
        </Text>
        {description ? (
          <Text variant="caption" color="muted" style={{ marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>

      {toggle ? (
        <Switch
          value={toggle.value}
          onValueChange={toggle.onChange}
          accessibilityLabel={label}
          trackColor={{ false: colors.glassBorder, true: colors.accent }}
          thumbColor={colors.text}
        />
      ) : (
        <View style={styles.valueBlock}>
          {value ? (
            <Text variant="body" color="muted" numberOfLines={1}>
              {value}
            </Text>
          ) : null}
          {onPress ? (
            <Text variant="body" color="muted" style={{ marginLeft: spacing.sm }}>
              ›
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, currently ${value}` : label}
      style={({ pressed }) => [{ minHeight: MIN_TOUCH_TARGET, opacity: pressed ? 0.6 : 1 }]}
    >
      {content}
    </Pressable>
  );
});

/** Grouped container for settings rows. */
export const SettingsGroup = memo(function SettingsGroup({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { colors, spacing, radius } = useTheme();
  return (
    <View style={[{ marginTop: spacing.xxl }, style]}>
      <Text variant="micro" color="muted" uppercase style={{ marginBottom: spacing.sm }}>
        {title}
      </Text>
      <View
        style={{
          borderRadius: radius.lg,
          backgroundColor: colors.glass,
          borderWidth: StyleSheet.hairlineWidth * 2,
          borderColor: colors.glassBorder,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  labelBlock: { flex: 1, paddingRight: 12 },
  valueBlock: { flexDirection: 'row', alignItems: 'center', maxWidth: '52%' },
});
