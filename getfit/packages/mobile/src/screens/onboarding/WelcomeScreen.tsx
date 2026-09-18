import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PrimaryButton, Screen, SecondaryButton, Text } from '../../components';
import { useSession } from '../../state/SessionProvider';
import { useTheme } from '../../theme';
import type { OnboardingStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<OnboardingStackParamList, 'Welcome'>;

/**
 * The entry point. No account is required to get this far, or to reach the
 * body analysis — a guest session is created silently when the user begins.
 */
export function WelcomeScreen({ navigation }: Props): React.ReactElement {
  const { spacing } = useTheme();
  const { startGuestSession, userId } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!userId) await startGuestSession();
      navigation.navigate('Basics');
    } catch {
      setError('Something went wrong.');
    } finally {
      setBusy(false);
    }
  }, [navigation, startGuestSession, userId]);

  return (
    <Screen scroll={false} contentStyle={styles.container}>
      <View style={styles.hero}>
        <Text variant="micro" color="accent" uppercase>
          AI Personal Trainer
        </Text>
        <Text variant="display" style={{ marginTop: spacing.md }} accessibilityRole="header">
          GetFit
        </Text>
        <Text variant="body" color="secondary" style={{ marginTop: spacing.lg, maxWidth: 340 }}>
          A body analysis, a program built for you, and training that adapts every
          single week. No guesswork.
        </Text>
      </View>

      <View style={{ gap: spacing.md }}>
        {error ? (
          <Text variant="caption" color="danger" align="center" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <PrimaryButton
          label="Get started"
          onPress={() => void begin()}
          loading={busy}
          accessibilityHint="Begins your setup. No account is needed yet."
        />
        <SecondaryButton label="I already have an account" onPress={() => navigation.navigate('SignIn')} />
        <Text variant="caption" color="muted" align="center" style={{ marginTop: spacing.sm }}>
          Your analysis runs on your own measurements. Photos are optional, private
          and never shared.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'space-between', paddingBottom: 40 },
  hero: { flex: 1, justifyContent: 'center' },
});
