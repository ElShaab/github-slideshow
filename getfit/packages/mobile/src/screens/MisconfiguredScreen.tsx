import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components';
import { useTheme } from '../theme';
import type { ReadinessProblem } from '../config/releaseReadiness';

/**
 * Shown instead of the app when a shipped build is missing configuration it
 * cannot work without.
 *
 * The alternative is worse in every way: the app launches, every request fails,
 * and whoever sees it — a tester, or App Review — reads it as a broken app
 * rather than an unset variable. This says exactly what is missing and where to
 * put it, and it is unreachable in a correctly configured build.
 */
export function MisconfiguredScreen({
  problems,
}: {
  problems: ReadinessProblem[];
}): React.ReactElement {
  const { colors, spacing } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: spacing.xxl, paddingTop: spacing.huge }}>
        <Text variant="micro" color="danger" uppercase>
          Build not configured
        </Text>
        <Text variant="title" style={{ marginTop: spacing.sm }} accessibilityRole="header">
          This build cannot run
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.md }}>
          {problems.length === 1 ? 'One setting is' : `${problems.length} settings are`} missing or
          wrong. Fix {problems.length === 1 ? 'it' : 'them'} and build again — this screen does not
          appear in a correctly configured build.
        </Text>

        <View style={{ marginTop: spacing.xxl, gap: spacing.lg }}>
          {problems.map((problem) => (
            <View
              key={problem.field}
              style={[styles.card, { borderColor: colors.danger, padding: spacing.lg }]}
            >
              <Text variant="subheading" style={{ color: colors.danger }}>
                {problem.field}
              </Text>
              <Text variant="caption" color="secondary" style={{ marginTop: spacing.sm }}>
                {problem.detail}
              </Text>
            </View>
          ))}
        </View>

        <Text variant="caption" color="muted" style={{ marginTop: spacing.xxl }}>
          See RELEASE.md, "Before you build".
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderWidth: 1, borderRadius: 14 },
});
