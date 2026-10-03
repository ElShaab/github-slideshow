import React from 'react';
import { View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { GlassCard, LegalLinks, Screen, SecondaryButton, Text } from '../../components';
import { useTheme } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';

/**
 * The health disclaimer.
 *
 * GetFit puts body-fat percentages and training loads in front of people, and
 * both read as authoritative. Saying plainly what these numbers are — and are
 * not — is the honest thing to do, and App Review expects a health and fitness
 * app to say it somewhere reachable rather than only in a policy document.
 */
export function DisclaimerScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'SettingsDisclaimer'>): React.ReactElement {
  const { spacing } = useTheme();

  return (
    <Screen footer={<SecondaryButton label="Back" onPress={navigation.goBack} />}>
      <Text variant="title" accessibilityRole="header">
        Health disclaimer
      </Text>

      <GlassCard accented style={{ marginTop: spacing.xl }}>
        <Text variant="subheading">GetFit is not a medical device</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          GetFit is a fitness app. It does not diagnose, treat, cure or prevent any
          condition, and nothing it shows you is medical advice. Talk to a doctor
          before starting a new training programme, especially if you are pregnant,
          have an injury, or have a heart, joint or metabolic condition.
        </Text>
      </GlassCard>

      <GlassCard style={{ marginTop: spacing.lg }}>
        <Text variant="subheading">Your body figures are estimates</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          Body fat is calculated from your tape measurements using the US Navy
          circumference formula, which typically lands within 3–4 percentage points
          of a DEXA scan. Without those measurements GetFit falls back to a
          height-and-weight estimate, which is less accurate still and is labelled
          “Estimated” wherever it appears.
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          Muscle mass is derived from your body-fat figure rather than measured
          directly. Treat all of it as a way to track change over time, not as a
          clinical measurement.
        </Text>
      </GlassCard>

      <GlassCard style={{ marginTop: spacing.lg }}>
        <Text variant="subheading">Train within your limits</Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.sm }}>
          Prescribed weights are a starting point calculated from what you have
          logged, not an instruction. Reduce the load or stop if something hurts.
          Stop exercising and seek medical help if you feel chest pain,
          light-headedness or shortness of breath.
        </Text>
      </GlassCard>

      <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
        <LegalLinks includeSupport align="center" />
      </View>
    </Screen>
  );
}
