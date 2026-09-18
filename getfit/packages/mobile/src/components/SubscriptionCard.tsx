import React, { memo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { GlassCard } from './GlassCard';
import { Text } from './Text';

/**
 * What the membership includes, shown on the paywall and the renewal screen.
 *
 * The price is optional: when plans are listed separately the card carries only
 * the feature list, so a headline price cannot contradict the plan the user
 * actually has selected.
 */
export const SubscriptionCard = memo(function SubscriptionCard({
  features,
  priceUsd,
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

      {priceUsd !== undefined ? (
        <View style={[styles.priceRow, { marginTop: spacing.md }]}>
          <Text variant="display" tabular>
            ${priceUsd}
          </Text>
          <Text
            variant="subheading"
            color="muted"
            style={{ marginLeft: spacing.sm, marginBottom: 7 }}
          >
            / month
          </Text>
        </View>
      ) : null}

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
