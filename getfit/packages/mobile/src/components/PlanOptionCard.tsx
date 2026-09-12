import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

export interface PlanOptionCardProps {
  label: string;
  priceUsd: number;
  /** Shown struck through beside the price. Null when there is no offer. */
  listPriceUsd: number | null;
  /** Per-period suffix, e.g. "/ year". */
  periodLabel: string;
  /** Small caption under the price, e.g. "$1.67 / month". */
  detail?: string;
  badge?: string | null;
  limitedTime?: boolean;
  selected: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * One selectable membership on the paywall.
 *
 * Selection is conveyed by border, background and an explicit check rather than
 * colour alone, and the control reports itself as a radio so assistive tech
 * announces which plan is chosen.
 */
export const PlanOptionCard = memo(function PlanOptionCard({
  label,
  priceUsd,
  listPriceUsd,
  periodLabel,
  detail,
  badge,
  limitedTime = false,
  selected,
  onPress,
  style,
}: PlanOptionCardProps): React.ReactElement {
  const { colors, spacing, radius } = useTheme();

  const savedLabel =
    listPriceUsd && listPriceUsd > priceUsd
      ? `, normally $${listPriceUsd}, save ${Math.round(((listPriceUsd - priceUsd) / listPriceUsd) * 100)} percent`
      : '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, $${priceUsd} ${periodLabel}${savedLabel}`}
      style={({ pressed }) => [
        styles.card,
        {
          borderRadius: radius.lg,
          padding: spacing.lg,
          borderColor: selected ? colors.accent : colors.glassBorder,
          backgroundColor: selected ? colors.accentSoft : colors.glass,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={styles.header}>
        <Text variant="micro" color={selected ? 'accent' : 'muted'} uppercase>
          {label}
        </Text>

        {badge ? (
          <View
            style={[
              styles.badge,
              {
                borderRadius: radius.sm,
                paddingHorizontal: spacing.sm,
                backgroundColor: colors.accent,
              },
            ]}
          >
            <Text variant="micro" uppercase style={{ color: colors.onAccent }}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.priceRow, { marginTop: spacing.sm }]}>
        {listPriceUsd !== null ? (
          <Text
            variant="subheading"
            color="muted"
            style={[styles.struck, { marginRight: spacing.sm }]}
          >
            ${listPriceUsd}
          </Text>
        ) : null}

        <Text variant="heading" tabular>
          ${priceUsd}
        </Text>
        <Text variant="body" color="muted" style={{ marginLeft: 4 }}>
          {periodLabel}
        </Text>
      </View>

      {detail ? (
        <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
          {detail}
        </Text>
      ) : null}

      {limitedTime ? (
        <Text variant="caption" color="accent" style={{ marginTop: spacing.xs }}>
          Limited time offer
        </Text>
      ) : null}

      <View
        style={[
          styles.check,
          {
            borderRadius: 12,
            borderColor: selected ? colors.accent : colors.glassBorder,
            backgroundColor: selected ? colors.accent : 'transparent',
          },
        ]}
      >
        {selected ? (
          <Text variant="caption" style={{ color: colors.onAccent }}>
            ✓
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth * 3, position: 'relative' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 },
  badge: { paddingVertical: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline' },
  struck: { textDecorationLine: 'line-through' },
  check: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 24,
    height: 24,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
