import React, { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SUBSCRIPTION_PRICE_USD } from '@getfit/shared';
import { useTheme } from '../theme';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

/** The membership offer shown on the paywall and the renewal screen. */
export const SubscriptionCard = memo(function SubscriptionCard({
  features,
  priceUsd = SUBSCRIPTION_PRICE_USD,
  style,
}: {
  features: string[];
  priceUsd?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { colors, spacing } = useTheme();

  return (
    <GlassCard accented emphasis="strong" style={style}>
      <Text variant="micro" color="accent" uppercase>
        GetFit Membership
      </Text>

      <View style={[styles.priceRow, { marginTop: spacing.md }]}>
        <Text variant="display" tabular>
          ${priceUsd}
        </Text>
        <Text variant="subheading" color="muted" style={{ marginLeft: spacing.sm, marginBottom: 7 }}>
          / month
        </Text>
      </View>

      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        {features.map((feature) => (
          <View key={feature} style={styles.featureRow}>
            <View style={[styles.bullet, { backgroundColor: colors.accentSoft, borderColor: colors.accent }]}>
              <Text variant="caption" color="accent">
                ✓
              </Text>
            </View>
            <Text variant="body" style={{ flex: 1, marginLeft: spacing.md }}>
              {feature}
            </Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
});

const styles = StyleSheet.create({
  priceRow: { flexDirection: 'row', alignItems: 'flex-end' },
  featureRow: { flexDirection: 'row', alignItems: 'center' },
  bullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
